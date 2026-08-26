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

    contract_date, err = parse_date(payload.get("contract_date"), "contract_date")
    if err:
        return None, err
    consumption_month, err = parse_date(payload.get("consumption_month"), "consumption_month")
    if err:
        return None, err

    record.contract_date     = contract_date
    record.consumption_month = consumption_month

    # USD flat cost inputs
    usd_fields = ["cloud_service_cost", "marketplace_cost",
                  "credit_amount", "cash_claim", "redington_credit_note"]
    for field in usd_fields:
        raw = payload.get(field, 0)
        try:
            setattr(record, field, float(raw))
        except (TypeError, ValueError):
            return None, f"{field} must be a number"

    # Percentage inputs (stored as 0–100 float)
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

    # Conversion rate
    try:
        cr = float(payload.get("conversion_rate", 1) or 1)
        record.conversion_rate = max(cr, 0)
    except (TypeError, ValueError):
        return None, "conversion_rate must be a number"

    record.remarks = payload.get("remarks", "")
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
    db.session.delete(record)
    db.session.commit()
    return jsonify({"message": "Deleted successfully"}), 200


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
            "total_consumption_inr", "ilios_spend_inr",
            "invoice_to_customer_inr", "ilios_margin_inr",
        ]}
        return jsonify({"totals": empty, "monthly_trend": [], "record_count": 0}), 200

    totals = {k: 0.0 for k in [
        "total_consumption", "cloud_service_cost", "marketplace_cost",
        "ilios_spend", "invoice_to_customer", "ilios_margin", "cash_claim",
        "total_consumption_inr", "ilios_spend_inr",
        "invoice_to_customer_inr", "ilios_margin_inr",
    ]}

    monthly_trend = []

    for r in records:
        totals["total_consumption"]       += r.total_consumption
        totals["cloud_service_cost"]      += float(r.cloud_service_cost)
        totals["marketplace_cost"]        += float(r.marketplace_cost)
        totals["ilios_spend"]             += r.ilios_spend
        totals["invoice_to_customer"]     += r.invoice_to_customer
        totals["ilios_margin"]            += r.ilios_margin
        totals["cash_claim"]              += float(r.cash_claim)
        totals["total_consumption_inr"]   += r.total_consumption_inr
        totals["ilios_spend_inr"]         += r.ilios_spend_inr
        totals["invoice_to_customer_inr"] += r.invoice_to_customer_inr
        totals["ilios_margin_inr"]        += r.ilios_margin_inr

        monthly_trend.append({
            "month":                   r.consumption_month.strftime("%b %Y"),
            "consumption_month_raw":   r.consumption_month.isoformat(),
            "total_consumption":       round(r.total_consumption, 2),
            "cloud_service_cost":      round(float(r.cloud_service_cost), 2),
            "marketplace_cost":        round(float(r.marketplace_cost), 2),
            "ilios_spend":             round(r.ilios_spend, 2),
            "invoice_to_customer":     round(r.invoice_to_customer, 2),
            "ilios_margin":            round(r.ilios_margin, 2),
            # INR
            "total_consumption_inr":   round(r.total_consumption_inr, 2),
            "ilios_spend_inr":         round(r.ilios_spend_inr, 2),
            "invoice_to_customer_inr": round(r.invoice_to_customer_inr, 2),
            "ilios_margin_inr":        round(r.ilios_margin_inr, 2),
            "conversion_rate":         float(r.conversion_rate),
        })

    totals = {k: round(v, 2) for k, v in totals.items()}

    return jsonify({
        "totals":        totals,
        "monthly_trend": monthly_trend,
        "record_count":  len(records),
    }), 200


# ── Master bulk-update discounts for an account ───────────────────────────────

@cost_bp.route("/records/bulk-update-discounts", methods=["POST"])
def bulk_update_discounts():
    """
    Apply distributor_discount, customer_discount, managed_services (all %)
    and/or conversion_rate to ALL records belonging to an AWS account.

    Body:
      {
        "aws_account_id": 1,           // required — DB id of the AwsAccount
        "distributor_discount": 8.0,   // % — optional, null = skip
        "customer_discount":    5.0,   // % — optional
        "managed_services":     10.0,  // % — optional
        "conversion_rate":      84.5,  // optional
        "apply_to": "all"              // "all" | "zero_only" (only rows where field is 0)
      }

    Returns: { updated: <count>, message: "..." }
    """
    payload = request.get_json(silent=True) or {}

    aws_account_id = payload.get("aws_account_id")
    if not aws_account_id:
        return jsonify({"error": "aws_account_id is required"}), 422

    apply_to = payload.get("apply_to", "all")   # "all" or "zero_only"

    # Which fields to update
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
        query = CostRecord.query.filter_by(aws_account_id=aws_account_id)
        records = query.all()

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
