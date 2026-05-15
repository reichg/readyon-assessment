export type MockHcmErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_EMPLOYEE_LOCATION"
  | "INSUFFICIENT_BALANCE"
  | "HCM_UNAVAILABLE"
  | "IDEMPOTENCY_KEY_CONFLICT";

export type MockHcmOperation =
  | "GET_BALANCE"
  | "SUBMIT_TIME_OFF"
  | "ADJUST_BALANCE"
  | "GET_BATCH_SNAPSHOT";

export interface MockHcmBalanceKey {
  employeeId: string;
  locationId: string;
}

export interface MockHcmBalanceRecord extends MockHcmBalanceKey {
  availableDays: number;
}

export interface MockHcmTimeOffInput extends MockHcmBalanceKey {
  days: number;
  externalRequestId: string;
}

export interface MockHcmTimeOffResult {
  externalRequestId: string;
  hcmTransactionId: string;
  remainingAvailableDays: number;
  processedAt: string;
}

export interface MockHcmAdjustBalanceInput extends MockHcmBalanceKey {
  deltaDays: number;
}

export interface MockHcmBatchSnapshot {
  sourceVersion: string;
  effectiveAt: string;
  balances: MockHcmBalanceRecord[];
}

export interface MockHcmSeedState {
  balances: MockHcmBalanceRecord[];
  sourceVersion?: string;
  effectiveAt?: string;
}
