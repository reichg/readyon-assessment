import type { ApiErrorDetails } from "../http/api-error";

export class ReconciliationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

export function createDuplicateReconciliationRowError(
  duplicateKeys: string[],
): ReconciliationError {
  return new ReconciliationError(
    400,
    "DUPLICATE_RECONCILIATION_ROW",
    "Reconciliation batch contains duplicate employee/location rows.",
    {
      duplicateKeys,
    },
  );
}

export function createStaleSourceVersionError(details: {
  receivedSourceVersion: string;
  receivedEffectiveAt: string;
  latestSourceVersion: string;
  latestEffectiveAt: string;
}): ReconciliationError {
  return new ReconciliationError(
    409,
    "STALE_SOURCE_VERSION",
    "Reconciliation batch is stale compared with the latest applied snapshot.",
    details,
  );
}
