import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../../src/database/database.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { HcmTransactionAuditRepository } from "../../src/persistence/hcm-transaction-audit.repository";
import {
  PersistenceConflictError,
  PersistenceConstraintError,
} from "../../src/persistence/persistence.errors";
import { PersistenceModule } from "../../src/persistence/persistence.module";
import { ReconciliationRunRepository } from "../../src/persistence/reconciliation-run.repository";
import { TimeOffRequestRepository } from "../../src/persistence/time-off-request.repository";
import { ReconciliationModule } from "../../src/reconciliation/reconciliation.module";
import { TelemetryService } from "../../src/telemetry/telemetry.service";
import { TimeOffModule } from "../../src/time-off/time-off.module";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "../helpers/database-path";

const EXPECTED_TABLES = [
  "balances",
  "time_off_requests",
  "hcm_transaction_audits",
  "reconciliation_runs",
] as const;

describe("Persistence repositories", () => {
  let moduleRef: TestingModule | undefined;
  let databasePath: string | undefined;
  let databaseService: DatabaseService | undefined;
  let balanceRepository: BalanceRepository;
  let timeOffRequestRepository: TimeOffRequestRepository;
  let hcmTransactionAuditRepository: HcmTransactionAuditRepository;
  let reconciliationRunRepository: ReconciliationRunRepository;
  let telemetryService: TelemetryService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("persistence");
    process.env.READYON_DB_PATH = databasePath;

    moduleRef = await Test.createTestingModule({
      imports: [PersistenceModule, TimeOffModule, ReconciliationModule],
    }).compile();
    await moduleRef.init();

    databaseService = moduleRef.get(DatabaseService);
    balanceRepository = moduleRef.get(BalanceRepository);
    timeOffRequestRepository = moduleRef.get(TimeOffRequestRepository);
    hcmTransactionAuditRepository = moduleRef.get(
      HcmTransactionAuditRepository,
    );
    reconciliationRunRepository = moduleRef.get(ReconciliationRunRepository);
    telemetryService = moduleRef.get(TelemetryService);
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.READYON_DB_PATH;

    if (databaseService) {
      await databaseService.$disconnect();
      databaseService = undefined;
    }

    if (moduleRef) {
      await moduleRef.close();
      moduleRef = undefined;
    }

    removeDatabaseFiles(databasePath);
    databasePath = undefined;
  });

  it("initializes repositories against the Prisma-managed schema", async () => {
    const prisma = databaseService!;
    const tableNames = (await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )) as Array<{ name: string }>;

    expect(tableNames.map((table) => table.name)).toEqual(
      expect.arrayContaining(EXPECTED_TABLES),
    );
    expect(tableNames.map((table) => table.name)).not.toContain("app_metadata");
  });

  it("returns null or empty collections for missing persisted records", async () => {
    expect(
      await balanceRepository.findByEmployeeLocation(
        "missing-employee",
        "missing-location",
      ),
    ).toBeNull();
    expect(
      await timeOffRequestRepository.findById("missing-request"),
    ).toBeNull();
    expect(
      await timeOffRequestRepository.findByIdempotencyKey(
        "missing-idempotency-key",
      ),
    ).toBeNull();
    expect(
      await hcmTransactionAuditRepository.findByExternalRequestId(
        "missing-external-request",
      ),
    ).toBeNull();
    expect(
      await hcmTransactionAuditRepository.findByTimeOffRequestId(
        "missing-request",
      ),
    ).toEqual([]);
    expect(
      await reconciliationRunRepository.findBySourceVersion(
        "missing-source-version",
      ),
    ).toBeNull();
    expect(await reconciliationRunRepository.findLatestRun()).toBeNull();
  });

  it("upserts balance projections by employee and location and preserves a single row", async () => {
    const inserted = await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 10,
      sourceVersion: "batch_2026_001",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });

    const updated = await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 8,
      sourceVersion: "batch_2026_002",
      lastSyncedAt: "2026-01-02T00:00:00.000Z",
    });

    const count = await databaseService!.balance.count({
      where: {
        employeeId: "emp_123",
        locationId: "loc_001",
      },
    });

    expect(inserted.id).toBe(updated.id);
    expect(updated.availableDays).toBe(8);
    expect(updated.sourceVersion).toBe("batch_2026_002");
    expect(updated.lastSyncedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(count).toBe(1);
  });

  it("rejects invalid balance projections with a stable persistence constraint error", async () => {
    await expect(
      balanceRepository.upsertProjection({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: -1,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });

  it("allows null idempotency keys but rejects duplicate non-null keys", async () => {
    const firstWithoutKey = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });
    const secondWithoutKey = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 3,
    });

    expect(firstWithoutKey.status).toBe("PENDING");
    expect(secondWithoutKey.status).toBe("PENDING");

    const withKey = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 4,
      idempotencyKey: "idem-123",
      idempotencyPayloadHash: "hash-123",
    });
    expect(
      (await timeOffRequestRepository.findByIdempotencyKey("idem-123"))?.id,
    ).toBe(withKey.id);

    await expect(
      timeOffRequestRepository.createPending({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 4,
        idempotencyKey: "idem-123",
        idempotencyPayloadHash: "hash-123",
      }),
    ).rejects.toThrow(PersistenceConflictError);
  });

  it("emits sanitized telemetry for translated persistence conflicts", async () => {
    const warnSpy = jest.spyOn(telemetryService, "warn");

    await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 4,
      idempotencyKey: "idem-telemetry",
      idempotencyPayloadHash: "hash-telemetry",
    });

    await expect(
      timeOffRequestRepository.createPending({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 4,
        idempotencyKey: "idem-telemetry",
        idempotencyPayloadHash: "hash-telemetry",
      }),
    ).rejects.toThrow(PersistenceConflictError);

    const conflictEvent = warnSpy.mock.calls.find(
      ([event]) =>
        event.event === "repo.time_off_request.create_pending.failed",
    )?.[0];

    expect(conflictEvent).toEqual(
      expect.objectContaining({
        event: "repo.time_off_request.create_pending.failed",
        component: "TimeOffRequestRepository",
        operation: "createPending",
        outcome: "conflict",
        hasIdempotencyKey: true,
        errorName: "PersistenceConflictError",
      }),
    );
    expect(conflictEvent).not.toHaveProperty("employeeId");
    expect(conflictEvent).not.toHaveProperty("locationId");
    expect(conflictEvent).not.toHaveProperty("idempotencyKey");
  });

  it("rejects invalid requested day counts at the persistence layer", async () => {
    await expect(
      timeOffRequestRepository.createPending({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 0,
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });

  it("requires idempotency key and payload hash to be stored together", async () => {
    await expect(
      timeOffRequestRepository.createPending({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 4,
        idempotencyKey: "idem-123",
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });

  it("updates terminal request statuses only from allowed current states", async () => {
    const requestRecord = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-status",
      idempotencyPayloadHash: "hash-status",
    });

    const approved = await timeOffRequestRepository.updateStatus({
      id: requestRecord.id,
      status: "APPROVED",
      hcmTransactionId: "hcm-transaction-123",
    });

    expect(approved).not.toBeNull();
    expect(approved?.status).toBe("APPROVED");
    expect(approved?.approvedAt).not.toBeNull();
    expect(approved?.hcmTransactionId).toBe("hcm-transaction-123");

    const rejectedAfterApproval = await timeOffRequestRepository.updateStatus({
      id: requestRecord.id,
      status: "REJECTED",
    });

    expect(rejectedAfterApproval).toBeNull();
    expect(
      (await timeOffRequestRepository.findById(requestRecord.id))?.status,
    ).toBe("APPROVED");
  });

  it("requires approved requests to carry an HCM transaction id", async () => {
    const requestRecord = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-approved",
      idempotencyPayloadHash: "hash-approved",
    });

    await expect(
      timeOffRequestRepository.updateStatus({
        id: requestRecord.id,
        status: "APPROVED",
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });

  it("enforces HCM audit foreign keys, unique external request ids, and completion updates", async () => {
    const requestRecord = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-audit",
      idempotencyPayloadHash: "hash-audit",
    });

    await expect(
      hcmTransactionAuditRepository.createAttempt({
        timeOffRequestId: "missing-request",
        externalRequestId: "external-missing",
        operation: "DEDUCT_TIME_OFF",
        status: "STARTED",
      }),
    ).rejects.toThrow(PersistenceConstraintError);

    const auditRecord = await hcmTransactionAuditRepository.createAttempt({
      timeOffRequestId: requestRecord.id,
      externalRequestId: "external-123",
      operation: "DEDUCT_TIME_OFF",
      status: "STARTED",
    });

    await expect(
      hcmTransactionAuditRepository.createAttempt({
        timeOffRequestId: requestRecord.id,
        externalRequestId: "external-123",
        operation: "DEDUCT_TIME_OFF",
        status: "STARTED",
      }),
    ).rejects.toThrow(PersistenceConflictError);

    const completed = await hcmTransactionAuditRepository.markCompleted({
      id: auditRecord.id,
      status: "COMPLETED",
      hcmTransactionId: "hcm-transaction-123",
    });

    const replayedCompletion =
      await hcmTransactionAuditRepository.markCompleted({
        id: auditRecord.id,
        status: "FAILED",
        errorCode: "replay",
        errorMessage: "should not overwrite",
      });

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.hcmTransactionId).toBe("hcm-transaction-123");
    expect(completed?.completedAt).not.toBeNull();
    expect(replayedCompletion).toBeNull();
    expect(
      (
        await hcmTransactionAuditRepository.findByExternalRequestId(
          "external-123",
        )
      )?.id,
    ).toBe(auditRecord.id);
  });

  it("rejects invalid HCM audit lifecycle inputs before persistence", async () => {
    const requestRecord = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-audit-lifecycle",
      idempotencyPayloadHash: "hash-audit-lifecycle",
    });

    await expect(
      hcmTransactionAuditRepository.createAttempt({
        timeOffRequestId: requestRecord.id,
        externalRequestId: "external-invalid-start",
        operation: "DEDUCT_TIME_OFF",
        status: "COMPLETED" as never,
      }),
    ).rejects.toThrow(PersistenceConstraintError);

    const auditRecord = await hcmTransactionAuditRepository.createAttempt({
      timeOffRequestId: requestRecord.id,
      externalRequestId: "external-started",
      operation: "DEDUCT_TIME_OFF",
      status: "STARTED",
    });

    await expect(
      hcmTransactionAuditRepository.markCompleted({
        id: auditRecord.id,
        status: "COMPLETED",
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });

  it("returns request audits in reverse attempted order", async () => {
    const requestRecord = await timeOffRequestRepository.createPending({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-audit-order",
      idempotencyPayloadHash: "hash-audit-order",
    });

    await hcmTransactionAuditRepository.createAttempt({
      timeOffRequestId: requestRecord.id,
      externalRequestId: "external-early",
      operation: "DEDUCT_TIME_OFF",
      status: "STARTED",
      attemptedAt: "2026-01-01T00:00:00.000Z",
    });

    await hcmTransactionAuditRepository.createAttempt({
      timeOffRequestId: requestRecord.id,
      externalRequestId: "external-late",
      operation: "DEDUCT_TIME_OFF",
      status: "STARTED",
      attemptedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(
      (
        await hcmTransactionAuditRepository.findByTimeOffRequestId(
          requestRecord.id,
        )
      ).map((audit) => audit.externalRequestId),
    ).toEqual(["external-late", "external-early"]);
  });

  it("records reconciliation runs and rejects duplicate or impossible summaries", async () => {
    const run = await reconciliationRunRepository.startRun({
      sourceVersion: "batch_2026_001",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      receivedCount: 3,
    });

    const completed = await reconciliationRunRepository.completeRun({
      id: run.id,
      insertedCount: 1,
      updatedCount: 1,
      ignoredCount: 1,
      rejectedCount: 0,
      errorCount: 0,
      status: "COMPLETED",
    });

    const replayedCompletion = await reconciliationRunRepository.completeRun({
      id: run.id,
      insertedCount: 0,
      updatedCount: 0,
      ignoredCount: 0,
      rejectedCount: 0,
      errorCount: 1,
      status: "FAILED",
    });

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe("COMPLETED");
    expect(replayedCompletion).toBeNull();
    expect(
      (await reconciliationRunRepository.findBySourceVersion("batch_2026_001"))
        ?.id,
    ).toBe(run.id);
    expect((await reconciliationRunRepository.findLatestRun())?.id).toBe(
      run.id,
    );

    await expect(
      reconciliationRunRepository.startRun({
        sourceVersion: "batch_2026_001",
        effectiveAt: "2026-01-01T00:00:00.000Z",
        receivedCount: 1,
      }),
    ).rejects.toThrow(PersistenceConflictError);

    const invalidRun = await reconciliationRunRepository.startRun({
      sourceVersion: "batch_2026_002",
      effectiveAt: "2026-01-02T00:00:00.000Z",
      receivedCount: 1,
    });

    await expect(
      reconciliationRunRepository.completeRun({
        id: invalidRun.id,
        insertedCount: 1,
        updatedCount: 1,
        ignoredCount: 0,
        rejectedCount: 0,
        errorCount: 0,
        status: "COMPLETED",
      }),
    ).rejects.toThrow(PersistenceConstraintError);
  });
});
