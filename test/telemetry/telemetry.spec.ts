import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { HttpTelemetryInterceptor } from "../../src/telemetry/http-telemetry.interceptor";
import { RequestContextService } from "../../src/telemetry/request-context.service";
import { TelemetryService } from "../../src/telemetry/telemetry.service";

const TRUSTED_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_TRUSTED_REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class HealthControllerMock {}

function getHealthMock(): void {}

function createExecutionContext(options?: {
  type?: string;
  requestHeaders?: Record<string, string | string[] | undefined>;
  requestMethod?: string;
  baseUrl?: string;
  routePath?: string;
  statusCode?: number;
}): {
  context: ExecutionContext;
  response: {
    setHeader: jest.Mock;
    statusCode?: number;
  };
} {
  const response = {
    setHeader: jest.fn(),
    statusCode: options?.statusCode,
  };

  const request = {
    headers: options?.requestHeaders,
    method: options?.requestMethod ?? "GET",
    baseUrl: options?.baseUrl,
    route:
      options?.routePath === undefined
        ? undefined
        : {
            path: options.routePath,
          },
  };

  return {
    context: {
      getType: jest.fn().mockReturnValue(options?.type ?? "http"),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getClass: () => HealthControllerMock,
      getHandler: () => getHealthMock,
    } as unknown as ExecutionContext,
    response,
  };
}

function createCallHandler(
  implementation: () => ReturnType<CallHandler["handle"]>,
): CallHandler {
  return {
    handle: jest.fn(implementation),
  } as unknown as CallHandler;
}

function createRequestContextServiceMock(): RequestContextService {
  return {
    run: jest.fn((_requestId: string, callback: () => unknown) => callback()),
    getRequestId: jest.fn(),
  } as unknown as RequestContextService;
}

function createTelemetryServiceMock(): TelemetryService {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as TelemetryService;
}

describe("HttpTelemetryInterceptor", () => {
  it("returns non-http calls without emitting telemetry", async () => {
    const requestContextService = createRequestContextServiceMock();
    const telemetryService = createTelemetryServiceMock();
    const interceptor = new HttpTelemetryInterceptor(
      requestContextService,
      telemetryService,
    );
    const { context } = createExecutionContext({ type: "rpc" });
    const next = createCallHandler(() => of("pong"));

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBe("pong");

    expect(requestContextService.run).not.toHaveBeenCalled();
    expect(telemetryService.info).not.toHaveBeenCalled();
    expect(telemetryService.warn).not.toHaveBeenCalled();
  });

  it("uses a sanitized trusted request id for successful HTTP telemetry", async () => {
    const requestContextService = createRequestContextServiceMock();
    const telemetryService = createTelemetryServiceMock();
    const interceptor = new HttpTelemetryInterceptor(
      requestContextService,
      telemetryService,
    );
    const { context, response } = createExecutionContext({
      requestHeaders: {
        "x-request-id": TRUSTED_REQUEST_ID.toUpperCase(),
      },
      baseUrl: "/health",
      routePath: "/",
      statusCode: 200,
    });
    const next = createCallHandler(() => of({ status: "ok" }));

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({ status: "ok" });

    expect(requestContextService.run).toHaveBeenCalledWith(
      TRUSTED_REQUEST_ID,
      expect.any(Function),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "x-request-id",
      TRUSTED_REQUEST_ID,
    );
    expect(telemetryService.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http.request.completed",
        requestId: TRUSTED_REQUEST_ID,
        route: "/health",
        statusCode: 200,
      }),
    );
  });

  it("accepts trusted request ids from header arrays", async () => {
    const requestContextService = createRequestContextServiceMock();
    const telemetryService = createTelemetryServiceMock();
    const interceptor = new HttpTelemetryInterceptor(
      requestContextService,
      telemetryService,
    );
    const { context, response } = createExecutionContext({
      requestHeaders: {
        "x-request-id": [SECOND_TRUSTED_REQUEST_ID],
      },
      routePath: "/health",
      statusCode: 204,
    });
    const next = createCallHandler(() => of(undefined));

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBeUndefined();

    expect(response.setHeader).toHaveBeenCalledWith(
      "x-request-id",
      SECOND_TRUSTED_REQUEST_ID,
    );
    expect(telemetryService.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: SECOND_TRUSTED_REQUEST_ID,
        statusCode: 204,
      }),
    );
  });

  it("rejects untrusted request ids and falls back to the controller and handler route label", async () => {
    const requestContextService = createRequestContextServiceMock();
    const telemetryService = createTelemetryServiceMock();
    const interceptor = new HttpTelemetryInterceptor(
      requestContextService,
      telemetryService,
    );
    const { context, response } = createExecutionContext({
      requestHeaders: {
        "x-request-id": "not-a-trusted-request-id",
      },
      statusCode: 409,
    });
    const next = createCallHandler(() => throwError(() => new Error("boom")));

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow("boom");

    const generatedRequestId = response.setHeader.mock.calls[0]?.[1];

    expect(generatedRequestId).toMatch(UUID_PATTERN);
    expect(generatedRequestId).not.toBe("not-a-trusted-request-id");
    expect(telemetryService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http.request.failed",
        requestId: generatedRequestId,
        route: "HealthControllerMock.getHealthMock",
        statusCode: 409,
        errorName: "Error",
      }),
    );
  });

  it("uses a 500 fallback status code when request handling fails before a response code is set", async () => {
    const requestContextService = createRequestContextServiceMock();
    const telemetryService = createTelemetryServiceMock();
    const interceptor = new HttpTelemetryInterceptor(
      requestContextService,
      telemetryService,
    );
    const { context } = createExecutionContext({
      requestHeaders: {
        "x-request-id": "still-not-trusted",
      },
    });
    const next = createCallHandler(() =>
      throwError(() => new Error("status-not-set")),
    );

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).rejects.toThrow("status-not-set");

    expect(telemetryService.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "http.request.failed",
        statusCode: 500,
      }),
    );
  });
});

