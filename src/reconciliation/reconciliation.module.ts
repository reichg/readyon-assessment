import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReconciliationRunRepository } from "../persistence/reconciliation-run.repository";
import { TelemetryModule } from "../telemetry/telemetry.module";

@Module({
  imports: [DatabaseModule, TelemetryModule],
  providers: [ReconciliationRunRepository],
  exports: [ReconciliationRunRepository],
})
export class ReconciliationModule {}
