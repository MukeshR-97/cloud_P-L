"""
REST API for AWS account management and cost fetching.

ACCOUNT vs PAYER DESIGN
------------------------
aws_accounts   = the actual customer/member AWS account (NEVER duplicated)
aws_account_payers = management/payer accounts that have billed over time

One aws_account can have many payers (historical). Only ONE payer is active at
any given time. Changing the management account creates a new payer row — it
does NOT create a new aws_accounts row.

Endpoints:
  GET    /api/aws-accounts                          list all accounts
  POST   /api/aws-accounts                          create or upsert account
  GET    /api/aws-accounts/<id>                     get single account
  PUT    /api/aws-accounts/<id>                     update account metadata
  DELETE /api/aws-accounts/<id>                     delete account

  GET    /api/aws-accounts/<id>/payers              list payer history
  POST   /api/aws-accounts/<id>/payers              add new payer (deactivates old)
  PUT    /api/aws-accounts/<id>/payers/<pid>/activate  set a payer as active
  DELETE /api/aws-accounts/<id>/payers/<pid>        delete a payer record

  POST   /api/aws-accounts/<id>/fetch               trigger Cost Explorer pull
  GET    /api/aws-accounts/<id>/list-children       list child accounts via Orgs API
  POST   /api/aws-accounts/<id>/add-child           add a child account

  POST   /api/aws-accounts/<id>/rotate-credentials  (legacy — use payers endpoint instead)
"""

import uuid
import logging
from datetime import date, datetime
from flask import Blueprint, request, jsonify
from sqlalchemy.exc import SQLAlchemyError
from app import db
from app.models import AwsAccount, AwsAccountPayer, CostRecord

aws_bp = Blueprint("aws", __name__)
log = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_date(value, field: str):
    if not value:
        return None, f"{field} is required"
    try:
        return datetime.strptime(value, "%Y-%m-%d").date(), None
    except ValueError:
        return None, f"{field} must be YYYY-MM-DD"


def _validate_access_key(key: str) -> bool:
    return bool(key) and len(key) >= 16


def _deactivate_current_payers(account_id: int):
    """Mark all active payers for this account as inactive with valid_to = today."""
    AwsAccountPayer.query.filter_by(
        aws_account_id=account_id, is_active=True
    ).update({"is_active": False, "valid_to": date.today()})


# ── List / Get ─────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts", methods=["GET"])
def list_accounts():
    try:
        accounts = AwsAccount.query.order_by(AwsAccount.name).all()
        return jsonify([a.to_dict() for a in accounts]), 200
    except SQLAlchemyError as exc:
        log.exception("list_accounts failed")
        return jsonify({"error": f"Database error: {exc}"}), 500


@aws_bp.route("/aws-accounts/<int:account_id>", methods=["GET"])
def get_account(account_id):
    account = AwsAccount.query.get_or_404(account_id)
    return jsonify(account.to_dict()), 200


# ── Create ────────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts", methods=["POST"])
def create_account():
    """
    Create a new aws_accounts record.

    DUPLICATE PROTECTION:
    If aws_account_id is provided and already exists, return 409 with the
    existing account's data so the UI can offer to add a new payer instead.
    """
    payload = request.get_json(silent=True) or {}

    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 422

    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()
    is_manual  = bool(payload.get("is_manual", False))
    aws_acct_id = (payload.get("aws_account_id") or "").strip() or None

    # Credentials required only for non-manual accounts
    if not is_manual:
        if not _validate_access_key(access_key):
            return jsonify({"error": "access_key_id is required (min 16 characters)"}), 422
        if not secret_key:
            return jsonify({"error": "secret_access_key is required"}), 422

    contract_date, err = _parse_date(payload.get("contract_date"), "contract_date")
    if err:
        return jsonify({"error": err}), 422

    # DUPLICATE PROTECTION — same child/member account ID must not create a new row
    if aws_acct_id:
        existing = AwsAccount.query.filter_by(aws_account_id=aws_acct_id).first()
        if existing:
            return jsonify({
                "error": f"AWS account {aws_acct_id} already exists as '{existing.name}'.",
                "existing_account": existing.to_dict(),
                "suggestion": "Use POST /aws-accounts/<id>/payers to add a new management account.",
            }), 409

    try:
        account = AwsAccount(
            name=name,
            aws_account_id=aws_acct_id,
            region=payload.get("region") or "us-east-1",
            contract_date=contract_date,
            is_active=bool(payload.get("is_active", True)),
            is_manual=is_manual,
        )
        # Also set legacy credential columns for backward compat
        if not is_manual:
            account.set_access_key_id(access_key)
            account.set_secret_access_key(secret_key)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500

    try:
        db.session.add(account)
        db.session.flush()  # get account.id before commit

        # Create the first payer entry
        if not is_manual:
            payer_account_id = (payload.get("payer_account_id") or "").strip() or aws_acct_id or "unknown"
            payer = AwsAccountPayer(
                aws_account_id=account.id,
                payer_account_id=payer_account_id,
                management_account_name=(payload.get("management_account_name") or "").strip() or None,
                region=account.region,
                is_active=True,
                valid_from=contract_date,
            )
            payer.set_access_key_id(access_key)
            payer.set_secret_access_key(secret_key)
            db.session.add(payer)

        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during create_account")
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(account.to_dict()), 201


