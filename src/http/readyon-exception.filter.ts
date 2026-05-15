import {
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { ReconciliationError } from "../reconciliation/reconciliation.errors";
import { TimeOffError } from "../time-off/time-off.errors";
import {
  createApiErrorResponse,
  type ApiErrorBody,
  type ApiErrorDetails,
} from "./api-error";

interface HttpResponseLike {
  status(statusCode: number): {
    json(body: unknown): void;
  };
}

interface ValidationResponseLike {
  message?: unknown;
}

@Catch()
export class ReadyOnExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();

    if (exception instanceof BadRequestException) {
      response.status(HttpStatus.BAD_REQUEST).json(
        createApiErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: getValidationDetails(exception),
        }),
      );

      return;
    }

    if (
      exception instanceof TimeOffError ||
      exception instanceof ReconciliationError
    ) {
      response.status(exception.statusCode).json(
        createApiErrorResponse({
          code: exception.code,
          message: exception.message,
          details: exception.details,
        }),
      );

      return;
    }

    if (exception instanceof HttpException) {
      const httpError = toSafeHttpError(exception);

      response.status(httpError.statusCode).json(
        createApiErrorResponse(httpError.error),
      );

      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      createApiErrorResponse({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      }),
    );
  }
}

function getValidationDetails(
  exception: BadRequestException,
): ApiErrorDetails | undefined {
  const response = exception.getResponse();

  if (typeof response !== "object" || response === null) {
    return undefined;
  }

  const message = (response as ValidationResponseLike).message;

  if (!Array.isArray(message)) {
    return undefined;
  }

  const violations = message.filter(
    (detail): detail is string => typeof detail === "string",
  );

  return violations.length > 0 ? { violations } : undefined;
}

function toSafeHttpError(exception: HttpException): {
  statusCode: number;
  error: ApiErrorBody;
} {
  const statusCode = exception.getStatus();

  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return {
      statusCode,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    };
  }

  switch (statusCode) {
    case HttpStatus.NOT_FOUND:
      return {
        statusCode,
        error: {
          code: "NOT_FOUND",
          message: "Resource was not found.",
        },
      };
    case HttpStatus.FORBIDDEN:
      return {
        statusCode,
        error: {
          code: "FORBIDDEN",
          message: "Request is not allowed.",
        },
      };
    case HttpStatus.UNAUTHORIZED:
      return {
        statusCode,
        error: {
          code: "UNAUTHORIZED",
          message: "Request is not authorized.",
        },
      };
    default:
      return {
        statusCode,
        error: {
          code: "HTTP_EXCEPTION",
          message: "Request could not be completed.",
        },
      };
  }
}