describe("TelemetryService", () => {
  it("adds request context ids to info logs", () => {
    const requestContextService = new RequestContextService();
    const telemetryService = new TelemetryService(requestContextService);
    const telemetryLogger = (
      telemetryService as unknown as {
        logger: {
          log: (message: string) => void;
        };
      }
    ).logger;
    const logSpy = jest.spyOn(telemetryLogger, "log").mockImplementation();

    requestContextService.run(TRUSTED_REQUEST_ID, () => {
      telemetryService.info({
        event: "telemetry.info",
        component: "TelemetryService",
        operation: "info",
        outcome: "success",
      });
    });

    const infoLogMessage = logSpy.mock.calls[0]?.[0];

    if (!infoLogMessage) {
      throw new Error("Expected telemetry info log output.");
    }

    const payload = JSON.parse(infoLogMessage);

    expect(payload).toEqual(
      expect.objectContaining({
        event: "telemetry.info",
        requestId: TRUSTED_REQUEST_ID,
      }),
    );
  });

  it("writes warn and error logs without a request id when no context exists", () => {
    const requestContextService = new RequestContextService();
    const telemetryService = new TelemetryService(requestContextService);
    const telemetryLogger = (
      telemetryService as unknown as {
        logger: {
          warn: (message: string) => void;
          error: (message: string) => void;
        };
      }
    ).logger;
    const warnSpy = jest.spyOn(telemetryLogger, "warn").mockImplementation();
    const errorSpy = jest.spyOn(telemetryLogger, "error").mockImplementation();

    telemetryService.warn({
      event: "telemetry.warn",
      component: "TelemetryService",
      operation: "warn",
      outcome: "warn",
    });
    telemetryService.error({
      event: "telemetry.error",
      component: "TelemetryService",
      operation: "error",
      outcome: "error",
    });

    const warnLogMessage = warnSpy.mock.calls[0]?.[0];
    const errorLogMessage = errorSpy.mock.calls[0]?.[0];

    if (!warnLogMessage || !errorLogMessage) {
      throw new Error("Expected telemetry warn and error log output.");
    }

    expect(JSON.parse(warnLogMessage)).toEqual(
      expect.not.objectContaining({
        requestId: expect.anything(),
      }),
    );
    expect(JSON.parse(errorLogMessage)).toEqual(
      expect.not.objectContaining({
        requestId: expect.anything(),
      }),
    );
  });
});