# ── Update ────────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>", methods=["PUT"])
def update_account(account_id):
    """Update account metadata (name, region, contract_date, is_active).
    Credentials are managed through the /payers endpoint."""
    account = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    if (name := (payload.get("name") or "").strip()):
        account.name = name

    if payload.get("region"):
        account.region = payload["region"]

    if payload.get("contract_date"):
        contract_date, err = _parse_date(payload["contract_date"], "contract_date")
        if err:
            return jsonify({"error": err}), 422
        account.contract_date = contract_date

    if payload.get("is_active") is not None:
        account.is_active = bool(payload["is_active"])

    # Legacy: allow credential update via PUT for backward compat
    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()
    if access_key or secret_key:
        if access_key and not _validate_access_key(access_key):
            return jsonify({"error": "access_key_id too short (min 16 chars)"}), 422
        try:
            if access_key:
                account.set_access_key_id(access_key)
            if secret_key:
                account.set_secret_access_key(secret_key)
            # Also update the active payer's credentials
            active = account.active_payer
            if active:
                if access_key:
                    active.set_access_key_id(access_key)
                if secret_key:
                    active.set_secret_access_key(secret_key)
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500

    try:
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(account.to_dict()), 200


# ── Delete ────────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>", methods=["DELETE"])
def delete_account(account_id):
    account = AwsAccount.query.get_or_404(account_id)
    try:
        db.session.delete(account)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify({"message": "Account deleted. Associated cost records were kept."}), 200


# ── Payer History ─────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/payers", methods=["GET"])
def list_payers(account_id):
    """Return all payer records for this account ordered by valid_from."""
    AwsAccount.query.get_or_404(account_id)
    payers = (
        AwsAccountPayer.query
        .filter_by(aws_account_id=account_id)
        .order_by(AwsAccountPayer.valid_from)
        .all()
    )
    return jsonify([p.to_dict() for p in payers]), 200


