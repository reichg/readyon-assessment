export class TimeOffError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: string[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = "TimeOffError";
  }
}

export function createBalanceNotFoundError(): TimeOffError {
  return new TimeOffError(
    404,
    "BALANCE_NOT_FOUND",
    "Balance projection was not found.",
  );
}

export function createInvalidEmployeeLocationError(): TimeOffError {
  return new TimeOffError(
    404,
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
  );
}

export function createApprovalInvalidEmployeeLocationError(): TimeOffError {
  return new TimeOffError(
    409,
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
  );
}

export function createHcmUnavailableError(): TimeOffError {
  return new TimeOffError(
    503,
    "HCM_UNAVAILABLE",
    "HCM is temporarily unavailable.",
  );
}

export function createTimeOffRequestNotFoundError(): TimeOffError {
  return new TimeOffError(
    404,
    "TIME_OFF_REQUEST_NOT_FOUND",
    "Time off request was not found.",
  );
}

export function createInsufficientBalanceError(): TimeOffError {
  return new TimeOffError(
    409,
    "INSUFFICIENT_BALANCE",
    "Available balance is insufficient for the requested time off.",
  );
}

export function createInvalidRequestStateError(): TimeOffError {
  return new TimeOffError(
    409,
    "INVALID_REQUEST_STATE",
    "Time off request is not in a valid state for this operation.",
  );
}

export function createIdempotencyKeyConflictError(): TimeOffError {
  return new TimeOffError(
    409,
    "IDEMPOTENCY_KEY_CONFLICT",
    "Idempotency key was reused with a different request payload.",
  );
}
