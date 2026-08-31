import uuid
from flask import Blueprint, request, jsonify
from app import db
from app.models import CostRecord
from datetime import datetime
from sqlalchemy.exc import SQLAlchemyError

cost_bp = Blueprint("cost", __name__)


# ── Helpers ──────────────────────────────────────────────────────────────────

def parse_date(value, field_name):
    if not value:
        return None, f"{field_name} is required"
    try:
        return datetime.strptime(value, "%Y-%m-%d").date(), None
    except ValueError:
        return None, f"{field_name} must be YYYY-MM-DD"


def record_from_payload(payload, record=None):
    if record is None:
        record = CostRecord()

    aws_account_id = payload.get("aws_account_id")
    if aws_account_id is not None:
        try:
            record.aws_account_id = int(aws_account_id) if aws_account_id else None
        except (TypeError, ValueError):
            return None, "aws_account_id must be a number"

    contract_date, err = parse_date(payload.get("contract_date"), "contract_date")
    if err:
        return None, err
    consumption_month, err = parse_date(payload.get("consumption_month"), "consumption_month")
    if err:
        return None, err

    record.contract_date     = contract_date
    record.consumption_month = consumption_month

    usd_fields = ["cloud_service_cost", "marketplace_cost",
                  "credit_amount", "cash_claim", "redington_credit_note"]
    for field in usd_fields:
        raw = payload.get(field, 0)
        try:
            setattr(record, field, float(raw))
        except (TypeError, ValueError):
            return None, f"{field} must be a number"

    pct_fields = ["distributor_discount", "customer_discount", "managed_services"]
    for field in pct_fields:
        raw = payload.get(field, 0)
        try:
            v = float(raw)
            if v < 0 or v > 100:
                return None, f"{field} must be between 0 and 100"
            setattr(record, field, v)
        except (TypeError, ValueError):
            return None, f"{field} must be a percentage (0–100)"

    try:
        cr = float(payload.get("conversion_rate", 1) or 1)
        record.conversion_rate = max(cr, 0)
    except (TypeError, ValueError):
        return None, "conversion_rate must be a number"

    record.remarks = payload.get("remarks", "")

    # Split-month fields — only set when explicitly provided
    if "is_split" in payload:
        record.is_split = bool(payload["is_split"])
    if "split_month_group" in payload:
        record.split_month_group = payload["split_month_group"] or None
    if "cost_data_source" in payload:
        record.cost_data_source = payload["cost_data_source"] or None
    if "cost_status" in payload:
        record.cost_status = payload["cost_status"] or "manual"

    return record, None


# ── CRUD ─────────────────────────────────────────────────────────────────────

@cost_bp.route("/records", methods=["GET"])
def list_records():
    from_date = request.args.get("from_date")
    to_date   = request.args.get("to_date")

    query = CostRecord.query.order_by(CostRecord.consumption_month.desc())

    if from_date:
        try:
            query = query.filter(
                CostRecord.consumption_month >= datetime.strptime(from_date, "%Y-%m-%d").date()
            )
        except ValueError:
            return jsonify({"error": "Invalid from_date"}), 400

    if to_date:
        try:
            query = query.filter(
                CostRecord.consumption_month <= datetime.strptime(to_date, "%Y-%m-%d").date()
            )
        except ValueError:
            return jsonify({"error": "Invalid to_date"}), 400

    return jsonify([r.to_dict() for r in query.all()]), 200


@cost_bp.route("/records/<int:record_id>", methods=["GET"])
def get_record(record_id):
    record = CostRecord.query.get_or_404(record_id)
    return jsonify(record.to_dict()), 200


@cost_bp.route("/records", methods=["POST"])
def create_record():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "JSON body required"}), 400
    record, err = record_from_payload(payload)
    if err:
        return jsonify({"error": err}), 422
    try:
        db.session.add(record)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify(record.to_dict()), 201


@cost_bp.route("/records/<int:record_id>", methods=["PUT"])
def update_record(record_id):
    record = CostRecord.query.get_or_404(record_id)
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"error": "JSON body required"}), 400
    record, err = record_from_payload(payload, record)
    if err:
        return jsonify({"error": err}), 422
    try:
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify(record.to_dict()), 200


@cost_bp.route("/records/<int:record_id>", methods=["DELETE"])
def delete_record(record_id):
    record = CostRecord.query.get_or_404(record_id)
    try:
        db.session.delete(record)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
    return jsonify({"message": "Deleted successfully"}), 200


