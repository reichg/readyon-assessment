import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { HcmTransactionAuditRepository } from "../persistence/hcm-transaction-audit.repository";
import { TimeOffRequestRepository } from "../persistence/time-off-request.repository";
import { TelemetryModule } from "../telemetry/telemetry.module";

@Module({
  imports: [DatabaseModule, TelemetryModule],
  providers: [TimeOffRequestRepository, HcmTransactionAuditRepository],
  exports: [TimeOffRequestRepository, HcmTransactionAuditRepository],
})
export class TimeOffModule {}
