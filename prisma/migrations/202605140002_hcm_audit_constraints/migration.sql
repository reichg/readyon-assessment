PRAGMA foreign_keys=OFF;

CREATE TABLE hcm_transaction_audits_new (
  id TEXT PRIMARY KEY,
  time_off_request_id TEXT NOT NULL,
  external_request_id TEXT NOT NULL UNIQUE,
  hcm_transaction_id TEXT,
  operation TEXT NOT NULL CHECK (operation = 'DEDUCT_TIME_OFF'),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED')),
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR LENGTH(error_message) <= 1024),
  CHECK (
    (status = 'STARTED' AND completed_at IS NULL AND hcm_transaction_id IS NULL AND error_code IS NULL AND error_message IS NULL)
    OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND hcm_transaction_id IS NOT NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL)
  ),
  FOREIGN KEY (time_off_request_id) REFERENCES time_off_requests(id) ON DELETE RESTRICT
);

INSERT INTO hcm_transaction_audits_new (
  id,
  time_off_request_id,
  external_request_id,
  hcm_transaction_id,
  operation,
  status,
  attempted_at,
  completed_at,
  error_code,
  error_message
)
SELECT
  id,
  time_off_request_id,
  external_request_id,
  hcm_transaction_id,
  operation,
  status,
  attempted_at,
  completed_at,
  error_code,
  error_message
FROM hcm_transaction_audits;

DROP TABLE hcm_transaction_audits;

ALTER TABLE hcm_transaction_audits_new RENAME TO hcm_transaction_audits;

CREATE INDEX idx_hcm_transaction_audits_time_off_request_id
  ON hcm_transaction_audits(time_off_request_id);

PRAGMA foreign_keys=ON;