@aws_bp.route("/aws-accounts/<int:account_id>/payers", methods=["POST"])
def add_payer(account_id):
    """
    Add a new management/payer account for an existing aws_account.

    This NEVER creates a new aws_accounts row.
    Steps:
      1. Validate the existing account.
      2. Deactivate all current active payers (set is_active=False, valid_to=today).
      3. Insert new AwsAccountPayer row with is_active=True.
      4. Optionally update legacy credential columns on aws_accounts.

    Body:
      {
        "payer_account_id":        "222222222222",   required
        "management_account_name": "Acme Payer 2",  optional
        "access_key_id":           "AKIA...",        required
        "secret_access_key":       "...",            required
        "region":                  "us-east-1",      optional
        "valid_from":              "2026-07-01",     optional (default: today)
        "remarks":                 "Switched payer"  optional
      }
    """
    account = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    payer_account_id = (payload.get("payer_account_id") or "").strip()
    if not payer_account_id:
        return jsonify({"error": "payer_account_id is required"}), 422

    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()
    if not _validate_access_key(access_key):
        return jsonify({"error": "access_key_id is required (min 16 characters)"}), 422
    if not secret_key:
        return jsonify({"error": "secret_access_key is required"}), 422

    valid_from_str = (payload.get("valid_from") or "").strip()
    if valid_from_str:
        valid_from, err = _parse_date(valid_from_str, "valid_from")
        if err:
            return jsonify({"error": err}), 422
    else:
        valid_from = date.today()

    region = (payload.get("region") or account.region or "us-east-1").strip()
    mgmt_name = (payload.get("management_account_name") or "").strip() or None
    remarks   = (payload.get("remarks") or "").strip() or None

    try:
        # Step 2: deactivate current payers
        _deactivate_current_payers(account_id)

        # Step 3: insert new payer
        payer = AwsAccountPayer(
            aws_account_id=account_id,
            payer_account_id=payer_account_id,
            management_account_name=mgmt_name,
            region=region,
            is_active=True,
            valid_from=valid_from,
            valid_to=None,
            remarks=remarks,
        )
        payer.set_access_key_id(access_key)
        payer.set_secret_access_key(secret_key)
        db.session.add(payer)

        # Step 4: update legacy columns on aws_accounts so old code still works
        account.set_access_key_id(access_key)
        account.set_secret_access_key(secret_key)
        if region:
            account.region = region

        db.session.commit()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during add_payer")
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify({
        "message": (
            f"New payer '{payer_account_id}' added to account '{account.name}'. "
            "Previous payer deactivated. Run 'Fetch Costs' to pull data from the new payer."
        ),
        "payer":   payer.to_dict(),
        "account": account.to_dict(),
    }), 201


# ── Bulk payer switch — switch ALL children of a management account ────────────

@aws_bp.route("/aws-accounts/<int:account_id>/payers/bulk-switch", methods=["POST"])
def bulk_switch_payer(account_id):
    """
    Switch the active payer for ALL accounts that currently share the same
    management account as this one. Designed for the common case where a
    management account has 10+ child accounts that all need to move to a new payer.

    Steps:
      1. Find the current active payer of account_id.
      2. Find all OTHER accounts whose active payer_account_id matches.
      3. Deactivate old payer on ALL of them.
      4. Insert new payer row on ALL of them.

    Body: same as POST /aws-accounts/<id>/payers
      {
        "payer_account_id":        "222222222222",
        "management_account_name": "Acme Payer 2",
        "access_key_id":           "AKIA...",
        "secret_access_key":       "...",
        "region":                  "us-east-1",
        "valid_from":              "2026-07-01",
        "remarks":                 "Bulk switch — org restructure"
      }

    Returns: { updated_accounts: [{ id, name }], count: N }
    """
    account = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    payer_account_id = (payload.get("payer_account_id") or "").strip()
    if not payer_account_id:
        return jsonify({"error": "payer_account_id is required"}), 422

    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()
    if not _validate_access_key(access_key):
        return jsonify({"error": "access_key_id is required (min 16 characters)"}), 422
    if not secret_key:
        return jsonify({"error": "secret_access_key is required"}), 422

    valid_from_str = (payload.get("valid_from") or "").strip()
    if valid_from_str:
        valid_from, err = _parse_date(valid_from_str, "valid_from")
        if err:
            return jsonify({"error": err}), 422
    else:
        valid_from = date.today()

    region    = (payload.get("region") or account.region or "us-east-1").strip()
    mgmt_name = (payload.get("management_account_name") or "").strip() or None
    remarks   = (payload.get("remarks") or "").strip() or None

    # Find the current active payer for this account
    current_active = account.active_payer
    if not current_active:
        return jsonify({"error": "No active payer found on this account."}), 400

    old_payer_id = current_active.payer_account_id

    # Find all accounts that share the same active payer_account_id
    # (this account + all children/siblings that use the same management account)
    sibling_payers = (
        AwsAccountPayer.query
        .filter_by(payer_account_id=old_payer_id, is_active=True)
        .all()
    )
    # Collect unique account IDs
    affected_account_ids = list({p.aws_account_id for p in sibling_payers})

    try:
        updated_accounts = []
        for acct_id in affected_account_ids:
            acct = AwsAccount.query.get(acct_id)
            if not acct:
                continue

            # Deactivate old payer
            _deactivate_current_payers(acct_id)

            # Create new payer
            new_payer = AwsAccountPayer(
                aws_account_id=acct_id,
                payer_account_id=payer_account_id,
                management_account_name=mgmt_name,
                region=region,
                is_active=True,
                valid_from=valid_from,
                valid_to=None,
                remarks=remarks,
            )
            new_payer.set_access_key_id(access_key)
            new_payer.set_secret_access_key(secret_key)
            db.session.add(new_payer)

            # Update legacy columns
            acct.set_access_key_id(access_key)
            acct.set_secret_access_key(secret_key)
            if region:
                acct.region = region

            updated_accounts.append({"id": acct.id, "name": acct.name})

        db.session.commit()

    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during bulk_switch_payer")
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify({
        "message": (
            f"Payer switched to '{payer_account_id}' for {len(updated_accounts)} account(s). "
            "Previous payer deactivated on all. Click 'Fetch Costs' on each account to pull updated data."
        ),
        "updated_accounts": updated_accounts,
        "count": len(updated_accounts),
        "old_payer": old_payer_id,
        "new_payer": payer_account_id,
    }), 200



