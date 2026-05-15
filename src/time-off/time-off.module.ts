import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { HcmModule } from "../hcm/hcm.module";
import { HcmTransactionAuditRepository } from "../persistence/hcm-transaction-audit.repository";
import { PersistenceModule } from "../persistence/persistence.module";
import { TimeOffRequestLifecycleRepository } from "../persistence/time-off-request-lifecycle.repository";
import { TimeOffRequestRepository } from "../persistence/time-off-request.repository";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { BalanceService } from "./balance.service";
import { BalancesController } from "./balances.controller";
import { TimeOffRequestService } from "./time-off-request.service";
import { TimeOffRequestsController } from "./time-off-requests.controller";

@Module({
  imports: [DatabaseModule, TelemetryModule, PersistenceModule, HcmModule],
  controllers: [BalancesController, TimeOffRequestsController],
  providers: [
    TimeOffRequestRepository,
    TimeOffRequestLifecycleRepository,
    HcmTransactionAuditRepository,
    BalanceService,
    TimeOffRequestService,
  ],
  exports: [TimeOffRequestRepository, HcmTransactionAuditRepository],
})
export class TimeOffModule {}
