import { PersistenceConflictError } from "../../src/persistence/persistence.errors";
import type { ReconciliationLifecycleRepository } from "../../src/persistence/reconciliation-lifecycle.repository";
import { ReconciliationBatchFreshnessError } from "../../src/persistence/reconciliation-lifecycle.repository";
import type { ReconciliationRunRepository } from "../../src/persistence/reconciliation-run.repository";
import { ReconciliationService } from "../../src/reconciliation/reconciliation.service";

describe("ReconciliationService recovery branches", () => {
  let reconciliationRunRepository: {
    findBySourceVersion: jest.Mock;
    findLatestCompletedRun: jest.Mock;
  };
  let reconciliationLifecycleRepository: {
    applyBatch: jest.Mock;
  };
  let service: ReconciliationService;

  beforeEach(() => {
    reconciliationRunRepository = {
      findBySourceVersion: jest.fn(),
      findLatestCompletedRun: jest.fn(),
    };
    reconciliationLifecycleRepository = {
      applyBatch: jest.fn(),
    };

    service = new ReconciliationService(
      reconciliationRunRepository as unknown as ReconciliationRunRepository,
      reconciliationLifecycleRepository as unknown as ReconciliationLifecycleRepository,
    );
  });

  it("maps lifecycle freshness errors to the public stale-source-version error", async () => {
    reconciliationRunRepository.findBySourceVersion.mockResolvedValue(null);
    reconciliationRunRepository.findLatestCompletedRun.mockResolvedValue(null);
    reconciliationLifecycleRepository.applyBatch.mockRejectedValue(
      new ReconciliationBatchFreshnessError(
        "batch_2026_020",
        "2026-01-20T00:00:00.000Z",
      ),
    );

    await expect(
      service.reconcileBatch({
        sourceVersion: "batch_2026_010",
        effectiveAt: "2026-01-10T00:00:00.000Z",
        balances: [],
      }),
    ).rejects.toMatchObject({
      code: "STALE_SOURCE_VERSION",
      message:
        "Reconciliation batch is stale compared with the latest applied snapshot.",
      details: {
        receivedSourceVersion: "batch_2026_010",
        receivedEffectiveAt: "2026-01-10T00:00:00.000Z",
        latestSourceVersion: "batch_2026_020",
        latestEffectiveAt: "2026-01-20T00:00:00.000Z",
      },
    });
  });

  it("returns an idempotent replay summary when a conflict races with a completed run", async () => {
    reconciliationRunRepository.findBySourceVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sourceVersion: "batch_2026_010",
        receivedCount: 3,
        status: "COMPLETED",
      });
    reconciliationRunRepository.findLatestCompletedRun.mockResolvedValue(null);
    reconciliationLifecycleRepository.applyBatch.mockRejectedValue(
      new PersistenceConflictError(
        "reconciliation_runs.source_version",
        "Reconciliation batch could not be applied.",
      ),
    );

    await expect(
      service.reconcileBatch({
        sourceVersion: "batch_2026_010",
        effectiveAt: "2026-01-10T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 7,
          },
        ],
      }),
    ).resolves.toEqual({
      sourceVersion: "batch_2026_010",
      received: 3,
      inserted: 0,
      updated: 0,
      ignored: 3,
      rejected: 0,
    });
  });

  it("rethrows a persistence conflict when no completed raced run is found", async () => {
    const conflict = new PersistenceConflictError(
      "reconciliation_runs.source_version",
      "Reconciliation batch could not be applied.",
    );

    reconciliationRunRepository.findBySourceVersion
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sourceVersion: "batch_2026_010",
        receivedCount: 1,
        status: "STARTED",
      });
    reconciliationRunRepository.findLatestCompletedRun.mockResolvedValue(null);
    reconciliationLifecycleRepository.applyBatch.mockRejectedValue(conflict);

    await expect(
      service.reconcileBatch({
        sourceVersion: "batch_2026_010",
        effectiveAt: "2026-01-10T00:00:00.000Z",
        balances: [],
      }),
    ).rejects.toBe(conflict);
  });
});