@aws_bp.route("/aws-accounts/<int:account_id>/payers/<int:payer_id>/activate", methods=["PUT"])
def activate_payer(account_id, payer_id):
    """
    Switch the active payer to a previously inactive one.
    Useful when reverting to an old management account.
    """
    account = AwsAccount.query.get_or_404(account_id)
    payer   = AwsAccountPayer.query.filter_by(id=payer_id, aws_account_id=account_id).first()
    if not payer:
        return jsonify({"error": "Payer not found for this account"}), 404

    try:
        # Deactivate all current payers
        _deactivate_current_payers(account_id)

        # Activate the selected payer
        payer.is_active = True
        payer.valid_to  = None
        payer.valid_from = date.today()

        # Sync legacy columns
        ak = payer.get_access_key_id()
        sk = payer.get_secret_access_key()
        if ak:
            account.set_access_key_id(ak)
        if sk:
            account.set_secret_access_key(sk)
        account.region = payer.region

        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify({
        "message": f"Payer '{payer.payer_account_id}' is now active for account '{account.name}'.",
        "payer":   payer.to_dict(),
        "account": account.to_dict(),
    }), 200


@aws_bp.route("/aws-accounts/<int:account_id>/payers/<int:payer_id>", methods=["DELETE"])
def delete_payer(account_id, payer_id):
    payer = AwsAccountPayer.query.filter_by(id=payer_id, aws_account_id=account_id).first()
    if not payer:
        return jsonify({"error": "Payer not found"}), 404
    if payer.is_active:
        return jsonify({"error": "Cannot delete the active payer. Activate another payer first."}), 400
    try:
        db.session.delete(payer)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify({"message": "Payer record deleted."}), 200


