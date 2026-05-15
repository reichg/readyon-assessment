import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReconciliationLifecycleRepository } from "../persistence/reconciliation-lifecycle.repository";
import { ReconciliationRunRepository } from "../persistence/reconciliation-run.repository";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { ReconciliationController } from "./reconciliation.controller";
import { ReconciliationService } from "./reconciliation.service";

@Module({
  imports: [DatabaseModule, TelemetryModule],
  controllers: [ReconciliationController],
  providers: [
    ReconciliationRunRepository,
    ReconciliationLifecycleRepository,
    ReconciliationService,
  ],
  exports: [ReconciliationRunRepository],
})
export class ReconciliationModule {}
