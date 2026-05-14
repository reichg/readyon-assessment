CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  available_days INTEGER NOT NULL CHECK (available_days >= 0),
  source_version TEXT,
  last_synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (employee_id, location_id)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  requested_days INTEGER NOT NULL CHECK (requested_days > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'FAILED')),
  idempotency_key TEXT,
  idempotency_payload_hash TEXT,
  hcm_transaction_id TEXT,
  failure_code TEXT,
  failure_reason TEXT CHECK (failure_reason IS NULL OR LENGTH(failure_reason) <= 1024),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  CHECK (
    (idempotency_key IS NULL AND idempotency_payload_hash IS NULL)
    OR
    (idempotency_key IS NOT NULL AND idempotency_payload_hash IS NOT NULL AND LENGTH(idempotency_payload_hash) > 0)
  ),
  CHECK (
    (status = 'APPROVED' AND approved_at IS NOT NULL AND rejected_at IS NULL)
    OR
    (status = 'REJECTED' AND rejected_at IS NOT NULL AND approved_at IS NULL)
    OR
    (status IN ('PENDING', 'FAILED') AND approved_at IS NULL AND rejected_at IS NULL)
  ),
  CHECK (hcm_transaction_id IS NULL OR status = 'APPROVED'),
  CHECK (status != 'APPROVED' OR hcm_transaction_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_off_requests_idempotency_key
  ON time_off_requests(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS hcm_transaction_audits (
  id TEXT PRIMARY KEY,
  time_off_request_id TEXT NOT NULL,
  external_request_id TEXT NOT NULL UNIQUE,
  hcm_transaction_id TEXT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR LENGTH(error_message) <= 1024),
  FOREIGN KEY (time_off_request_id) REFERENCES time_off_requests(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_hcm_transaction_audits_time_off_request_id
  ON hcm_transaction_audits(time_off_request_id);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY,
  source_version TEXT NOT NULL UNIQUE,
  effective_at TEXT NOT NULL,
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  ignored_count INTEGER NOT NULL DEFAULT 0 CHECK (ignored_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED', 'REJECTED')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (status = 'STARTED' AND completed_at IS NULL)
    OR
    (status IN ('COMPLETED', 'FAILED', 'REJECTED') AND completed_at IS NOT NULL)
  ),
  CHECK (
    inserted_count + updated_count + ignored_count + rejected_count + error_count <= received_count
  )
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_effective_at
  ON reconciliation_runs(effective_at);