# ── Cost Fetch ────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/fetch", methods=["POST"])
def fetch_costs(account_id):
    """
    Fetch AWS Cost Explorer data using the ACTIVE PAYER's credentials.

    SPLIT-MONTH LOGIC
    -----------------
    When a management account changes mid-month, AWS Cost Explorer returns a
    PARTIAL month total from each payer. This function detects that situation
    and creates split rows instead of overwriting or silently preserving data.

    Decision matrix per month:
    ┌────────────────────┬──────────────────────────────────────────────────────┐
    │ AWS status         │ Action                                               │
    ├────────────────────┼──────────────────────────────────────────────────────┤
    │ fetched            │ No existing row → INSERT new row                     │
    │ fetched            │ Existing row, SAME payer → UPDATE in place           │
    │ fetched            │ Existing row, DIFFERENT payer → SPLIT: mark existing │
    │                    │   as is_split=True, insert new split row, share UUID │
    │ zero               │ Existing row with data → PRESERVE (mark preserved)   │
    │ zero               │ No existing row → skip (don't insert $0)             │
    │ unavailable        │ Existing row with data → PRESERVE                    │
    │ unavailable        │ No existing row → record as unavailable, skip insert │
    └────────────────────┴──────────────────────────────────────────────────────┘
    """
    account = AwsAccount.query.get_or_404(account_id)

    if not account.is_active:
        return jsonify({"error": "Account is inactive"}), 400

    active_payer = account.active_payer
    if not active_payer and not account.is_manual:
        return jsonify({"error": "No active payer found. Add a management account first."}), 400

    from app.aws_service import fetch_monthly_costs

    try:
        monthly_data = fetch_monthly_costs(account)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    summary = {"fetched": 0, "preserved": 0, "zero": 0,
               "unavailable": 0, "inserted": 0, "updated": 0, "split": 0}
    month_results: list[dict] = []

    try:
        for row in monthly_data:
            month_date = row["month"]
            aws_status = row["data_status"]
            aws_cloud  = row["cloud_service_cost"]
            aws_mp     = row["marketplace_cost"]
            payer_id   = row["payer_account_id"]
            month_str  = month_date.isoformat()

            # Find ALL existing records for this account+month (may be >1 if already split)
            existing_rows = (
                CostRecord.query
                .filter_by(aws_account_id=account.id, consumption_month=month_date)
                .all()
            )
            existing = existing_rows[0] if existing_rows else None

            has_historical = (
                existing is not None
                and (float(existing.cloud_service_cost) > 0
                     or float(existing.marketplace_cost) > 0)
            )

            # Check if an existing split row for THIS payer already exists
            existing_for_this_payer = next(
                (r for r in existing_rows if r.cost_data_source == payer_id),
                None
            )

            # ── fetched ──────────────────────────────────────────────────────
            if aws_status == "fetched":

                if existing_for_this_payer:
                    # Same payer already has a row → update it
                    existing_for_this_payer.cloud_service_cost = round(aws_cloud, 4)
                    existing_for_this_payer.marketplace_cost   = round(aws_mp, 4)
                    existing_for_this_payer.cost_status        = "fetched"
                    existing_for_this_payer.is_auto_fetched    = True
                    action = "updated"
                    summary["updated"] += 1
                    summary["fetched"] += 1
                    month_results.append({
                        "month": month_str, "status": "fetched", "action": action,
                        "cloud_service_cost": round(aws_cloud, 2),
                        "marketplace_cost":   round(aws_mp, 2),
                        "cost_data_source":   payer_id,
                    })

                elif existing is None:
                    # No record yet → simple insert
                    record = CostRecord(
                        aws_account_id    = account.id,
                        contract_date     = account.contract_date,
                        consumption_month = month_date,
                        cloud_service_cost= round(aws_cloud, 4),
                        marketplace_cost  = round(aws_mp, 4),
                        is_auto_fetched   = True,
                        cost_data_source  = payer_id,
                        cost_status       = "fetched",
                    )
                    db.session.add(record)
                    action = "inserted"
                    summary["inserted"] += 1
                    summary["fetched"]  += 1
                    month_results.append({
                        "month": month_str, "status": "fetched", "action": action,
                        "cloud_service_cost": round(aws_cloud, 2),
                        "marketplace_cost":   round(aws_mp, 2),
                        "cost_data_source":   payer_id,
                    })

                else:
                    # Existing row belongs to a DIFFERENT payer → SPLIT MONTH
                    # Generate shared group UUID (reuse if already split)
                    group_id = existing.split_month_group or str(uuid.uuid4())

                    # Mark all existing rows for this month as split
                    for r in existing_rows:
                        r.is_split          = True
                        r.split_month_group = group_id

                    # Insert new split row for current payer
                    split_row = CostRecord(
                        aws_account_id    = account.id,
                        contract_date     = account.contract_date,
                        consumption_month = month_date,
                        cloud_service_cost= round(aws_cloud, 4),
                        marketplace_cost  = round(aws_mp, 4),
                        # Inherit discount/rate from first existing row
                        distributor_discount  = existing.distributor_discount,
                        customer_discount     = existing.customer_discount,
                        managed_services      = existing.managed_services,
                        conversion_rate       = existing.conversion_rate,
                        is_auto_fetched   = True,
                        cost_data_source  = payer_id,
                        cost_status       = "fetched",
                        is_split          = True,
                        split_month_group = group_id,
                        remarks           = f"Split: {payer_id} portion",
                    )
                    db.session.add(split_row)
                    summary["split"]   += 1
                    summary["fetched"] += 1
                    month_results.append({
                        "month": month_str, "status": "split",
                        "action": "split_inserted",
                        "cloud_service_cost": round(aws_cloud, 2),
                        "marketplace_cost":   round(aws_mp, 2),
                        "cost_data_source":   payer_id,
                        "split_month_group":  group_id,
                        "reason": (
                            f"Mid-month payer change detected. "
                            f"Existing row payer: {existing.cost_data_source}, "
                            f"new payer: {payer_id}. Both preserved as split rows."
                        ),
                    })

            # ── zero ─────────────────────────────────────────────────────────
            elif aws_status == "zero":
                if has_historical:
                    existing.cost_status = "preserved"
                    summary["preserved"] += 1
                    month_results.append({
                        "month": month_str, "status": "preserved",
                        "reason": "AWS returned $0 but existing historical record preserved",
                        "cost_data_source": existing.cost_data_source,
                        "cloud_service_cost": round(float(existing.cloud_service_cost), 2),
                        "marketplace_cost":   round(float(existing.marketplace_cost), 2),
                    })
                else:
                    summary["zero"] += 1
                    month_results.append({
                        "month": month_str, "status": "zero",
                        "reason": "AWS confirmed $0; no record inserted",
                        "cost_data_source": payer_id,
                    })

            # ── unavailable ───────────────────────────────────────────────────
            elif aws_status == "unavailable":
                if has_historical:
                    existing.cost_status = "preserved"
                    summary["preserved"] += 1
                    month_results.append({
                        "month": month_str, "status": "preserved",
                        "reason": "AWS historical data unavailable from current payer; existing value preserved",
                        "cost_data_source": existing.cost_data_source,
                        "cloud_service_cost": round(float(existing.cloud_service_cost), 2),
                        "marketplace_cost":   round(float(existing.marketplace_cost), 2),
                    })
                else:
                    summary["unavailable"] += 1
                    month_results.append({
                        "month": month_str, "status": "unavailable",
                        "reason": "No historical record and current payer cannot access this period.",
                        "cost_data_source": payer_id,
                    })

        db.session.commit()

    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    message = (
        f"Processed {len(monthly_data)} month(s) for '{account.name}'. "
        f"Fetched: {summary['fetched']}, "
        f"Split: {summary['split']}, "
        f"Preserved: {summary['preserved']}, "
        f"Unavailable: {summary['unavailable']}, "
        f"Zero: {summary['zero']}."
    )
    if summary["split"] > 0:
        message += (
            f" {summary['split']} month(s) had a mid-month payer change — "
            "split rows created. Both payer portions are preserved."
        )
    if summary["unavailable"] > 0:
        message += (
            f" {summary['unavailable']} month(s) could not be retrieved — "
            "data is not visible to the current management account."
        )

    return jsonify({
        "success": True,
        "message": message,
        "summary": summary,
        "months":  month_results,
        "account": account.name,
        "payer":   active_payer.payer_account_id if active_payer else "manual",
    }), 200


