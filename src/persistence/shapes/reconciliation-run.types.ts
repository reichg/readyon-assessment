import type {
  ReconciliationRunStatus,
  TerminalReconciliationRunStatus,
} from "../../reconciliation/shapes/reconciliation-run-status";

export interface ReconciliationRunRecord {
  id: string;
  sourceVersion: string;
  effectiveAt: string;
  receivedCount: number;
  insertedCount: number;
  updatedCount: number;
  ignoredCount: number;
  rejectedCount: number;
  errorCount: number;
  status: ReconciliationRunStatus;
  startedAt: string;
  completedAt: string | null;
}

export interface StartReconciliationRunInput {
  id?: string;
  sourceVersion: string;
  effectiveAt: string;
  receivedCount: number;
  startedAt?: string;
}

export interface CompleteReconciliationRunInput {
  id: string;
  insertedCount: number;
  updatedCount: number;
  ignoredCount: number;
  rejectedCount: number;
  errorCount: number;
  status: TerminalReconciliationRunStatus;
  completedAt?: string;
}
