import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  type ArgumentsHost,
} from "@nestjs/common";
import { ReadyOnExceptionFilter } from "../../src/http/readyon-exception.filter";
import { ReconciliationError } from "../../src/reconciliation/reconciliation.errors";
import { TimeOffError } from "../../src/time-off/time-off.errors";

describe("ReadyOnExceptionFilter", () => {
  let filter: ReadyOnExceptionFilter;

  beforeEach(() => {
    filter = new ReadyOnExceptionFilter();
  });

  it("maps validation failures with string violations", () => {
    const host = createHost();

    filter.catch(
      new BadRequestException({
        message: ["employeeId must be a string", 123, "locationId is required"],
      }),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: {
            violations: [
              "employeeId must be a string",
              "locationId is required",
            ],
          },
        },
      },
    });
  });

  it("maps validation failures without details when the payload has no array message", () => {
    const host = createHost();

    filter.catch(
      new BadRequestException("Request validation failed."),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
        },
      },
    });
  });

  it("maps time-off domain errors directly", () => {
    const host = createHost();

    filter.catch(
      new TimeOffError(
        409,
        "INSUFFICIENT_BALANCE",
        "Available balance is insufficient.",
        {
          availableDays: 1,
        },
      ),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 409,
      body: {
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: "Available balance is insufficient.",
          details: {
            availableDays: 1,
          },
        },
      },
    });
  });

  it("maps reconciliation domain errors directly", () => {
    const host = createHost();

    filter.catch(
      new ReconciliationError(409, "STALE_SOURCE_VERSION", "Batch is stale.", {
        latestSourceVersion: "batch_2026_010",
      }),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 409,
      body: {
        error: {
          code: "STALE_SOURCE_VERSION",
          message: "Batch is stale.",
          details: {
            latestSourceVersion: "batch_2026_010",
          },
        },
      },
    });
  });

  it("maps not-found HttpExceptions to a safe error code", () => {
    const host = createHost();

    filter.catch(new NotFoundException("Nope"), host.argumentsHost);

    expect(host.result).toEqual({
      statusCode: 404,
      body: {
        error: {
          code: "NOT_FOUND",
          message: "Resource was not found.",
        },
      },
    });
  });

  it("maps forbidden HttpExceptions to a safe error code", () => {
    const host = createHost();

    filter.catch(new ForbiddenException("Nope"), host.argumentsHost);

    expect(host.result).toEqual({
      statusCode: 403,
      body: {
        error: {
          code: "FORBIDDEN",
          message: "Request is not allowed.",
        },
      },
    });
  });

  it("maps unauthorized HttpExceptions to a safe error code", () => {
    const host = createHost();

    filter.catch(new UnauthorizedException("Nope"), host.argumentsHost);

    expect(host.result).toEqual({
      statusCode: 401,
      body: {
        error: {
          code: "UNAUTHORIZED",
          message: "Request is not authorized.",
        },
      },
    });
  });

  it("maps other client HttpExceptions to a generic safe code", () => {
    const host = createHost();

    filter.catch(
      new HttpException("Conflict", HttpStatus.CONFLICT),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 409,
      body: {
        error: {
          code: "HTTP_EXCEPTION",
          message: "Request could not be completed.",
        },
      },
    });
  });

  it("preserves 5xx HttpException status codes while hiding unsafe details", () => {
    const host = createHost();

    filter.catch(
      new HttpException("Database exploded", HttpStatus.SERVICE_UNAVAILABLE),
      host.argumentsHost,
    );

    expect(host.result).toEqual({
      statusCode: 503,
      body: {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
        },
      },
    });
  });

  it("maps unknown exceptions to a generic internal server error", () => {
    const host = createHost();

    filter.catch(new Error("secret driver detail"), host.argumentsHost);

    expect(host.result).toEqual({
      statusCode: 500,
      body: {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
        },
      },
    });
  });
});

function createHost(): {
  argumentsHost: ArgumentsHost;
  result: {
    statusCode: number | undefined;
    body: unknown;
  };
} {
  const result: {
    statusCode: number | undefined;
    body: unknown;
  } = {
    statusCode: undefined,
    body: undefined,
  };

  const response = {
    status: jest.fn().mockImplementation((statusCode: number) => {
      result.statusCode = statusCode;

      return {
        json: jest.fn().mockImplementation((body: unknown) => {
          result.body = body;
        }),
      };
    }),
  };

  return {
    argumentsHost: {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as ArgumentsHost,
    result,
  };
}