# ── Split-month endpoints ─────────────────────────────────────────────────────

@cost_bp.route("/records/<int:record_id>/add-split", methods=["POST"])
def add_split_row(record_id):
    """
    Add a second (or further) payer segment for the same month as an existing record.

    This is used when a management account changed mid-month:
      - record_id  = the FIRST segment (already in DB, payer A portion)
      - POST body  = cost fields for the SECOND segment (payer B portion)

    Steps:
      1. Load the existing record — it becomes segment 1.
      2. Generate or reuse split_month_group UUID.
      3. Mark segment 1 as is_split=True with the shared group UUID.
      4. Create segment 2 with is_split=True and same group UUID.
      5. Return both records.

    Body (same fields as POST /records):
      {
        "cloud_service_cost":   180.00,
        "marketplace_cost":     0.00,
        "cost_data_source":     "222222222222",   ← new payer
        "remarks":              "Jul 15-31 via new payer",
        ... (other cost fields copied from segment 1 if omitted)
      }
    """
    seg1 = CostRecord.query.get_or_404(record_id)
    payload = request.get_json(silent=True) or {}

    # Generate shared group UUID (reuse if seg1 is already split)
    group_id = seg1.split_month_group or str(uuid.uuid4())

    # Mark seg1 as split
    seg1.is_split          = True
    seg1.split_month_group = group_id

    # Build seg2 — inherit all non-cost fields from seg1, override with payload
    seg2 = CostRecord(
        aws_account_id    = seg1.aws_account_id,
        contract_date     = seg1.contract_date,
        consumption_month = seg1.consumption_month,
        # Inherit discount/rate settings from seg1 by default
        distributor_discount  = seg1.distributor_discount,
        customer_discount     = seg1.customer_discount,
        managed_services      = seg1.managed_services,
        conversion_rate       = seg1.conversion_rate,
        credit_amount         = 0,
        cash_claim            = 0,
        redington_credit_note = 0,
        is_auto_fetched       = bool(payload.get("is_auto_fetched", seg1.is_auto_fetched)),
        cost_status           = payload.get("cost_status", "fetched"),
        is_split              = True,
        split_month_group     = group_id,
    )

    # Apply cost values from payload
    for field in ["cloud_service_cost", "marketplace_cost",
                  "credit_amount", "cash_claim", "redington_credit_note"]:
        if field in payload:
            try:
                setattr(seg2, field, float(payload[field]))
            except (TypeError, ValueError):
                return jsonify({"error": f"{field} must be a number"}), 422

    for field in ["distributor_discount", "customer_discount", "managed_services"]:
        if field in payload:
            try:
                v = float(payload[field])
                if v < 0 or v > 100:
                    return jsonify({"error": f"{field} must be 0–100"}), 422
                setattr(seg2, field, v)
            except (TypeError, ValueError):
                return jsonify({"error": f"{field} must be a percentage"}), 422

    if "conversion_rate" in payload:
        try:
            seg2.conversion_rate = max(float(payload["conversion_rate"]), 0)
        except (TypeError, ValueError):
            return jsonify({"error": "conversion_rate must be a number"}), 422

    seg2.cost_data_source = payload.get("cost_data_source") or None
    seg2.remarks          = payload.get("remarks", "")

    try:
        db.session.add(seg2)
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify({
        "message":    f"Split month created for {seg1.consumption_month}. "
                      f"Segment 1 (payer: {seg1.cost_data_source}) + "
                      f"Segment 2 (payer: {seg2.cost_data_source}).",
        "group":      group_id,
        "segment_1":  seg1.to_dict(),
        "segment_2":  seg2.to_dict(),
    }), 201


@cost_bp.route("/records/split-group/<group_id>", methods=["GET"])
def get_split_group(group_id):
    """Return all records that share a split_month_group UUID."""
    records = (
        CostRecord.query
        .filter_by(split_month_group=group_id)
        .order_by(CostRecord.id)
        .all()
    )
    if not records:
        return jsonify({"error": "No records found for this split group"}), 404
    return jsonify([r.to_dict() for r in records]), 200


