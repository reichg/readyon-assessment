import type { MockHcmErrorCode } from "./shapes/mock-hcm.types";

export class MockHcmError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: MockHcmErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "MockHcmError";
  }
}

export function createValidationError(message: string): MockHcmError {
  return new MockHcmError(400, "VALIDATION_ERROR", message);
}

export function createInvalidEmployeeLocationError(): MockHcmError {
  return new MockHcmError(
    404,
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
  );
}

export function createInsufficientBalanceError(): MockHcmError {
  return new MockHcmError(
    409,
    "INSUFFICIENT_BALANCE",
    "Available balance is insufficient for the requested deduction.",
  );
}

export function createHcmUnavailableError(): MockHcmError {
  return new MockHcmError(
    503,
    "HCM_UNAVAILABLE",
    "Mock HCM is temporarily unavailable.",
    true,
  );
}

export function createIdempotencyConflictError(): MockHcmError {
  return new MockHcmError(
    409,
    "IDEMPOTENCY_KEY_CONFLICT",
    "External request id was reused with a different payload.",
  );
}
