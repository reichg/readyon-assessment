import { Inject, Injectable } from "@nestjs/common";
import { PersistenceConflictError } from "../persistence/persistence.errors";
import {
  ReconciliationBatchFreshnessError,
  ReconciliationLifecycleRepository,
} from "../persistence/reconciliation-lifecycle.repository";
import { ReconciliationRunRepository } from "../persistence/reconciliation-run.repository";
import {
  createDuplicateReconciliationRowError,
  createStaleSourceVersionError,
} from "./reconciliation.errors";
import type {
  ReconciliationBatchBalanceRow,
  ReconciliationBatchInput,
  ReconciliationBatchSummary,
} from "./shapes/reconciliation-batch.types";

@Injectable()
export class ReconciliationService {
  constructor(
    @Inject(ReconciliationRunRepository)
    private readonly reconciliationRunRepository: ReconciliationRunRepository,
    @Inject(ReconciliationLifecycleRepository)
    private readonly reconciliationLifecycleRepository: ReconciliationLifecycleRepository,
  ) {}

  async reconcileBatch(
    input: ReconciliationBatchInput,
  ): Promise<ReconciliationBatchSummary> {
    const normalizedInput = {
      sourceVersion: input.sourceVersion,
      effectiveAt: new Date(input.effectiveAt).toISOString(),
      balances: input.balances,
    } satisfies ReconciliationBatchInput;

    const duplicateKeys = findDuplicateKeys(normalizedInput.balances);

    if (duplicateKeys.length > 0) {
      throw createDuplicateReconciliationRowError(duplicateKeys);
    }

    const existingRun =
      await this.reconciliationRunRepository.findBySourceVersion(
        normalizedInput.sourceVersion,
      );

    if (existingRun?.status === "COMPLETED") {
      return {
        sourceVersion: existingRun.sourceVersion,
        received: existingRun.receivedCount,
        inserted: 0,
        updated: 0,
        ignored: existingRun.receivedCount,
        rejected: 0,
      };
    }

    const latestCompletedRun =
      await this.reconciliationRunRepository.findLatestCompletedRun();

    if (
      latestCompletedRun &&
      normalizedInput.effectiveAt <= latestCompletedRun.effectiveAt
    ) {
      throw createStaleSourceVersionError({
        receivedSourceVersion: normalizedInput.sourceVersion,
        receivedEffectiveAt: normalizedInput.effectiveAt,
        latestSourceVersion: latestCompletedRun.sourceVersion,
        latestEffectiveAt: latestCompletedRun.effectiveAt,
      });
    }

    try {
      return await this.reconciliationLifecycleRepository.applyBatch(
        normalizedInput,
      );
    } catch (error) {
      if (error instanceof ReconciliationBatchFreshnessError) {
        throw createStaleSourceVersionError({
          receivedSourceVersion: normalizedInput.sourceVersion,
          receivedEffectiveAt: normalizedInput.effectiveAt,
          latestSourceVersion: error.latestSourceVersion,
          latestEffectiveAt: error.latestEffectiveAt,
        });
      }

      if (error instanceof PersistenceConflictError) {
        const racedRun =
          await this.reconciliationRunRepository.findBySourceVersion(
            normalizedInput.sourceVersion,
          );

        if (racedRun?.status === "COMPLETED") {
          return {
            sourceVersion: racedRun.sourceVersion,
            received: racedRun.receivedCount,
            inserted: 0,
            updated: 0,
            ignored: racedRun.receivedCount,
            rejected: 0,
          };
        }
      }

      throw error;
    }
  }
}

function findDuplicateKeys(
  balances: ReconciliationBatchBalanceRow[],
): string[] {
  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();

  for (const balance of balances) {
    const key = `${balance.employeeId}::${balance.locationId}`;

    if (seenKeys.has(key)) {
      duplicateKeys.add(key);
      continue;
    }

    seenKeys.add(key);
  }

  return Array.from(duplicateKeys).sort();
}
