import type { Balance as PrismaBalance } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { getDurationMs } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";
import type {
  BalanceRecord,
  UpsertBalanceProjectionInput,
} from "./shapes/balance.types";
import {
  classifyPersistenceError,
  translatePersistenceError,
} from "./persistence.errors";

@Injectable()
export class BalanceRepository {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  async findByEmployeeLocation(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceRecord | null> {
    const balance = await this.databaseService.balance.findUnique({
      where: {
        employeeId_locationId: {
          employeeId,
          locationId,
        },
      },
    });

    return balance ? toBalanceRecord(balance) : null;
  }

  async upsertProjection(
    input: UpsertBalanceProjectionInput,
  ): Promise<BalanceRecord> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const createdAt = input.createdAt ?? updatedAt;
    const startedAt = process.hrtime.bigint();

    try {
      const balance = await this.databaseService.balance.upsert({
        where: {
          employeeId_locationId: {
            employeeId: input.employeeId,
            locationId: input.locationId,
          },
        },
        create: {
          id: input.id ?? randomUUID(),
          employeeId: input.employeeId,
          locationId: input.locationId,
          availableDays: input.availableDays,
          sourceVersion: input.sourceVersion ?? null,
          lastSyncedAt: input.lastSyncedAt,
          createdAt,
          updatedAt,
        },
        update: {
          availableDays: input.availableDays,
          sourceVersion: input.sourceVersion ?? null,
          lastSyncedAt: input.lastSyncedAt,
          updatedAt,
        },
      });

      this.telemetryService.info({
        event: "repo.balance.upsert_projection.completed",
        component: "BalanceRepository",
        operation: "upsertProjection",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        hasSourceVersion:
          input.sourceVersion !== undefined && input.sourceVersion !== null,
      });

      return toBalanceRecord(balance);
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "balances.employee_id_location_id",
        "Balance projection could not be saved.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.balance.upsert_projection.failed",
        component: "BalanceRepository",
        operation: "upsertProjection",
        outcome,
        durationMs: getDurationMs(startedAt),
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }
  }
}

function toBalanceRecord(balance: PrismaBalance): BalanceRecord {
  return {
    id: balance.id,
    employeeId: balance.employeeId,
    locationId: balance.locationId,
    availableDays: balance.availableDays,
    sourceVersion: balance.sourceVersion,
    lastSyncedAt: balance.lastSyncedAt,
    createdAt: balance.createdAt,
    updatedAt: balance.updatedAt,
  };
}