# ── List child accounts (via AWS Organizations) ───────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/list-children", methods=["GET"])
def list_child_accounts(account_id):
    account = AwsAccount.query.get_or_404(account_id)

    try:
        import boto3
        from botocore.exceptions import ClientError as BotoClientError

        active = account.active_payer
        if active:
            ak = active.get_access_key_id()
            sk = active.get_secret_access_key()
        else:
            ak = account.get_access_key_id()
            sk = account.get_secret_access_key()

        session = boto3.Session(
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            region_name="us-east-1",
        )
        org = session.client("organizations")
        ak = sk = None

        children = []
        paginator = org.get_paginator("list_accounts")
        for page in paginator.paginate():
            for acct in page.get("Accounts", []):
                children.append({
                    "account_id": acct["Id"],
                    "name":       acct["Name"],
                    "email":      acct.get("Email", ""),
                    "status":     acct["Status"],
                })

    except BotoClientError as exc:
        code = exc.response["Error"]["Code"]
        msg  = exc.response["Error"]["Message"]
        if code in ("AccessDeniedException", "AWSOrganizationsNotInUseException"):
            return jsonify({"error": (
                f"Cannot list child accounts: {msg}\n\n"
                "Make sure this is the management account and the IAM user has "
                "'organizations:ListAccounts' permission."
            )}), 400
        return jsonify({"error": f"AWS error [{code}]: {msg}"}), 400
    except Exception as exc:
        log.exception("list_child_accounts failed")
        return jsonify({"error": str(exc)}), 500

    existing_ids = {
        a.aws_account_id
        for a in AwsAccount.query.with_entities(AwsAccount.aws_account_id).all()
        if a.aws_account_id
    }
    mgmt_id = account.aws_account_id or ""
    result = [
        {**c, "already_added": c["account_id"] in existing_ids}
        for c in children
        if c["account_id"] != mgmt_id and c["status"] == "ACTIVE"
    ]
    result.sort(key=lambda x: x["name"])
    return jsonify(result), 200


