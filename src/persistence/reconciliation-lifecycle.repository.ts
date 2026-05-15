import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, Balance as PrismaBalance } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { getDurationMs } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";
import {
  classifyPersistenceError,
  translatePersistenceError,
} from "./persistence.errors";

interface ReconciliationBalanceProjectionInput {
  employeeId: string;
  locationId: string;
  availableDays: number;
}

interface ApplyReconciliationBatchInput {
  sourceVersion: string;
  effectiveAt: string;
  balances: ReconciliationBalanceProjectionInput[];
}

interface ApplyReconciliationBatchResult {
  sourceVersion: string;
  received: number;
  inserted: number;
  updated: number;
  ignored: number;
  rejected: number;
}

export class ReconciliationBatchFreshnessError extends Error {
  constructor(
    public readonly latestSourceVersion: string,
    public readonly latestEffectiveAt: string,
  ) {
    super("Reconciliation batch is stale compared with current data.");
    this.name = "ReconciliationBatchFreshnessError";
  }
}

@Injectable()
export class ReconciliationLifecycleRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  async applyBatch(
    input: ApplyReconciliationBatchInput,
  ): Promise<ApplyReconciliationBatchResult> {
    const processedAt = new Date().toISOString();
    const receivedCount = input.balances.length;
    const startedAt = process.hrtime.bigint();

    try {
      const summary = await this.databaseService.$transaction(
        async (transaction) => {
          const runId = randomUUID();

          await transaction.reconciliationRun.create({
            data: {
              id: runId,
              sourceVersion: input.sourceVersion,
              effectiveAt: input.effectiveAt,
              receivedCount,
              insertedCount: 0,
              updatedCount: 0,
              ignoredCount: 0,
              rejectedCount: 0,
              errorCount: 0,
              status: "STARTED",
              startedAt: processedAt,
              completedAt: null,
            },
          });

          const latestCompletedRun =
            await transaction.reconciliationRun.findFirst({
              where: {
                status: "COMPLETED",
              },
              orderBy: [
                { effectiveAt: "desc" },
                { startedAt: "desc" },
                { id: "desc" },
              ],
            });

          if (
            latestCompletedRun &&
            input.effectiveAt <= latestCompletedRun.effectiveAt
          ) {
            throw new ReconciliationBatchFreshnessError(
              latestCompletedRun.sourceVersion,
              latestCompletedRun.effectiveAt,
            );
          }

          const existingBalances =
            receivedCount === 0
              ? []
              : await transaction.balance.findMany({
                  where: {
                    OR: input.balances.map((balance) => ({
                      employeeId: balance.employeeId,
                      locationId: balance.locationId,
                    })),
                  },
                });

          const sourceVersions = Array.from(
            new Set(
              existingBalances
                .map((balance) => balance.sourceVersion)
                .filter(
                  (sourceVersion): sourceVersion is string =>
                    typeof sourceVersion === "string" &&
                    sourceVersion.length > 0,
                ),
            ),
          );

          const sourceRuns =
            sourceVersions.length === 0
              ? []
              : await transaction.reconciliationRun.findMany({
                  where: {
                    sourceVersion: {
                      in: sourceVersions,
                    },
                    status: "COMPLETED",
                  },
                  select: {
                    sourceVersion: true,
                    completedAt: true,
                  },
                });

          const sourceRunsByVersion = new Map(
            sourceRuns.map((run) => [run.sourceVersion, run.completedAt]),
          );

          const fresherBalance = existingBalances.find((balance) =>
            isProjectionFresherThanBatch(
              balance,
              sourceRunsByVersion.get(balance.sourceVersion ?? ""),
              input.effectiveAt,
            ),
          );

          if (fresherBalance) {
            throw new ReconciliationBatchFreshnessError(
              fresherBalance.sourceVersion ?? "realtime_projection",
              fresherBalance.lastSyncedAt,
            );
          }

          const existingBalancesByKey = new Map(
            existingBalances.map((balance) => [
              createBalanceKey(balance.employeeId, balance.locationId),
              balance,
            ]),
          );

          let insertedCount = 0;
          let updatedCount = 0;

          for (const balance of input.balances) {
            const existingBalance =
              existingBalancesByKey.get(
                createBalanceKey(balance.employeeId, balance.locationId),
              ) ?? null;

            if (existingBalance) {
              updatedCount += 1;
            } else {
              insertedCount += 1;
            }

            await upsertBalanceProjection(transaction, existingBalance, {
              ...balance,
              sourceVersion: input.sourceVersion,
              lastSyncedAt: processedAt,
              updatedAt: processedAt,
            });
          }

          const completion = await transaction.reconciliationRun.updateMany({
            where: {
              id: runId,
              status: "STARTED",
            },
            data: {
              insertedCount,
              updatedCount,
              ignoredCount: 0,
              rejectedCount: 0,
              errorCount: 0,
              status: "COMPLETED",
              completedAt: processedAt,
            },
          });

          if (completion.count === 0) {
            throw new Error("Reconciliation run could not be completed.");
          }

          return {
            sourceVersion: input.sourceVersion,
            received: receivedCount,
            inserted: insertedCount,
            updated: updatedCount,
            ignored: 0,
            rejected: 0,
          } satisfies ApplyReconciliationBatchResult;
        },
      );

      this.telemetryService.info({
        event: "repo.reconciliation_batch.apply.completed",
        component: "ReconciliationLifecycleRepository",
        operation: "applyBatch",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        receivedCount: summary.received,
        insertedCount: summary.inserted,
        updatedCount: summary.updated,
      });

      return summary;
    } catch (error) {
      if (error instanceof ReconciliationBatchFreshnessError) {
        this.telemetryService.warn({
          event: "repo.reconciliation_batch.apply.rejected",
          component: "ReconciliationLifecycleRepository",
          operation: "applyBatch",
          outcome: "precondition_miss",
          durationMs: getDurationMs(startedAt),
        });

        throw error;
      }

      const persistenceError = translatePersistenceError(
        error,
        "reconciliation_runs.source_version",
        "Reconciliation batch could not be applied.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.reconciliation_batch.apply.failed",
        component: "ReconciliationLifecycleRepository",
        operation: "applyBatch",
        outcome,
        durationMs: getDurationMs(startedAt),
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }
  }
}

