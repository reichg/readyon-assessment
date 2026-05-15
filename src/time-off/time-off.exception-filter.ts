import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { TimeOffError } from "./time-off.errors";

interface HttpResponseLike {
  status(statusCode: number): {
    json(body: unknown): void;
  };
}

interface ValidationResponseLike {
  message?: unknown;
}

@Catch(TimeOffError, BadRequestException)
export class TimeOffExceptionFilter implements ExceptionFilter {
  catch(
    exception: TimeOffError | BadRequestException,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<HttpResponseLike>();

    if (exception instanceof BadRequestException) {
      const details = getValidationDetails(exception);

      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          ...(details ? { details } : {}),
        },
      });
      return;
    }

    response.status(exception.statusCode).json({
      error: {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      },
    });
  }
}

function getValidationDetails(
  exception: BadRequestException,
): string[] | undefined {
  const response = exception.getResponse();

  if (typeof response !== "object" || response === null) {
    return undefined;
  }

  const message = (response as ValidationResponseLike).message;

  if (!Array.isArray(message)) {
    return undefined;
  }

  const details = message.filter(
    (detail): detail is string => typeof detail === "string",
  );

  return details.length > 0 ? details : undefined;
}