@cost_bp.route("/records/split-group/<group_id>/merge", methods=["POST"])
def merge_split_group(group_id):
    """
    Merge all split segments back into a single record.
    Sums cloud_service_cost and marketplace_cost across all segments.
    Keeps discount/rate settings from the first segment.
    Deletes all but the first segment, clears split flags.
    """
    records = (
        CostRecord.query
        .filter_by(split_month_group=group_id)
        .order_by(CostRecord.id)
        .all()
    )
    if not records:
        return jsonify({"error": "No records found for this split group"}), 404
    if len(records) == 1:
        return jsonify({"error": "Only one record in this group — nothing to merge"}), 400

    primary = records[0]
    merged_cloud = sum(float(r.cloud_service_cost) for r in records)
    merged_mp    = sum(float(r.marketplace_cost)   for r in records)
    payers       = list({r.cost_data_source for r in records if r.cost_data_source})

    # Update primary
    primary.cloud_service_cost = round(merged_cloud, 4)
    primary.marketplace_cost   = round(merged_mp, 4)
    primary.cost_data_source   = "+".join(sorted(payers))
    primary.cost_status        = "merged"
    primary.is_split           = False
    primary.split_month_group  = None
    primary.remarks            = (primary.remarks or "") + f" [Merged from {len(records)} split segments]"

    # Delete all other segments
    for r in records[1:]:
        db.session.delete(r)

    try:
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500

    return jsonify({
        "message": f"Merged {len(records)} split segments into record {primary.id}.",
        "record":  primary.to_dict(),
    }), 200


# ── Dashboard Summary ─────────────────────────────────────────────────────────

@cost_bp.route("/dashboard/summary", methods=["GET"])
def dashboard_summary():
    from_date = request.args.get("from_date")
    to_date   = request.args.get("to_date")

    query = CostRecord.query

    if from_date:
        try:
            query = query.filter(
                CostRecord.consumption_month >= datetime.strptime(from_date, "%Y-%m-%d").date()
            )
        except ValueError:
            return jsonify({"error": "Invalid from_date"}), 400

    if to_date:
        try:
            query = query.filter(
                CostRecord.consumption_month <= datetime.strptime(to_date, "%Y-%m-%d").date()
            )
        except ValueError:
            return jsonify({"error": "Invalid to_date"}), 400

    records = query.order_by(CostRecord.consumption_month.asc()).all()

    if not records:
        empty = {k: 0 for k in [
            "total_consumption", "cloud_service_cost", "marketplace_cost",
            "ilios_spend", "invoice_to_customer", "ilios_margin", "cash_claim",
            "cloud_service_cost_inr", "marketplace_cost_inr",
            "total_consumption_inr", "ilios_spend_inr",
            "invoice_to_customer_inr", "ilios_margin_inr",
        ]}
        return jsonify({"totals": empty, "monthly_trend": [], "record_count": 0}), 200

    totals = {k: 0.0 for k in [
        "total_consumption", "cloud_service_cost", "marketplace_cost",
        "ilios_spend", "invoice_to_customer", "ilios_margin", "cash_claim",
        "cloud_service_cost_inr", "marketplace_cost_inr",
        "total_consumption_inr", "ilios_spend_inr",
        "invoice_to_customer_inr", "ilios_margin_inr",
    ]}

    # For dashboard monthly trend, collapse split-month rows into a single
    # aggregated entry per (aws_account_id, consumption_month).
    # Use a dict keyed by (aws_account_id, consumption_month_iso).
    from collections import defaultdict
    month_buckets = defaultdict(lambda: {
        "month": None, "month_raw": None,
        "total_consumption": 0, "cloud_service_cost": 0, "marketplace_cost": 0,
        "ilios_spend": 0, "invoice_to_customer": 0, "ilios_margin": 0,
        "cloud_service_cost_inr": 0, "marketplace_cost_inr": 0,
        "total_consumption_inr": 0, "ilios_spend_inr": 0,
        "invoice_to_customer_inr": 0, "ilios_margin_inr": 0,
        "conversion_rate": 1,
    })

    for r in records:
        fx = float(r.conversion_rate)
        totals["total_consumption"]       += r.total_consumption
        totals["cloud_service_cost"]      += float(r.cloud_service_cost)
        totals["marketplace_cost"]        += float(r.marketplace_cost)
        totals["ilios_spend"]             += r.ilios_spend
        totals["invoice_to_customer"]     += r.invoice_to_customer
        totals["ilios_margin"]            += r.ilios_margin
        totals["cash_claim"]              += float(r.cash_claim)
        totals["cloud_service_cost_inr"]  += float(r.cloud_service_cost) * fx
        totals["marketplace_cost_inr"]    += float(r.marketplace_cost) * fx
        totals["total_consumption_inr"]   += r.total_consumption_inr
        totals["ilios_spend_inr"]         += r.ilios_spend_inr
        totals["invoice_to_customer_inr"] += r.invoice_to_customer_inr
        totals["ilios_margin_inr"]        += r.ilios_margin_inr

        bkey = (r.aws_account_id, r.consumption_month.isoformat())
        b = month_buckets[bkey]
        b["month"]                    = r.consumption_month.strftime("%b %Y")
        b["month_raw"]                = r.consumption_month.isoformat()
        b["total_consumption"]       += r.total_consumption
        b["cloud_service_cost"]      += float(r.cloud_service_cost)
        b["marketplace_cost"]        += float(r.marketplace_cost)
        b["ilios_spend"]             += r.ilios_spend
        b["invoice_to_customer"]     += r.invoice_to_customer
        b["ilios_margin"]            += r.ilios_margin
        b["cloud_service_cost_inr"]  += float(r.cloud_service_cost) * fx
        b["marketplace_cost_inr"]    += float(r.marketplace_cost) * fx
        b["total_consumption_inr"]   += r.total_consumption_inr
        b["ilios_spend_inr"]         += r.ilios_spend_inr
        b["invoice_to_customer_inr"] += r.invoice_to_customer_inr
        b["ilios_margin_inr"]        += r.ilios_margin_inr
        b["conversion_rate"]          = fx

    monthly_trend = [
        {
            "month":                     b["month"],
            "consumption_month_raw":     b["month_raw"],
            "total_consumption":         round(b["total_consumption"],         2),
            "cloud_service_cost":        round(b["cloud_service_cost"],        2),
            "marketplace_cost":          round(b["marketplace_cost"],          2),
            "ilios_spend":               round(b["ilios_spend"],               2),
            "invoice_to_customer":       round(b["invoice_to_customer"],       2),
            "ilios_margin":              round(b["ilios_margin"],              2),
            "cloud_service_cost_inr":    round(b["cloud_service_cost_inr"],    2),
            "marketplace_cost_inr":      round(b["marketplace_cost_inr"],      2),
            "total_consumption_inr":     round(b["total_consumption_inr"],     2),
            "ilios_spend_inr":           round(b["ilios_spend_inr"],           2),
            "invoice_to_customer_inr":   round(b["invoice_to_customer_inr"],   2),
            "ilios_margin_inr":          round(b["ilios_margin_inr"],          2),
            "conversion_rate":           b["conversion_rate"],
        }
        for b in sorted(month_buckets.values(), key=lambda x: x["month_raw"])
    ]

    totals = {k: round(v, 2) for k, v in totals.items()}

    return jsonify({
        "totals":        totals,
        "monthly_trend": monthly_trend,
        "record_count":  len(records),
    }), 200


