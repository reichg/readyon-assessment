export type ApiErrorDetails = Record<string, unknown>;

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetails;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

export function createApiErrorResponse(
  input: ApiErrorBody,
): ApiErrorResponse {
  return {
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: input.details } : {}),
    },
  };
}
