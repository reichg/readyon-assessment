import type { ApiErrorDetails } from "../http/api-error";

export class TimeOffError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "TimeOffError";
  }
}

export function createBalanceNotFoundError(
  details: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    404,
    "BALANCE_NOT_FOUND",
    "Balance projection was not found.",
    details,
  );
}

export function createInvalidEmployeeLocationError(
  details: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    404,
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
    details,
  );
}

export function createApprovalInvalidEmployeeLocationError(
  details: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    409,
    "INVALID_EMPLOYEE_LOCATION",
    "Employee and location were not found in HCM.",
    details,
  );
}

export function createHcmUnavailableError(
  details?: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    503,
    "HCM_UNAVAILABLE",
    "HCM is temporarily unavailable.",
    details,
  );
}

export function createTimeOffRequestNotFoundError(
  details: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    404,
    "TIME_OFF_REQUEST_NOT_FOUND",
    "Time off request was not found.",
    details,
  );
}

export function createInsufficientBalanceError(
  details?: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    409,
    "INSUFFICIENT_BALANCE",
    "Available balance is insufficient for the requested time off.",
    details,
  );
}

export function createInvalidRequestStateError(
  details?: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    409,
    "INVALID_REQUEST_STATE",
    "Time off request is not in a valid state for this operation.",
    details,
  );
}

export function createIdempotencyKeyConflictError(
  details?: ApiErrorDetails,
): TimeOffError {
  return new TimeOffError(
    409,
    "IDEMPOTENCY_KEY_CONFLICT",
    "Idempotency key was reused with a different request payload.",
    details,
  );
}
