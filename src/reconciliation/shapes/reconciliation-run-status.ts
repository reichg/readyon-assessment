export const RECONCILIATION_RUN_STATUSES = [
  "STARTED",
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const;

export const TERMINAL_RECONCILIATION_RUN_STATUSES = [
  "COMPLETED",
  "FAILED",
  "REJECTED",
] as const;

export type ReconciliationRunStatus =
  (typeof RECONCILIATION_RUN_STATUSES)[number];

export type TerminalReconciliationRunStatus =
  (typeof TERMINAL_RECONCILIATION_RUN_STATUSES)[number];
