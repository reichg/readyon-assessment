import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../../src/database/database.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { PersistenceModule } from "../../src/persistence/persistence.module";
import { ReconciliationRunRepository } from "../../src/persistence/reconciliation-run.repository";
import { ReconciliationModule } from "../../src/reconciliation/reconciliation.module";
import { ReconciliationService } from "../../src/reconciliation/reconciliation.service";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "../helpers/database-path";

describe("ReconciliationService", () => {
  let moduleRef: TestingModule | undefined;
  let databasePath: string | undefined;
  let databaseService: DatabaseService;
  let balanceRepository: BalanceRepository;
  let reconciliationRunRepository: ReconciliationRunRepository;
  let reconciliationService: ReconciliationService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("reconciliation-service");
    process.env.READYON_DB_PATH = databasePath;

    moduleRef = await Test.createTestingModule({
      imports: [PersistenceModule, ReconciliationModule],
    }).compile();
    await moduleRef.init();

    databaseService = moduleRef.get(DatabaseService);
    balanceRepository = moduleRef.get(BalanceRepository);
    reconciliationRunRepository = moduleRef.get(ReconciliationRunRepository);
    reconciliationService = moduleRef.get(ReconciliationService);
  });

  afterEach(async () => {
    delete process.env.READYON_DB_PATH;

    if (moduleRef) {
      await moduleRef.close();
      moduleRef = undefined;
    }

    removeDatabaseFiles(databasePath);
    databasePath = undefined;
  });

  it("applies a fresh batch with inserted and updated counts", async () => {
    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 3,
      sourceVersion: "batch_2026_001",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });

    const summary = await reconciliationService.reconcileBatch({
      sourceVersion: "batch_2026_002",
      effectiveAt: "2026-01-02T00:00:00.000Z",
      balances: [
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 8,
        },
        {
          employeeId: "emp_456",
          locationId: "loc_002",
          availableDays: 4,
        },
      ],
    });

    expect(summary).toEqual({
      sourceVersion: "batch_2026_002",
      received: 2,
      inserted: 1,
      updated: 1,
      ignored: 0,
      rejected: 0,
    });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 8,
        sourceVersion: "batch_2026_002",
      }),
    );
    await expect(
      balanceRepository.findByEmployeeLocation("emp_456", "loc_002"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_456",
        locationId: "loc_002",
        availableDays: 4,
        sourceVersion: "batch_2026_002",
      }),
    );
    await expect(
      reconciliationRunRepository.findBySourceVersion("batch_2026_002"),
    ).resolves.toEqual(
      expect.objectContaining({
        sourceVersion: "batch_2026_002",
        receivedCount: 2,
        insertedCount: 1,
        updatedCount: 1,
        ignoredCount: 0,
        rejectedCount: 0,
        status: "COMPLETED",
      }),
    );
  });

  it("returns a no-op summary when the same source version is replayed", async () => {
    await reconciliationService.reconcileBatch({
      sourceVersion: "batch_2026_010",
      effectiveAt: "2026-01-10T00:00:00.000Z",
      balances: [
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 7,
        },
      ],
    });

    const replayedSummary = await reconciliationService.reconcileBatch({
      sourceVersion: "batch_2026_010",
      effectiveAt: "2026-01-10T00:00:00.000Z",
      balances: [
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 7,
        },
      ],
    });

    expect(replayedSummary).toEqual({
      sourceVersion: "batch_2026_010",
      received: 1,
      inserted: 0,
      updated: 0,
      ignored: 1,
      rejected: 0,
    });
    await expect(databaseService.reconciliationRun.count()).resolves.toBe(1);
  });

  it("rejects stale or conflicting batches without mutating balances", async () => {
    await reconciliationService.reconcileBatch({
      sourceVersion: "batch_2026_020",
      effectiveAt: "2026-01-20T00:00:00.000Z",
      balances: [
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 9,
        },
      ],
    });

    await expect(
      reconciliationService.reconcileBatch({
        sourceVersion: "batch_2026_021",
        effectiveAt: "2026-01-20T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 5,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "STALE_SOURCE_VERSION",
      message:
        "Reconciliation batch is stale compared with the latest applied snapshot.",
    });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 9,
        sourceVersion: "batch_2026_020",
      }),
    );
    await expect(databaseService.reconciliationRun.count()).resolves.toBe(1);
  });

  it("rejects older batches that would overwrite a fresher local projection", async () => {
    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 11,
      lastSyncedAt: "2026-01-25T00:00:00.000Z",
    });

    await expect(
      reconciliationService.reconcileBatch({
        sourceVersion: "batch_2026_025",
        effectiveAt: "2026-01-20T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 4,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "STALE_SOURCE_VERSION",
      message:
        "Reconciliation batch is stale compared with the latest applied snapshot.",
      details: {
        receivedSourceVersion: "batch_2026_025",
        receivedEffectiveAt: "2026-01-20T00:00:00.000Z",
        latestSourceVersion: "realtime_projection",
        latestEffectiveAt: "2026-01-25T00:00:00.000Z",
      },
    });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 11,
        sourceVersion: null,
        lastSyncedAt: "2026-01-25T00:00:00.000Z",
      }),
    );
    await expect(databaseService.reconciliationRun.count()).resolves.toBe(0);
  });

  it("rejects duplicate employee/location rows before any writes", async () => {
    await expect(
      reconciliationService.reconcileBatch({
        sourceVersion: "batch_2026_030",
        effectiveAt: "2026-01-30T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 6,
          },
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 8,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_RECONCILIATION_ROW",
      message:
        "Reconciliation batch contains duplicate employee/location rows.",
      details: {
        duplicateKeys: ["emp_123::loc_001"],
      },
    });

    await expect(databaseService.balance.count()).resolves.toBe(0);
    await expect(databaseService.reconciliationRun.count()).resolves.toBe(0);
  });
});
