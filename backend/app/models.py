from app import db
from datetime import datetime


# ─────────────────────────────────────────────────────────────────────────────
# AWS Account
# ─────────────────────────────────────────────────────────────────────────────

class AwsAccount(db.Model):
    __tablename__ = "aws_accounts"

    id                     = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name                   = db.Column(db.String(120), nullable=False)
    aws_account_id         = db.Column(db.String(20), nullable=True)
    _access_key_id_enc     = db.Column("access_key_id_enc", db.Text, nullable=False)
    _secret_access_key_enc = db.Column("secret_access_key_enc", db.Text, nullable=False)
    region                 = db.Column(db.String(30), nullable=False, default="us-east-1")
    contract_date          = db.Column(db.Date, nullable=False)
    is_active              = db.Column(db.Boolean, nullable=False, default=True)
    created_at             = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at             = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    cost_records = db.relationship(
        "CostRecord", backref="aws_account", lazy=True,
        foreign_keys="CostRecord.aws_account_id"
    )

    def set_access_key_id(self, plaintext):
        from app.crypto import encrypt
        self._access_key_id_enc = encrypt(plaintext)

    def get_access_key_id(self):
        from app.crypto import decrypt
        return decrypt(self._access_key_id_enc)

    def set_secret_access_key(self, plaintext):
        from app.crypto import encrypt
        self._secret_access_key_enc = encrypt(plaintext)

    def get_secret_access_key(self):
        from app.crypto import decrypt
        return decrypt(self._secret_access_key_enc)

    def masked_access_key(self):
        raw = self.get_access_key_id()
        return (raw[:4] + "*" * (len(raw) - 4)) if raw else "****"

    def to_dict(self):
        return {
            "id":                  self.id,
            "name":                self.name,
            "aws_account_id":      self.aws_account_id,
            "access_key_id_masked":self.masked_access_key(),
            "region":              self.region,
            "contract_date":       self.contract_date.isoformat() if self.contract_date else None,
            "is_active":           self.is_active,
            "created_at":          self.created_at.isoformat() if self.created_at else None,
            "updated_at":          self.updated_at.isoformat() if self.updated_at else None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# Cost Record
# ─────────────────────────────────────────────────────────────────────────────

class CostRecord(db.Model):
    """
    ┌─────────────────────────────────────────────────────────────────────────┐
    │  FORMULAS                                                               │
    ├─────────────────────────────────────────────────────────────────────────┤
    │  total_consumption   = cloud_service_cost + marketplace_cost            │
    │                                                                         │
    │  distributor_disc_amt = cloud_service_cost × (distributor_discount / 100)│
    │    ↑ applies on cloud cost ONLY (not marketplace)                       │
    │                                                                         │
    │  credit_amount        = flat USD  (deducted from cloud cost only)       │
    │                                                                         │
    │  customer_disc_amt    = total_consumption × (customer_discount / 100)   │
    │  managed_services_amt = total_consumption × (managed_services  / 100)   │
    │                                                                         │
    │  ILIOS Spend  = total_consumption                                       │
    │                 − distributor_disc_amt                                  │
    │                 − credit_amount                                         │
    │                 − managed_services_amt                                  │
    │                 − customer_disc_amt                                     │
    │                 − redington_credit_note                                 │
    │                                                                         │
    │  Invoice to Customer = total_consumption                                │
    │                        − customer_disc_amt                              │
    │                        + managed_services_amt                           │
    │                                                                         │
    │  ILIOS Margin = invoice_to_customer − ilios_spend                       │
    │                                                                         │
    │  All USD values × conversion_rate = INR equivalent                      │
    └─────────────────────────────────────────────────────────────────────────┘
    """

    __tablename__ = "cost_records"

    id             = db.Column(db.Integer, primary_key=True, autoincrement=True)
    aws_account_id = db.Column(
        db.Integer, db.ForeignKey("aws_accounts.id", ondelete="SET NULL"),
        nullable=True
    )

    contract_date     = db.Column(db.Date, nullable=False)
    consumption_month = db.Column(db.Date, nullable=False)

    # USD cost inputs
    cloud_service_cost = db.Column(db.Numeric(18, 4), nullable=False, default=0)
    marketplace_cost   = db.Column(db.Numeric(18, 4), nullable=False, default=0)

    # Percentage inputs (stored as 0–100)
    distributor_discount = db.Column(db.Numeric(8, 4), nullable=False, default=0)  # % of cloud cost
    customer_discount    = db.Column(db.Numeric(8, 4), nullable=False, default=0)  # % of total
    managed_services     = db.Column(db.Numeric(8, 4), nullable=False, default=0)  # % of total

    # Flat USD inputs
    credit_amount         = db.Column(db.Numeric(18, 4), nullable=False, default=0)
    cash_claim            = db.Column(db.Numeric(18, 4), nullable=False, default=0)
    redington_credit_note = db.Column(db.Numeric(18, 4), nullable=False, default=0)

    # USD → INR conversion rate
    conversion_rate = db.Column(db.Numeric(10, 4), nullable=False, default=1)

    remarks         = db.Column(db.Text, nullable=True)
    is_auto_fetched = db.Column(db.Boolean, nullable=False, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Computed USD base values ──────────────────────────────────────────────

    @property
    def total_consumption(self):
        return float(self.cloud_service_cost) + float(self.marketplace_cost)

    @property
    def distributor_discount_amt(self):
        """% of cloud_service_cost only — marketplace is excluded."""
        return float(self.cloud_service_cost) * float(self.distributor_discount) / 100.0

    @property
    def customer_discount_amt(self):
        """% of total_consumption."""
        return self.total_consumption * float(self.customer_discount) / 100.0

    @property
    def managed_services_amt(self):
        """% of total_consumption."""
        return self.total_consumption * float(self.managed_services) / 100.0

    # ── Core metrics (USD) ────────────────────────────────────────────────────

    @property
    def ilios_spend(self):
        return (
            self.total_consumption
            - self.distributor_discount_amt     # % of cloud only
            - float(self.credit_amount)         # flat, cloud only
            - self.managed_services_amt         # % of total
            - self.customer_discount_amt        # % of total
            - float(self.redington_credit_note) # flat
        )

    @property
    def invoice_to_customer(self):
        return (
            self.total_consumption
            - self.customer_discount_amt
            + self.managed_services_amt
        )

    @property
    def ilios_margin(self):
        return self.invoice_to_customer - self.ilios_spend

    # ── INR equivalents ───────────────────────────────────────────────────────

    @property
    def fx(self):
        return float(self.conversion_rate)

    @property
    def total_consumption_inr(self):
        return self.total_consumption * self.fx

    @property
    def ilios_spend_inr(self):
        return self.ilios_spend * self.fx

    @property
    def invoice_to_customer_inr(self):
        return self.invoice_to_customer * self.fx

    @property
    def ilios_margin_inr(self):
        return self.ilios_margin * self.fx

    # ── Serialise ─────────────────────────────────────────────────────────────

    def to_dict(self):
        return {
            "id":               self.id,
            "aws_account_id":   self.aws_account_id,
            "aws_account_name": self.aws_account.name if self.aws_account else None,
            "contract_date":    self.contract_date.isoformat() if self.contract_date else None,
            "consumption_month":self.consumption_month.isoformat() if self.consumption_month else None,

            # raw inputs
            "cloud_service_cost":    float(self.cloud_service_cost),
            "marketplace_cost":      float(self.marketplace_cost),
            "distributor_discount":  float(self.distributor_discount),   # %
            "customer_discount":     float(self.customer_discount),      # %
            "managed_services":      float(self.managed_services),       # %
            "credit_amount":         float(self.credit_amount),
            "cash_claim":            float(self.cash_claim),
            "redington_credit_note": float(self.redington_credit_note),
            "conversion_rate":       float(self.conversion_rate),
            "remarks":               self.remarks,
            "is_auto_fetched":       self.is_auto_fetched,

            # derived USD amounts (from %)
            "distributor_discount_amt": round(self.distributor_discount_amt, 4),
            "customer_discount_amt":    round(self.customer_discount_amt,    4),
            "managed_services_amt":     round(self.managed_services_amt,     4),

            # computed USD metrics
            "total_consumption":   round(self.total_consumption,   4),
            "ilios_spend":         round(self.ilios_spend,         4),
            "invoice_to_customer": round(self.invoice_to_customer, 4),
            "ilios_margin":        round(self.ilios_margin,        4),

            # INR equivalents
            "total_consumption_inr":   round(self.total_consumption_inr,   2),
            "ilios_spend_inr":         round(self.ilios_spend_inr,         2),
            "invoice_to_customer_inr": round(self.invoice_to_customer_inr, 2),
            "ilios_margin_inr":        round(self.ilios_margin_inr,        2),

            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
