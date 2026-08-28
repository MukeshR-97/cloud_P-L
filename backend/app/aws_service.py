"""
AWS Cost Explorer — monthly cost fetch using the ACTIVE PAYER's credentials.

PAYER ACCOUNT DESIGN
---------------------
Each aws_account has an active AwsAccountPayer row that holds:
  - payer_account_id  : 12-digit management/payer AWS account ID
  - access_key_id_enc : encrypted IAM access key for that payer
  - secret_access_key_enc : encrypted IAM secret key for that payer

fetch_monthly_costs() reads credentials from the active payer row.
Falls back to legacy credentials on aws_accounts if no payer row exists.

DATA STATUS per month
----------------------
  fetched    – AWS returned valid non-zero cost.
  zero       – AWS confirmed $0 for the month.
  unavailable– AWS returned DataUnavailableException or access error.
               NEVER converted to $0. Caller must preserve existing DB value.

MANAGEMENT ACCOUNT CHANGES
----------------------------
When a child account moves between organizations, the new payer cannot
access historical costs from the old payer. This service returns
"unavailable" for those months. The caller (aws_routes.py) preserves
existing DB values in that case.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import TYPE_CHECKING

import boto3
from botocore.exceptions import BotoCoreError, ClientError

if TYPE_CHECKING:
    from app.models import AwsAccount

log = logging.getLogger(__name__)

_AWS_ENTITIES = {"amazon", "aws"}


def _is_amazon_entity(name: str) -> bool:
    lower = name.strip().lower()
    if lower in ("nolegalentityname", "", "no legal entity name"):
        return True
    return any(kw in lower for kw in _AWS_ENTITIES)


# ── Date helpers ──────────────────────────────────────────────────────────────

def _first_day(d: date) -> date:
    return d.replace(day=1)


def build_date_range(contract_date: date) -> tuple[str, str]:
    start = _first_day(contract_date)
    end   = date.today().replace(day=1)
    if start >= end:
        raise ValueError(
            f"Contract date {contract_date} has no completed months yet "
            f"(current month starts {end})."
        )
    return start.isoformat(), end.isoformat()


def _month_range(start_str: str, end_str: str) -> list[tuple[str, str]]:
    months = []
    cur = date.fromisoformat(start_str)
    end = date.fromisoformat(end_str)
    while cur < end:
        nxt = date(cur.year + 1, 1, 1) if cur.month == 12 else date(cur.year, cur.month + 1, 1)
        months.append((cur.isoformat(), min(nxt, end).isoformat()))
        cur = nxt
    return months


# ── CE query helper ───────────────────────────────────────────────────────────

_DATA_UNAVAIL = "DataUnavailableException"


def _ce_query(ce_client, start: str, end: str,
              ce_filter: dict,
              group_by: list[dict] | None = None) -> list[dict] | None:
    """
    Execute a Cost Explorer GetCostAndUsage query.
    Returns ResultsByTime list on success.
    Returns None (sentinel) on DataUnavailableException.
    Raises ValueError for all other errors.
    """
    kwargs: dict = dict(
        TimePeriod={"Start": start, "End": end},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        Filter=ce_filter,
    )
    if group_by:
        kwargs["GroupBy"] = group_by
    try:
        resp = ce_client.get_cost_and_usage(**kwargs)
        return resp.get("ResultsByTime", [])
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code == _DATA_UNAVAIL:
            log.debug("DataUnavailableException for %s->%s", start, end)
            return None
        raise


def _build_filter(record_type: str, linked_account_id: str | None) -> dict:
    rt_filter = {
        "Dimensions": {
            "Key": "RECORD_TYPE",
            "Values": [record_type],
            "MatchOptions": ["EQUALS"],
        }
    }
    if not linked_account_id:
        return rt_filter
    return {
        "And": [
            rt_filter,
            {
                "Dimensions": {
                    "Key": "LINKED_ACCOUNT",
                    "Values": [linked_account_id],
                    "MatchOptions": ["EQUALS"],
                }
            },
        ]
    }


# ── Per-month fetch ───────────────────────────────────────────────────────────

def _fetch_month(ce_client, m_start: str, m_end: str,
                 linked_account_id: str | None,
                 payer_account_id: str) -> dict:
    """
    Fetch cost data for a single calendar month.

    Returns:
      month              – date (first day of month)
      cloud_service_cost – float
      marketplace_cost   – float
      data_status        – "fetched" | "zero" | "unavailable"
      payer_account_id   – which management account was queried
    """

    def _query(acct_id: str | None) -> tuple[float | None, float | None]:
        c, m = 0.0, 0.0
        usage_filter = _build_filter("Usage", acct_id)

        entity_results = _ce_query(
            ce_client, m_start, m_end,
            ce_filter=usage_filter,
            group_by=[{"Type": "DIMENSION", "Key": "LEGAL_ENTITY_NAME"}],
        )
        if entity_results is None:
            return None, None

        for period in entity_results:
            for group in period.get("Groups", []):
                entity = group["Keys"][0]
                amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
                if amount == 0.0:
                    continue
                if _is_amazon_entity(entity):
                    c += amount
                else:
                    m += amount
                    log.info("[Marketplace] %s  entity=%-30s  $%.4f",
                             m_start[:7], entity, amount)

        rf_results = _ce_query(
            ce_client, m_start, m_end,
            ce_filter=_build_filter("Recurring Fee", acct_id),
        )
        if rf_results:
            for period in rf_results:
                amt = float(period.get("Total", {})
                            .get("UnblendedCost", {})
                            .get("Amount", "0"))
                if amt > 0:
                    m += amt
        return c, m

    # Attempt 1: with LINKED_ACCOUNT filter
    if linked_account_id:
        cloud, mp = _query(linked_account_id)
        if cloud is None:
            log.debug("[%s] linked filter unavailable, retrying without filter", m_start[:7])
            cloud, mp = _query(None)
            if cloud is None:
                log.warning("[Unavailable] %s  payer=%s", m_start[:7], payer_account_id)
                return {
                    "month": _first_day(date.fromisoformat(m_start)),
                    "cloud_service_cost": 0.0,
                    "marketplace_cost": 0.0,
                    "data_status": "unavailable",
                    "payer_account_id": payer_account_id,
                }
    else:
        cloud, mp = _query(None)
        if cloud is None:
            log.warning("[Unavailable] %s  payer=%s", m_start[:7], payer_account_id)
            return {
                "month": _first_day(date.fromisoformat(m_start)),
                "cloud_service_cost": 0.0,
                "marketplace_cost": 0.0,
                "data_status": "unavailable",
                "payer_account_id": payer_account_id,
            }

    cloud = round(cloud, 4)
    mp    = round(mp, 4)
    status = "fetched" if (cloud > 0 or mp > 0) else "zero"

    log.info("[%s] %s  cloud=$%.2f  mp=$%.2f  payer=%s",
             status.capitalize(), m_start[:7], cloud, mp, payer_account_id)

    return {
        "month": _first_day(date.fromisoformat(m_start)),
        "cloud_service_cost": cloud,
        "marketplace_cost": mp,
        "data_status": status,
        "payer_account_id": payer_account_id,
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def fetch_monthly_costs(account: "AwsAccount") -> list[dict]:
    """
    Fetch monthly costs for every month from contract_date through last month.

    Credential source (priority order):
      1. account.active_payer  (AwsAccountPayer row with is_active=True)
      2. account legacy columns (backward compat for accounts without payer rows)

    The payer_account_id stored on each result row becomes cost_data_source
    on the CostRecord — identifying WHICH management account supplied that cost.

    Returns a list of dicts, one per month:
      {
        "month":              date,
        "cloud_service_cost": float,   # 0.0 when unavailable/zero
        "marketplace_cost":   float,
        "data_status":        "fetched" | "zero" | "unavailable",
        "payer_account_id":   str,     # 12-digit management account ID
      }

    IMPORTANT: data_status == "unavailable" means the current payer cannot see
    that month. The caller MUST NOT write 0.0 over existing DB records.
    """
    # ── Resolve credentials from active payer or legacy columns ──────────────
    active_payer = account.active_payer

    if active_payer:
        access_key       = active_payer.get_access_key_id()
        secret_key       = active_payer.get_secret_access_key()
        payer_account_id = active_payer.payer_account_id
        region           = active_payer.region or "us-east-1"
        log.info(
            "[Fetch] account=%s  using active payer=%s  region=%s",
            account.name, payer_account_id, region,
        )
    else:
        # Fallback to legacy credentials on aws_accounts
        access_key       = account.get_access_key_id()
        secret_key       = account.get_secret_access_key()
        payer_account_id = (account.aws_account_id or "").strip() or "unknown"
        region           = account.region or "us-east-1"
        log.info(
            "[Fetch] account=%s  using legacy credentials  payer=%s",
            account.name, payer_account_id,
        )

    if not access_key or not secret_key:
        raise ValueError(
            f"No credentials found for account '{account.name}'. "
            "Add a management account with IAM credentials first."
        )

    # ── The member account ID to filter Cost Explorer by ─────────────────────
    # This is the child/member account's own 12-digit ID, not the payer's.
    linked_account_id = (account.aws_account_id or "").strip() or None

    start_str, end_str = build_date_range(account.contract_date)

    log.info(
        "[Fetch Start] account=%s  member=%s  payer=%s  range=%s -> %s",
        account.name,
        linked_account_id or "all",
        payer_account_id,
        start_str,
        end_str,
    )

    try:
        session = boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )
        ce = session.client("ce")
    except (ClientError, BotoCoreError) as exc:
        raise ValueError(f"AWS connection error: {exc}") from exc
    finally:
        access_key = None
        secret_key = None

    results: list[dict] = []
    for m_start, m_end in _month_range(start_str, end_str):
        try:
            row = _fetch_month(ce, m_start, m_end, linked_account_id, payer_account_id)
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            msg  = exc.response["Error"]["Message"]
            raise ValueError(f"AWS API error [{code}]: {msg}") from exc
        except BotoCoreError as exc:
            raise ValueError(f"AWS connection error: {exc}") from exc
        results.append(row)

    fetched = sum(1 for r in results if r["data_status"] == "fetched")
    zeros   = sum(1 for r in results if r["data_status"] == "zero")
    unavail = sum(1 for r in results if r["data_status"] == "unavailable")
    log.info(
        "[Fetch Done] account=%s  fetched=%d  zero=%d  unavailable=%d",
        account.name, fetched, zeros, unavail,
    )
    return results
