import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { BalanceRepository } from "./balance.repository";

@Module({
  imports: [DatabaseModule, TelemetryModule],
  providers: [BalanceRepository],
  exports: [BalanceRepository],
})
export class PersistenceModule {}