# ── Bulk-update discounts ─────────────────────────────────────────────────────

@cost_bp.route("/records/bulk-update-discounts", methods=["POST"])
def bulk_update_discounts():
    payload = request.get_json(silent=True) or {}

    aws_account_id = payload.get("aws_account_id")
    if not aws_account_id:
        return jsonify({"error": "aws_account_id is required"}), 422

    apply_to = payload.get("apply_to", "all")

    updates = {}
    for field in ["distributor_discount", "customer_discount",
                  "managed_services", "conversion_rate"]:
        val = payload.get(field)
        if val is not None:
            try:
                fval = float(val)
                if field != "conversion_rate" and (fval < 0 or fval > 100):
                    return jsonify({"error": f"{field} must be between 0 and 100"}), 422
                updates[field] = fval
            except (TypeError, ValueError):
                return jsonify({"error": f"{field} must be a number"}), 422

    if not updates:
        return jsonify({"error": "No fields to update provided"}), 422

    try:
        records = CostRecord.query.filter_by(aws_account_id=aws_account_id).all()
        if not records:
            return jsonify({"error": "No records found for this account"}), 404

        updated = 0
        for record in records:
            changed = False
            for field, value in updates.items():
                if apply_to == "zero_only":
                    current = float(getattr(record, field) or 0)
                    if current != 0:
                        continue
                setattr(record, field, value)
                changed = True
            if changed:
                updated += 1

        db.session.commit()
        return jsonify({
            "updated": updated,
            "message": f"Updated {updated} record(s) for account id={aws_account_id}",
        }), 200

    except SQLAlchemyError as exc:
        db.session.rollback()
        return jsonify({"error": f"Database error: {exc}"}), 500
