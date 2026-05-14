import { Module } from "@nestjs/common";
import { DATABASE_PATH, getDatabasePath } from "./database.constants";
import { DatabaseService } from "./database.service";
import { TelemetryModule } from "../telemetry/telemetry.module";

@Module({
  imports: [TelemetryModule],
  providers: [
    {
      provide: DATABASE_PATH,
      useFactory: (): string => getDatabasePath(),
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
