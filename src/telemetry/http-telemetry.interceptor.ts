import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Observable, catchError, tap, throwError } from "rxjs";
import { RequestContextService } from "./request-context.service";
import { getDurationMs, getErrorName } from "./telemetry.helpers";
import { TelemetryService } from "./telemetry.service";

interface HttpRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  baseUrl?: string;
  route?: {
    path?: string;
  };
}

interface HttpResponseLike {
  setHeader?: (name: string, value: string) => void;
  statusCode?: number;
}

const TRUSTED_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class HttpTelemetryInterceptor implements NestInterceptor {
  constructor(
    @Inject(RequestContextService)
    private readonly requestContextService: RequestContextService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<HttpRequestLike>();
    const response = httpContext.getResponse<HttpResponseLike>();
    const requestId = resolveRequestId(request.headers?.["x-request-id"]);
    const startedAt = process.hrtime.bigint();
    const controller = context.getClass().name;
    const handler = context.getHandler().name;
    const route = resolveRouteLabel(
      request.baseUrl,
      request.route?.path,
      controller,
      handler,
    );

    response.setHeader?.("x-request-id", requestId);

    return new Observable((subscriber) => {
      this.requestContextService.run(requestId, () => {
        next
          .handle()
          .pipe(
            tap(() => {
              this.telemetryService.info({
                event: "http.request.completed",
                component: "HttpTelemetryInterceptor",
                operation: "intercept",
                outcome: "success",
                requestId,
                method: request.method ?? "UNKNOWN",
                route,
                controller,
                handler,
                statusCode: response.statusCode ?? 200,
                durationMs: getDurationMs(startedAt),
              });
            }),
            catchError((error: unknown) => {
              this.telemetryService.warn({
                event: "http.request.failed",
                component: "HttpTelemetryInterceptor",
                operation: "intercept",
                outcome: "failure",
                requestId,
                method: request.method ?? "UNKNOWN",
                route,
                controller,
                handler,
                statusCode: resolveFailureStatusCode(response.statusCode),
                durationMs: getDurationMs(startedAt),
                errorName: getErrorName(error),
              });

              return throwError(() => error);
            }),
          )
          .subscribe(subscriber);
      });
    });
  }
}

function resolveRequestId(headerValue: string | string[] | undefined): string {
  if (typeof headerValue === "string") {
    const sanitizedHeaderValue = normalizeRequestId(headerValue);

    if (sanitizedHeaderValue) {
      return sanitizedHeaderValue;
    }
  }

  if (Array.isArray(headerValue)) {
    const firstHeaderValue = headerValue.find(
      (candidate) => typeof candidate === "string" && candidate.length > 0,
    );

    if (firstHeaderValue) {
      const sanitizedHeaderValue = normalizeRequestId(firstHeaderValue);

      if (sanitizedHeaderValue) {
        return sanitizedHeaderValue;
      }
    }
  }

  return randomUUID();
}

function normalizeRequestId(headerValue: string): string | null {
  const trimmedHeaderValue = headerValue.trim();

  if (!TRUSTED_REQUEST_ID_PATTERN.test(trimmedHeaderValue)) {
    return null;
  }

  return trimmedHeaderValue.toLowerCase();
}

function resolveRouteLabel(
  baseUrl: string | undefined,
  routePath: string | undefined,
  controller: string,
  handler: string,
): string {
  if (typeof routePath === "string") {
    const normalizedRoutePath = routePath === "/" ? "" : routePath;
    const routeLabel = `${baseUrl ?? ""}${normalizedRoutePath}`;

    return routeLabel.length > 0 ? routeLabel : "/";
  }

  return `${controller}.${handler}`;
}

function resolveFailureStatusCode(statusCode: number | undefined): number {
  if (typeof statusCode === "number" && statusCode >= 400) {
    return statusCode;
  }

  return 500;
}
