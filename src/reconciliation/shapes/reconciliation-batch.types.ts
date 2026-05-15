export interface ReconciliationBatchBalanceRow {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

export interface ReconciliationBatchInput {
  sourceVersion: string;
  effectiveAt: string;
  balances: ReconciliationBatchBalanceRow[];
}

export interface ReconciliationBatchSummary {
  sourceVersion: string;
  received: number;
  inserted: number;
  updated: number;
  ignored: number;
  rejected: number;
}
