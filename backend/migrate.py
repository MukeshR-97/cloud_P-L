"""
Safe migration script — creates missing tables and adds missing columns.
Run once after pulling new code that adds models or columns.

Usage:
    venv\\Scripts\\activate
    python migrate.py
"""

from app import create_app, db
from sqlalchemy import text, inspect

app = create_app()

with app.app_context():
    inspector = inspect(db.engine)
    existing_tables = inspector.get_table_names()

    print("=== Cloud P&L Migration ===")
    print(f"Connected to: {db.engine.url.host}:{db.engine.url.port}/{db.engine.url.database}")
    print(f"Existing tables: {existing_tables}")

    # Create all missing tables (safe — won't touch tables that already exist)
    db.create_all()
    print("\n[OK] db.create_all() completed — all missing tables created.")

    # ── Helpers ───────────────────────────────────────────────────────────────

    def col_exists(table, col):
        if table not in existing_tables:
            return False
        return col in {c["name"] for c in inspector.get_columns(table)}

    def run_sql(conn, sql, description=""):
        print(f"\n-> Running: {description or sql[:80]}")
        conn.execute(text(sql))

    # ── aws_accounts patches ──────────────────────────────────────────────────
    aws_patches = []

    if not col_exists("aws_accounts", "is_manual"):
        aws_patches.append((
            "ADD is_manual to aws_accounts",
            "ALTER TABLE aws_accounts ADD COLUMN is_manual TINYINT(1) NOT NULL DEFAULT 0"
        ))

    # Make access_key_id_enc nullable (was NOT NULL in older schema)
    # We do this via MODIFY — safe to run even if already nullable
    if col_exists("aws_accounts", "access_key_id_enc"):
        aws_patches.append((
            "Make aws_accounts.access_key_id_enc nullable",
            "ALTER TABLE aws_accounts MODIFY COLUMN access_key_id_enc TEXT NULL"
        ))
    if col_exists("aws_accounts", "secret_access_key_enc"):
        aws_patches.append((
            "Make aws_accounts.secret_access_key_enc nullable",
            "ALTER TABLE aws_accounts MODIFY COLUMN secret_access_key_enc TEXT NULL"
        ))

    # Add UNIQUE constraint on aws_account_id if not present
    # (check via index names — safe to ignore if already exists)
    try:
        idxs = {i["name"] for i in inspector.get_indexes("aws_accounts")}
        if "uq_aws_account_id" not in idxs:
            aws_patches.append((
                "Add UNIQUE index on aws_accounts.aws_account_id",
                "ALTER TABLE aws_accounts ADD CONSTRAINT uq_aws_account_id "
                "UNIQUE (aws_account_id)"
            ))
    except Exception:
        pass  # index inspection not critical

    # ── cost_records patches ──────────────────────────────────────────────────
    cr_patches = []

    if not col_exists("cost_records", "aws_account_id"):
        cr_patches.append((
            "ADD aws_account_id to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN aws_account_id INT NULL, "
            "ADD CONSTRAINT fk_cost_aws_account "
            "FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(id) ON DELETE SET NULL"
        ))

    if not col_exists("cost_records", "is_auto_fetched"):
        cr_patches.append((
            "ADD is_auto_fetched to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN is_auto_fetched TINYINT(1) NOT NULL DEFAULT 0"
        ))

    if not col_exists("cost_records", "cost_data_source"):
        cr_patches.append((
            "ADD cost_data_source to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN cost_data_source VARCHAR(80) NULL"
        ))

    if not col_exists("cost_records", "cost_status"):
        cr_patches.append((
            "ADD cost_status to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN cost_status VARCHAR(20) NOT NULL DEFAULT 'manual'"
        ))

    if not col_exists("cost_records", "is_split"):
        cr_patches.append((
            "ADD is_split to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN is_split TINYINT(1) NOT NULL DEFAULT 0 "
            "COMMENT '1 = part of a split-month pair'"
        ))

    if not col_exists("cost_records", "split_month_group"):
        cr_patches.append((
            "ADD split_month_group to cost_records",
            "ALTER TABLE cost_records "
            "ADD COLUMN split_month_group VARCHAR(36) NULL "
            "COMMENT 'UUID shared by all rows for the same split month'"
        ))

    # ── aws_account_payers — new table ────────────────────────────────────────
    # db.create_all() already handles creation; but also seed existing accounts
    # into the payers table if they have credentials (backward compat migration).

    all_patches = aws_patches + cr_patches

    if all_patches:
        with db.engine.connect() as conn:
            for desc, sql in all_patches:
                try:
                    run_sql(conn, sql, desc)
                except Exception as exc:
                    print(f"   [SKIP] {desc}: {exc}")
            conn.commit()
        print("\n[OK] Schema patches applied.")
    else:
        print("[OK] aws_accounts and cost_records already up to date.")

    # ── Seed aws_account_payers from existing aws_accounts ───────────────────
    # For every existing aws_account that has credentials but no payer row yet,
    # create an active payer entry so the fetch logic works without data loss.
    print("\n-> Seeding aws_account_payers from existing aws_accounts...")

    from app.models import AwsAccount, AwsAccountPayer
    from datetime import date

    seeded = 0
    with db.engine.connect() as conn:
        accounts = AwsAccount.query.all()
        for acc in accounts:
            has_creds = bool(acc._access_key_id_enc and acc._secret_access_key_enc)
            existing_payer = AwsAccountPayer.query.filter_by(
                aws_account_id=acc.id
            ).first()

            if existing_payer is None and has_creds and not acc.is_manual:
                # Determine payer_account_id:
                # For a management account: use its own aws_account_id
                # For a child account without its own payer row: best-effort
                payer_id = (acc.aws_account_id or "").strip() or "unknown"
                payer = AwsAccountPayer(
                    aws_account_id=acc.id,
                    payer_account_id=payer_id,
                    management_account_name=acc.name,
                    _access_key_id_enc=acc._access_key_id_enc,
                    _secret_access_key_enc=acc._secret_access_key_enc,
                    region=acc.region,
                    is_active=True,
                    valid_from=acc.contract_date or date.today(),
                    valid_to=None,
                    remarks="Auto-seeded from legacy aws_accounts record during migration",
                )
                db.session.add(payer)
                seeded += 1

        if seeded:
            db.session.commit()
            print(f"[OK] Seeded {seeded} payer row(s) from existing aws_accounts.")
        else:
            print("[OK] No seeding needed — payer rows already exist or accounts are manual.")

    print("\n=== Migration complete ===")
