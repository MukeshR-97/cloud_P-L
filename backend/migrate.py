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
    print("\n✓ db.create_all() completed — all missing tables created.")

    # ── Patch cost_records if it existed before the AWS columns were added ──
    cost_cols = {c["name"] for c in inspector.get_columns("cost_records")} \
        if "cost_records" in existing_tables else set()

    patches = []

    if "aws_account_id" not in cost_cols:
        patches.append(
            "ALTER TABLE cost_records "
            "ADD COLUMN aws_account_id INT NULL, "
            "ADD CONSTRAINT fk_cost_aws_account "
            "FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(id) ON DELETE SET NULL"
        )

    if "is_auto_fetched" not in cost_cols:
        patches.append(
            "ALTER TABLE cost_records "
            "ADD COLUMN is_auto_fetched TINYINT(1) NOT NULL DEFAULT 0"
        )

    if patches:
        with db.engine.connect() as conn:
            for sql in patches:
                print(f"\n→ Running: {sql}")
                conn.execute(text(sql))
            conn.commit()
        print("\n✓ cost_records patched with new columns.")
    else:
        print("✓ cost_records already up to date.")

    print("\n=== Migration complete ===")
