export type HcmTransactionAuditOperation = "DEDUCT_TIME_OFF";

export type HcmTransactionAuditStatus = "STARTED" | "COMPLETED" | "FAILED";

export type CompletedHcmTransactionAuditStatus = Exclude<
  HcmTransactionAuditStatus,
  "STARTED"
>;

export interface HcmTransactionAuditRecord {
  id: string;
  timeOffRequestId: string;
  externalRequestId: string;
  hcmTransactionId: string | null;
  operation: HcmTransactionAuditOperation;
  status: HcmTransactionAuditStatus;
  attemptedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreateHcmTransactionAuditInput {
  id?: string;
  timeOffRequestId: string;
  externalRequestId: string;
  operation: HcmTransactionAuditOperation;
  status: "STARTED";
  attemptedAt?: string;
}

export interface CompleteHcmTransactionAuditInput {
  id: string;
  status: CompletedHcmTransactionAuditStatus;
  completedAt?: string;
  hcmTransactionId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}
