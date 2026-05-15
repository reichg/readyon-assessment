export interface HcmTimeOffSubmissionInput {
  employeeId: string;
  locationId: string;
  days: number;
  externalRequestId: string;
}

export interface HcmTimeOffSubmissionResult {
  externalRequestId: string;
  hcmTransactionId: string;
  remainingAvailableDays: number;
  processedAt: string;
}
