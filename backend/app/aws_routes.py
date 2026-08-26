"""
REST API for AWS account management and cost fetching.

Endpoints:
  GET    /api/aws-accounts              list all accounts (keys masked)
  POST   /api/aws-accounts              create account (encrypt keys)
  GET    /api/aws-accounts/<id>         get single account (keys masked)
  PUT    /api/aws-accounts/<id>         update (re-encrypt keys if provided)
  DELETE /api/aws-accounts/<id>         delete account + nullify related records
  POST   /api/aws-accounts/<id>/fetch   trigger Cost Explorer pull → upsert cost_records
"""

import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from sqlalchemy.exc import SQLAlchemyError
from app import db
from app.models import AwsAccount, CostRecord

aws_bp = Blueprint("aws", __name__)
log = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _parse_date(value, field: str):
    if not value:
        return None, f"{field} is required"
    try:
        return datetime.strptime(value, "%Y-%m-%d").date(), None
    except ValueError:
        return None, f"{field} must be YYYY-MM-DD"


def _validate_access_key(key: str) -> bool:
    return bool(key) and len(key) >= 16


# ── CRUD ─────────────────────────────────────────────────────────────────────

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


@aws_bp.route("/aws-accounts", methods=["POST"])
def create_account():
    payload = request.get_json(silent=True) or {}

    name = (payload.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 422

    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()

    if not _validate_access_key(access_key):
        return jsonify({"error": "access_key_id is required (min 16 characters)"}), 422
    if not secret_key:
        return jsonify({"error": "secret_access_key is required"}), 422

    contract_date, err = _parse_date(payload.get("contract_date"), "contract_date")
    if err:
        return jsonify({"error": err}), 422

    try:
        account = AwsAccount(
            name=name,
            aws_account_id=(payload.get("aws_account_id") or "").strip() or None,
            region=payload.get("region") or "us-east-1",
            contract_date=contract_date,
            is_active=bool(payload.get("is_active", True)),
        )
        account.set_access_key_id(access_key)
        account.set_secret_access_key(secret_key)
    except RuntimeError as exc:
        # FERNET_KEY not configured
        log.exception("Encryption failed during create_account")
        return jsonify({"error": str(exc)}), 500

    try:
        db.session.add(account)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during create_account")
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(account.to_dict()), 201


@aws_bp.route("/aws-accounts/<int:account_id>", methods=["PUT"])
def update_account(account_id):
    account = AwsAccount.query.get_or_404(account_id)
    payload = request.get_json(silent=True) or {}

    name = (payload.get("name") or "").strip()
    if name:
        account.name = name

    if payload.get("aws_account_id") is not None:
        account.aws_account_id = (payload["aws_account_id"] or "").strip() or None

    if payload.get("region"):
        account.region = payload["region"]

    if payload.get("contract_date"):
        contract_date, err = _parse_date(payload["contract_date"], "contract_date")
        if err:
            return jsonify({"error": err}), 422
        account.contract_date = contract_date

    if payload.get("is_active") is not None:
        account.is_active = bool(payload["is_active"])

    access_key = (payload.get("access_key_id") or "").strip()
    secret_key = (payload.get("secret_access_key") or "").strip()

    try:
        if access_key:
            if not _validate_access_key(access_key):
                return jsonify({"error": "access_key_id too short (min 16 chars)"}), 422
            account.set_access_key_id(access_key)
        if secret_key:
            account.set_secret_access_key(secret_key)
    except RuntimeError as exc:
        log.exception("Encryption failed during update_account")
        return jsonify({"error": str(exc)}), 500

    try:
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during update_account")
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(account.to_dict()), 200


@aws_bp.route("/aws-accounts/<int:account_id>", methods=["DELETE"])
def delete_account(account_id):
    account = AwsAccount.query.get_or_404(account_id)
    try:
        db.session.delete(account)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during delete_account")
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify({"message": "Account deleted. Associated cost records were kept."}), 200


# ── Cost Fetch ────────────────────────────────────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/fetch", methods=["POST"])
def fetch_costs(account_id):
    account = AwsAccount.query.get_or_404(account_id)

    if not account.is_active:
        return jsonify({"error": "Account is inactive"}), 400

    from app.aws_service import fetch_monthly_costs

    try:
        monthly_data = fetch_monthly_costs(account)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # Don't save months that are all zeros — nothing to record
    monthly_data = [
        row for row in monthly_data
        if row["cloud_service_cost"] > 0 or row["marketplace_cost"] > 0
    ]

    if not monthly_data:
        return jsonify({
            "message": f"No billable usage found for account '{account.name}' in the fetched period. No records were created.",
            "records": [],
        }), 200

    upserted = []
    try:
        for row in monthly_data:
            month_date = row["month"]

            existing = CostRecord.query.filter_by(
                aws_account_id=account.id,
                consumption_month=month_date,
            ).first()

            if existing:
                existing.cloud_service_cost = round(row["cloud_service_cost"], 4)
                existing.marketplace_cost = round(row["marketplace_cost"], 4)
                existing.is_auto_fetched = True
                action = "updated"
            else:
                record = CostRecord(
                    aws_account_id=account.id,
                    contract_date=account.contract_date,
                    consumption_month=month_date,
                    cloud_service_cost=round(row["cloud_service_cost"], 4),
                    marketplace_cost=round(row["marketplace_cost"], 4),
                    is_auto_fetched=True,
                )
                db.session.add(record)
                action = "created"

            db.session.flush()
            upserted.append({
                "consumption_month":  month_date.isoformat(),
                "cloud_service_cost": round(row["cloud_service_cost"], 2),
                "marketplace_cost":   round(row["marketplace_cost"], 2),
                "total":              round(row["cloud_service_cost"] + row["marketplace_cost"], 2),
                # Serialize services for frontend: [{name, amount, is_marketplace, entity}]
                "services": [
                    {
                        "name":           svc_name,
                        "amount":         round(svc_data["amount"], 4),
                        "is_marketplace": svc_data["is_marketplace"],
                        "entity":         svc_data.get("entity", ""),
                    }
                    for svc_name, svc_data in sorted(
                        row.get("services", {}).items(),
                        key=lambda x: -x[1]["amount"]
                    )
                ],
                "action": action,
            })

        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        log.exception("DB error during fetch_costs upsert")
        return jsonify({"error": f"Database error while saving fetched costs: {exc}"}), 500

    return jsonify({
        "message": f"Fetched {len(upserted)} month(s) for account '{account.name}'",
        "records": upserted,
    }), 200


# ── List child accounts from AWS Organizations ────────────────────────────────

@aws_bp.route("/aws-accounts/<int:account_id>/list-children", methods=["GET"])
def list_child_accounts(account_id):
    """
    Use the given account's IAM credentials to call AWS Organizations
    and return all active member (child) accounts in the organization.

    The account must be the management/payer account — member accounts
    cannot call Organizations API.

    Returns:
      [ { account_id, name, email, status, already_added } ]
    """
    account = AwsAccount.query.get_or_404(account_id)

    try:
        import boto3
        from botocore.exceptions import ClientError as BotoClientError

        ak = account.get_access_key_id()
        sk = account.get_secret_access_key()

        session = boto3.Session(
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            region_name="us-east-1",
        )
        org = session.client("organizations")
        ak = sk = None  # clear credentials

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
            return jsonify({
                "error": (
                    f"Cannot list child accounts: {msg}\n\n"
                    "Make sure this account is the management (payer) account "
                    "and the IAM user has 'organizations:ListAccounts' permission."
                )
            }), 400
        return jsonify({"error": f"AWS error [{code}]: {msg}"}), 400
    except Exception as exc:
        log.exception("list_child_accounts failed")
        return jsonify({"error": str(exc)}), 500

    # Mark which accounts are already added in the app
    existing_ids = {
        a.aws_account_id
        for a in AwsAccount.query.with_entities(AwsAccount.aws_account_id).all()
        if a.aws_account_id
    }

    # Exclude the management account itself from the list
    mgmt_id = account.aws_account_id or ""

    result = [
        {**c, "already_added": c["account_id"] in existing_ids}
        for c in children
        if c["account_id"] != mgmt_id and c["status"] == "ACTIVE"
    ]

    result.sort(key=lambda x: x["name"])
    return jsonify(result), 200


@aws_bp.route("/aws-accounts/<int:account_id>/add-child", methods=["POST"])
def add_child_account(account_id):
    """
    Add a child account — reuses the management account's credentials
    but filters Cost Explorer by the child's account ID.

    Body: { child_account_id, child_name, contract_date }
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

    # Check not already added
    existing = AwsAccount.query.filter_by(aws_account_id=child_account_id).first()
    if existing:
        return jsonify({"error": f"Account {child_account_id} is already added as '{existing.name}'"}), 409

    try:
        child = AwsAccount(
            name=child_name,
            aws_account_id=child_account_id,
            region=parent.region,
            contract_date=contract_date,
            is_active=True,
        )
        # Copy the parent's encrypted credentials directly
        child._access_key_id_enc     = parent._access_key_id_enc
        child._secret_access_key_enc = parent._secret_access_key_enc

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    try:
        db.session.add(child)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify(child.to_dict()), 201
