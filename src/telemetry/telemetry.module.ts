import { Module } from "@nestjs/common";
import { HttpTelemetryInterceptor } from "./http-telemetry.interceptor";
import { RequestContextService } from "./request-context.service";
import { TelemetryService } from "./telemetry.service";

@Module({
  providers: [
    RequestContextService,
    TelemetryService,
    HttpTelemetryInterceptor,
  ],
  exports: [RequestContextService, TelemetryService, HttpTelemetryInterceptor],
})
export class TelemetryModule {}
