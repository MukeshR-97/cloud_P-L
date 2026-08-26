"""
AWS Cost Explorer integration.

Split logic:
  SERVICE × LEGAL_ENTITY_NAME grouped query splits costs into:
    - cloud_service_cost : billed by Amazon/AWS entities
    - marketplace_cost   : billed by third-party entities (e.g. Anthropic, PBC)

  DataUnavailableException handling:
    - The LEGAL_ENTITY_NAME dimension is only available from a certain date.
    - For months where it's unavailable, all costs fall into cloud_service_cost.
    - The SERVICE-only query always works and gives us totals for every month.
    - We do the entity split only on months where the data is available.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import TYPE_CHECKING

import boto3
from botocore.exceptions import BotoCoreError, ClientError

if TYPE_CHECKING:
    from app.models import AwsAccount

log = logging.getLogger(__name__)

# Legal entity substrings that mean "standard AWS charge"
AWS_ENTITIES = {"amazon", "aws"}

# Service names to exclude from all cost buckets (exact match, case-insensitive)
# Tax is a billing line item, not an actual service consumption cost.
EXCLUDED_SERVICES = {
    "tax",
}


def _is_excluded_service(service_name: str) -> bool:
    """Return True for service lines that should NOT count as cloud or marketplace cost."""
    return service_name.strip().lower() in EXCLUDED_SERVICES


def _is_amazon_entity(entity_name: str) -> bool:
    lower = entity_name.strip().lower()
    if lower in ("nolegalentityname", "", "no legal entity name"):
        return True
    return any(kw in lower for kw in AWS_ENTITIES)


# ── Date helpers ──────────────────────────────────────────────────────────────

def _first_day(d: date) -> date:
    return d.replace(day=1)


def build_date_range(contract_date: date) -> tuple[str, str]:
    start = _first_day(contract_date)
    end   = date.today().replace(day=1)   # exclusive upper bound
    if start >= end:
        raise ValueError(
            f"Contract date {contract_date} has no completed months yet "
            f"(current month starts {end})."
        )
    return start.isoformat(), end.isoformat()


def _month_range(start_str: str, end_str: str) -> list[tuple[str, str]]:
    """Return list of (month_start, month_end) pairs between start and end."""
    months = []
    cur = date.fromisoformat(start_str)
    end = date.fromisoformat(end_str)
    while cur < end:
        # next month
        if cur.month == 12:
            nxt = date(cur.year + 1, 1, 1)
        else:
            nxt = date(cur.year, cur.month + 1, 1)
        months.append((cur.isoformat(), min(nxt, end).isoformat()))
        cur = nxt
    return months


# ── CE query helper ───────────────────────────────────────────────────────────

def _query_ce(ce_client, start: str, end: str,
              group_by: list[dict],
              ce_filter: dict | None = None) -> list[dict] | None:
    """
    Run a paged Cost Explorer query.
    Returns ResultsByTime list, or None if DataUnavailableException is raised.
    All other ClientErrors are re-raised.
    """
    kwargs = dict(
        TimePeriod={"Start": start, "End": end},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=group_by,
    )
    if ce_filter:
        kwargs["Filter"] = ce_filter
    results = []
    token = None
    while True:
        if token:
            kwargs["NextPageToken"] = token
        try:
            resp = ce_client.get_cost_and_usage(**kwargs)
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code == "DataUnavailableException":
                log.debug("DataUnavailableException for %s→%s, skipping.", start, end)
                return None
            raise
        results.extend(resp.get("ResultsByTime", []))
        token = resp.get("NextPageToken")
        if not token:
            break
    return results


# ── Main fetch ────────────────────────────────────────────────────────────────

def fetch_monthly_costs(account: "AwsAccount") -> list[dict]:
    """
    Fetch monthly unblended costs and split into cloud vs marketplace.

    Returns list sorted chronologically:
    [
        {
            "month":              date(2026, 7, 1),
            "cloud_service_cost": 354.65,
            "marketplace_cost":     0.08,
            "services": [
                {"name": "...", "amount": ..., "is_marketplace": bool, "entity": "..."},
                ...
            ]
        },
        ...
    ]
    """
    access_key = account.get_access_key_id()
    secret_key = account.get_secret_access_key()
    start_str, end_str = build_date_range(account.contract_date)

    log.info("Fetching costs: account=%s  %s → %s", account.name, start_str, end_str)

    try:
        session = boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="us-east-1",
        )
        ce = session.client("ce")

        # ── Step 1: SERVICE query for full range (always works) ───────────────
        # If a linked_account_id is set, filter to only that account's costs.
        # This is used when the IAM credentials belong to the management/payer
        # account but we want costs for a specific member account.
        ce_filter = None
        if account.aws_account_id:
            ce_filter = {
                "Dimensions": {
                    "Key": "LINKED_ACCOUNT",
                    "Values": [account.aws_account_id],
                    "MatchOptions": ["EQUALS"],
                }
            }
            log.info("Filtering by LINKED_ACCOUNT=%s", account.aws_account_id)

        service_periods = _query_ce(
            ce, start_str, end_str,
            group_by=[{"Type": "DIMENSION", "Key": "SERVICE"}],
            ce_filter=ce_filter,
        )
        if service_periods is None:
            # DataUnavailableException on the full range — try shrinking to
            # only months that have data by querying month-by-month
            log.warning(
                "SERVICE query returned no data for full range %s→%s, "
                "trying month-by-month fallback.",
                start_str, end_str,
            )
            service_periods = []
            for m_start, m_end in _month_range(start_str, end_str):
                result = _query_ce(
                    ce, m_start, m_end,
                    group_by=[{"Type": "DIMENSION", "Key": "SERVICE"}],
                    ce_filter=ce_filter,
                )
                if result is not None:
                    service_periods.extend(result)
                else:
                    log.debug("No data for month %s, skipping.", m_start)

            if not service_periods:
                raise ValueError(
                    f"AWS Cost Explorer returned $0 for all months in "
                    f"{start_str} → {end_str} for account '{account.name}'.\n\n"
                    f"Possible reasons:\n"
                    f"  • This account has no AWS spend (it may be a linked/sub-account)\n"
                    f"  • Cost Explorer is not enabled — enable it at "
                    f"https://console.aws.amazon.com/cost-management/home\n"
                    f"  • Billing data is in the management (payer) account, not this one\n"
                    f"  • Cost Explorer data takes up to 24h to appear after first enabling"
                )

        # ── Step 2: SERVICE × LEGAL_ENTITY_NAME — month by month ─────────────
        # We query month-by-month so that months with no entity data are skipped
        # gracefully instead of failing the whole fetch.
        svc_entity_by_month: dict[date, list[dict]] = {}

        for m_start, m_end in _month_range(start_str, end_str):
            result = _query_ce(
                ce, m_start, m_end,
                group_by=[
                    {"Type": "DIMENSION", "Key": "SERVICE"},
                    {"Type": "DIMENSION", "Key": "LEGAL_ENTITY_NAME"},
                ],
                ce_filter=ce_filter,
            )
            if result is not None:
                mk = _first_day(date.fromisoformat(m_start))
                svc_entity_by_month[mk] = []
                for period in result:
                    svc_entity_by_month[mk].extend(period.get("Groups", []))

    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        msg  = exc.response["Error"]["Message"]
        raise ValueError(f"AWS API error [{code}]: {msg}") from exc
    except BotoCoreError as exc:
        raise ValueError(f"AWS connection error: {exc}") from exc
    finally:
        access_key = None
        secret_key = None

    # ── Build monthly buckets from SERVICE query ──────────────────────────────
    monthly: dict[date, dict] = {}

    for period in service_periods:
        mk = _first_day(date.fromisoformat(period["TimePeriod"]["Start"]))
        if mk not in monthly:
            monthly[mk] = {
                "month":              mk,
                "cloud_service_cost": 0.0,
                "marketplace_cost":   0.0,
                "services":           {},
            }
        bucket = monthly[mk]

        for group in period.get("Groups", []):
            svc    = group["Keys"][0]
            amount = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if amount == 0.0:
                continue
            # Skip tax — not a consumption cost
            if _is_excluded_service(svc):
                log.debug("  [%s] EXCLUDED (tax) %-50s  $%.4f", mk, svc, amount)
                continue
            # Default: treat as cloud; entity query below will correct if needed
            bucket["cloud_service_cost"] += amount
            bucket["services"][svc] = {
                "amount":         round(amount, 4),
                "is_marketplace": False,
                "entity":         "",
            }

    # ── Overlay entity data where available ───────────────────────────────────
    # For months that have entity data, recalculate the cloud/mp split
    for mk, groups in svc_entity_by_month.items():
        if mk not in monthly:
            continue
        bucket = monthly[mk]

        # Reset and recompute from entity data
        bucket["cloud_service_cost"] = 0.0
        bucket["marketplace_cost"]   = 0.0

        # Accumulate per service × entity
        svc_entity_map: dict[str, dict] = {}
        for group in groups:
            svc_name    = group["Keys"][0]
            entity_name = group["Keys"][1]
            amount      = float(group["Metrics"]["UnblendedCost"]["Amount"])
            if amount == 0.0:
                continue
            # Skip tax — not a consumption cost
            if _is_excluded_service(svc_name):
                log.debug("  [%s] EXCLUDED (tax) %-50s  $%.4f", mk, svc_name, amount)
                continue

            is_mp = not _is_amazon_entity(entity_name)
            if svc_name not in svc_entity_map:
                svc_entity_map[svc_name] = {
                    "amount":         0.0,
                    "is_marketplace": is_mp,
                    "entity":         entity_name,
                }
            svc_entity_map[svc_name]["amount"] += amount
            if is_mp:
                svc_entity_map[svc_name]["is_marketplace"] = True
                svc_entity_map[svc_name]["entity"]         = entity_name

            if is_mp:
                bucket["marketplace_cost"]   += amount
                log.info("  [%s] MARKETPLACE  %-50s  %-25s  $%.4f",
                         mk, svc_name, entity_name, amount)
            else:
                bucket["cloud_service_cost"] += amount

        # Update services dict with entity info
        for svc, info in svc_entity_map.items():
            if svc in bucket["services"]:
                bucket["services"][svc].update(info)
            else:
                bucket["services"][svc] = {
                    "amount":         round(info["amount"], 4),
                    "is_marketplace": info["is_marketplace"],
                    "entity":         info["entity"],
                }

    # ── Finalise ──────────────────────────────────────────────────────────────
    for bucket in monthly.values():
        bucket["cloud_service_cost"] = round(bucket["cloud_service_cost"], 4)
        bucket["marketplace_cost"]   = round(bucket["marketplace_cost"],   4)
        for svc in bucket["services"].values():
            svc["amount"] = round(svc["amount"], 4)

        log.info(
            "  %s  cloud=$%.2f  marketplace=$%.2f  total=$%.2f  entity_data=%s",
            bucket["month"],
            bucket["cloud_service_cost"],
            bucket["marketplace_cost"],
            bucket["cloud_service_cost"] + bucket["marketplace_cost"],
            "yes" if bucket["month"] in svc_entity_by_month else "no (fallback)"
        )

    return sorted(monthly.values(), key=lambda r: r["month"])