async function upsertBalanceProjection(
  transaction: Prisma.TransactionClient,
  existingBalance: PrismaBalance | null,
  input: ReconciliationBalanceProjectionInput & {
    sourceVersion: string;
    lastSyncedAt: string;
    updatedAt: string;
  },
): Promise<void> {
  await transaction.balance.upsert({
    where: {
      employeeId_locationId: {
        employeeId: input.employeeId,
        locationId: input.locationId,
      },
    },
    create: {
      id: existingBalance?.id ?? randomUUID(),
      employeeId: input.employeeId,
      locationId: input.locationId,
      availableDays: input.availableDays,
      sourceVersion: input.sourceVersion,
      lastSyncedAt: input.lastSyncedAt,
      createdAt: existingBalance?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    },
    update: {
      availableDays: input.availableDays,
      sourceVersion: input.sourceVersion,
      lastSyncedAt: input.lastSyncedAt,
      updatedAt: input.updatedAt,
    },
  });
}

function createBalanceKey(employeeId: string, locationId: string): string {
  return `${employeeId}::${locationId}`;
}

function isProjectionFresherThanBatch(
  balance: PrismaBalance,
  sourceRunCompletedAt: string | null | undefined,
  batchEffectiveAt: string,
): boolean {
  if (typeof sourceRunCompletedAt === "string") {
    return (
      balance.lastSyncedAt > sourceRunCompletedAt &&
      batchEffectiveAt <= balance.lastSyncedAt
    );
  }

  return batchEffectiveAt <= balance.lastSyncedAt;
}
