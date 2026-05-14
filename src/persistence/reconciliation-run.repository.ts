import type { ReconciliationRun as PrismaReconciliationRun } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { getDurationMs } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";
import type { ReconciliationRunStatus } from "../reconciliation/shapes/reconciliation-run-status";
import type {
  CompleteReconciliationRunInput,
  ReconciliationRunRecord,
  StartReconciliationRunInput,
} from "./shapes/reconciliation-run.types";
import {
  classifyPersistenceError,
  translatePersistenceError,
} from "./persistence.errors";

@Injectable()
export class ReconciliationRunRepository {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  async startRun(
    input: StartReconciliationRunInput,
  ): Promise<ReconciliationRunRecord> {
    const reconciliationRunId = input.id ?? randomUUID();
    const startedAt = process.hrtime.bigint();

    try {
      const run = await this.databaseService.reconciliationRun.create({
        data: {
          id: reconciliationRunId,
          sourceVersion: input.sourceVersion,
          effectiveAt: input.effectiveAt,
          receivedCount: input.receivedCount,
          insertedCount: 0,
          updatedCount: 0,
          ignoredCount: 0,
          rejectedCount: 0,
          errorCount: 0,
          status: "STARTED",
          startedAt: input.startedAt ?? new Date().toISOString(),
          completedAt: null,
        },
      });

      this.telemetryService.info({
        event: "repo.reconciliation_run.start.completed",
        component: "ReconciliationRunRepository",
        operation: "startRun",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        receivedCount: input.receivedCount,
      });

      return toReconciliationRunRecord(run);
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "reconciliation_runs.source_version",
        "Reconciliation run could not be started.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.reconciliation_run.start.failed",
        component: "ReconciliationRunRepository",
        operation: "startRun",
        outcome,
        durationMs: getDurationMs(startedAt),
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }
  }

  async completeRun(
    input: CompleteReconciliationRunInput,
  ): Promise<ReconciliationRunRecord | null> {
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.databaseService.reconciliationRun.updateMany({
        where: {
          id: input.id,
          status: "STARTED",
        },
        data: {
          insertedCount: input.insertedCount,
          updatedCount: input.updatedCount,
          ignoredCount: input.ignoredCount,
          rejectedCount: input.rejectedCount,
          errorCount: input.errorCount,
          status: input.status,
          completedAt: input.completedAt ?? new Date().toISOString(),
        },
      });

      if (result.count === 0) {
        this.telemetryService.warn({
          event: "repo.reconciliation_run.complete.noop",
          component: "ReconciliationRunRepository",
          operation: "completeRun",
          outcome: "precondition_miss",
          durationMs: getDurationMs(startedAt),
          statusTo: input.status,
        });

        return null;
      }
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "reconciliation_runs.status",
        "Reconciliation run could not be completed.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.reconciliation_run.complete.failed",
        component: "ReconciliationRunRepository",
        operation: "completeRun",
        outcome,
        durationMs: getDurationMs(startedAt),
        statusTo: input.status,
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }

    const run = await this.findById(input.id);

    this.telemetryService.info({
      event: "repo.reconciliation_run.complete.completed",
      component: "ReconciliationRunRepository",
      operation: "completeRun",
      outcome: "success",
      durationMs: getDurationMs(startedAt),
      statusTo: input.status,
      insertedCount: input.insertedCount,
      updatedCount: input.updatedCount,
      ignoredCount: input.ignoredCount,
      rejectedCount: input.rejectedCount,
      errorCount: input.errorCount,
    });

    return run;
  }

  async findLatestRun(): Promise<ReconciliationRunRecord | null> {
    const run = await this.databaseService.reconciliationRun.findFirst({
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });

    return run ? toReconciliationRunRecord(run) : null;
  }

  async findBySourceVersion(
    sourceVersion: string,
  ): Promise<ReconciliationRunRecord | null> {
    const run = await this.databaseService.reconciliationRun.findUnique({
      where: { sourceVersion },
    });

    return run ? toReconciliationRunRecord(run) : null;
  }

  private async findById(id: string): Promise<ReconciliationRunRecord | null> {
    const run = await this.databaseService.reconciliationRun.findUnique({
      where: { id },
    });

    return run ? toReconciliationRunRecord(run) : null;
  }
}

function toReconciliationRunRecord(
  run: PrismaReconciliationRun,
): ReconciliationRunRecord {
  return {
    id: run.id,
    sourceVersion: run.sourceVersion,
    effectiveAt: run.effectiveAt,
    receivedCount: run.receivedCount,
    insertedCount: run.insertedCount,
    updatedCount: run.updatedCount,
    ignoredCount: run.ignoredCount,
    rejectedCount: run.rejectedCount,
    errorCount: run.errorCount,
    status: run.status as ReconciliationRunStatus,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}
