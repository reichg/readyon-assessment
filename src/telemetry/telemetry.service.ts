import { Inject, Injectable, Logger } from "@nestjs/common";
import { RequestContextService } from "./request-context.service";
import type { TelemetryEvent, TelemetryValue } from "./telemetry.types";

const TELEMETRY_FIELD_ORDER = [
  "timestamp",
  "level",
  "event",
  "component",
  "operation",
  "outcome",
  "durationMs",
  "requestId",
] as const;

type TelemetryLogLevel = "info" | "warn" | "error";
type TelemetryLogFormat = "json" | "pretty";

@Injectable()
export class TelemetryService {
  private readonly logger = new Logger("Telemetry");

  constructor(
    @Inject(RequestContextService)
    private readonly requestContextService: RequestContextService,
  ) {}

  info(event: TelemetryEvent): void {
    this.write("info", event);
  }

  warn(event: TelemetryEvent): void {
    this.write("warn", event);
  }

  error(event: TelemetryEvent): void {
    this.write("error", event);
  }

  private write(level: TelemetryLogLevel, event: TelemetryEvent): void {
    const requestId = this.requestContextService.getRequestId();
    const payload: Record<string, TelemetryValue> = {
      timestamp: new Date().toISOString(),
      level,
      ...event,
    };

    if (requestId && payload.requestId === undefined) {
      payload.requestId = requestId;
    }

    const message = formatTelemetryMessage(payload);

    if (level === "info") {
      this.logger.log(message);
      return;
    }

    if (level === "warn") {
      this.logger.warn(message);
      return;
    }

    this.logger.error(message);
  }
}

function formatTelemetryMessage(
  payload: Record<string, TelemetryValue>,
): string {
  const orderedPayload = orderTelemetryPayload(payload);

  if (resolveTelemetryLogFormat() === "pretty") {
    return JSON.stringify(orderedPayload, null, 2);
  }

  return JSON.stringify(orderedPayload);
}

function orderTelemetryPayload(
  payload: Record<string, TelemetryValue>,
): Record<string, TelemetryValue> {
  const orderedPayload: Record<string, TelemetryValue> = {};

  for (const key of TELEMETRY_FIELD_ORDER) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      orderedPayload[key] = payload[key];
    }
  }

  const remainingKeys = Object.keys(payload)
    .filter((key) => !Object.prototype.hasOwnProperty.call(orderedPayload, key))
    .sort();

  for (const key of remainingKeys) {
    orderedPayload[key] = payload[key];
  }

  return orderedPayload;
}

function resolveTelemetryLogFormat(): TelemetryLogFormat {
  return process.env.READYON_TELEMETRY_FORMAT === "pretty" ? "pretty" : "json";
}