# ── Add child account ─────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/add-child", methods=["POST"])
def add_child_account(account_id):
    """
    Add a child account — reuses the management account's active payer credentials.
    Checks for existing aws_account_id to prevent duplicates.
    """
    parent = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    child_account_id = (payload.get("child_account_id") or "").strip()
    child_name       = (payload.get("child_name") or "").strip()

    if not child_account_id:
        return jsonify({"error": "child_account_id is required"}), 422
    if not child_name:
        return jsonify({"error": "child_name is required"}), 422

    contract_date, err = _parse_date(payload.get("contract_date"), "contract_date")
    if err:
        return jsonify({"error": err}), 422

    # DUPLICATE PROTECTION
    existing = AwsAccount.query.filter_by(aws_account_id=child_account_id).first()
    if existing:
        return jsonify({
            "error": f"Account {child_account_id} already exists as '{existing.name}'.",
            "existing_account": existing.to_dict(),
        }), 409

    parent_active = parent.active_payer

    try:
        child = AwsAccount(
            name=child_name,
            aws_account_id=child_account_id,
            region=parent.region,
            contract_date=contract_date,
            is_active=True,
            is_manual=False,
        )
        # Copy legacy credentials from parent
        child._access_key_id_enc     = parent._access_key_id_enc
        child._secret_access_key_enc = parent._secret_access_key_enc
        db.session.add(child)
        db.session.flush()

        # Create a payer row for the child using the parent's active payer
        payer_id = parent_active.payer_account_id if parent_active else (parent.aws_account_id or "unknown")
        child_payer = AwsAccountPayer(
            aws_account_id=child.id,
            payer_account_id=payer_id,
            management_account_name=parent.name,
            region=parent.region,
            is_active=True,
            valid_from=contract_date,
        )
        if parent_active:
            child_payer._access_key_id_enc     = parent_active._access_key_id_enc
            child_payer._secret_access_key_enc = parent_active._secret_access_key_enc
        else:
            child_payer._access_key_id_enc     = parent._access_key_id_enc
            child_payer._secret_access_key_enc = parent._secret_access_key_enc
        db.session.add(child_payer)

        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(child.to_dict()), 201


# ── Rotate credentials (legacy endpoint — kept for backward compat) ───────────

@aws_bp.route("/aws-accounts/<int:account_id>/rotate-credentials", methods=["POST"])
def rotate_credentials(account_id):
    """
    Legacy: update credentials on the active payer + legacy columns.
    For full payer management use POST /aws-accounts/<id>/payers instead.
    """
    account = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    new_ak = (payload.get("access_key_id") or "").strip()
    new_sk = (payload.get("secret_access_key") or "").strip()
    apply_to_children = payload.get("apply_to_children", True)

    if not new_ak and not new_sk:
        return jsonify({"error": "Provide at least access_key_id or secret_access_key"}), 422
    if new_ak and not _validate_access_key(new_ak):
        return jsonify({"error": "access_key_id too short (min 16 chars)"}), 422

    try:
        shared = [account]
        if apply_to_children:
            siblings = AwsAccount.query.filter(
                AwsAccount.id != account.id,
                AwsAccount._access_key_id_enc == account._access_key_id_enc,
            ).all()
            shared.extend(siblings)

        for acct in shared:
            if new_ak:
                acct.set_access_key_id(new_ak)
            if new_sk:
                acct.set_secret_access_key(new_sk)
            # Also update the active payer row
            active = acct.active_payer
            if active:
                if new_ak:
                    active.set_access_key_id(new_ak)
                if new_sk:
                    active.set_secret_access_key(new_sk)

        db.session.commit()
        updated = [{"id": a.id, "name": a.name} for a in shared]
        return jsonify({
            "message": f"Credentials updated for {len(updated)} account(s).",
            "updated_accounts": updated,
            "count": len(updated),
        }), 200

    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 500
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
