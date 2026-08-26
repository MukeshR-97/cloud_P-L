-- Run this once to create the database
CREATE DATABASE IF NOT EXISTS cloud_pnl
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cloud_pnl;

-- Tables are also created automatically by SQLAlchemy (db.create_all)
-- but you can also create them manually:

CREATE TABLE IF NOT EXISTS aws_accounts (
    id                    INT           NOT NULL AUTO_INCREMENT,
    name                  VARCHAR(120)  NOT NULL,
    aws_account_id        VARCHAR(20)   NULL,
    access_key_id_enc     TEXT          NOT NULL COMMENT 'Fernet-encrypted IAM access key',
    secret_access_key_enc TEXT          NOT NULL COMMENT 'Fernet-encrypted IAM secret key',
    region                VARCHAR(30)   NOT NULL DEFAULT 'us-east-1',
    contract_date         DATE          NOT NULL,
    is_active             TINYINT(1)    NOT NULL DEFAULT 1,
    created_at            DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cost_records (
    id                   INT           NOT NULL AUTO_INCREMENT,
    aws_account_id       INT           NULL,
    contract_date        DATE          NOT NULL,
    consumption_month    DATE          NOT NULL,
    cloud_service_cost   DECIMAL(18,4) NOT NULL DEFAULT 0,
    marketplace_cost     DECIMAL(18,4) NOT NULL DEFAULT 0,
    distributor_discount DECIMAL(18,4) NOT NULL DEFAULT 0,
    credit_amount        DECIMAL(18,4) NOT NULL DEFAULT 0,
    customer_discount    DECIMAL(18,4) NOT NULL DEFAULT 0,
    managed_services     DECIMAL(18,4) NOT NULL DEFAULT 0,
    cash_claim           DECIMAL(18,4) NOT NULL DEFAULT 0,
    conversion_rate      DECIMAL(10,6) NOT NULL DEFAULT 1,
    redington_credit_note DECIMAL(18,4) NOT NULL DEFAULT 0,
    remarks              TEXT,
    is_auto_fetched      TINYINT(1)    NOT NULL DEFAULT 0,
    created_at           DATETIME      DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_cost_aws_account
        FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
