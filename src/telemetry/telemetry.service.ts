import { Inject, Injectable, Logger } from "@nestjs/common";
import { RequestContextService } from "./request-context.service";
import type { TelemetryEvent, TelemetryValue } from "./telemetry.types";

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

  private write(level: "info" | "warn" | "error", event: TelemetryEvent): void {
    const requestId = this.requestContextService.getRequestId();
    const payload: Record<string, TelemetryValue> = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    if (requestId && payload.requestId === undefined) {
      payload.requestId = requestId;
    }

    const message = JSON.stringify(payload);

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
