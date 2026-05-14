import { Module } from "@nestjs/common";
import { HcmModule } from "./hcm/hcm.module";
import { HealthModule } from "./health/health.module";
import { PersistenceModule } from "./persistence/persistence.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { TimeOffModule } from "./time-off/time-off.module";

@Module({
  imports: [
    TelemetryModule,
    PersistenceModule,
    HealthModule,
    TimeOffModule,
    HcmModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
