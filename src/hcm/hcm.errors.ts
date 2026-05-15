export class HcmClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HcmClientError";
  }
}

export function createInvalidEmployeeLocationHcmError(): HcmClientError {
  return new HcmClientError(
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
  );
}

export function createInsufficientBalanceHcmError(): HcmClientError {
  return new HcmClientError(
    "INSUFFICIENT_BALANCE",
    "Available balance is insufficient for the requested deduction.",
  );
}

export function createHcmUnavailableClientError(): HcmClientError {
  return new HcmClientError(
    "HCM_UNAVAILABLE",
    "HCM is temporarily unavailable.",
  );
}

export function createHcmIdempotencyConflictClientError(): HcmClientError {
  return new HcmClientError(
    "HCM_IDEMPOTENCY_CONFLICT",
    "HCM rejected the approval retry because the external request id payload changed.",
  );
}
