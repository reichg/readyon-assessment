import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { HcmModule } from "../../src/hcm/hcm.module";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { PersistenceModule } from "../../src/persistence/persistence.module";
import { BalanceService } from "../../src/time-off/balance.service";
import { TimeOffModule } from "../../src/time-off/time-off.module";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
} from "../hcm/mock-hcm.fixtures";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "../helpers/database-path";

describe("BalanceService", () => {
  let moduleRef: TestingModule | undefined;
  let databasePath: string | undefined;
  let balanceService: BalanceService;
  let balanceRepository: BalanceRepository;
  let mockHcmService: MockHcmService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("balance-service");
    process.env.READYON_DB_PATH = databasePath;

    moduleRef = await Test.createTestingModule({
      imports: [PersistenceModule, HcmModule, TimeOffModule],
    }).compile();
    await moduleRef.init();

    balanceService = moduleRef.get(BalanceService);
    balanceRepository = moduleRef.get(BalanceRepository);
    mockHcmService = moduleRef.get(MockHcmService);
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

  it("upserts the authoritative HCM balance into the local projection", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 12 })],
      }),
    );

    const refreshed = await balanceService.refreshBalance("emp_123", "loc_001");
    const persisted = await balanceRepository.findByEmployeeLocation(
      "emp_123",
      "loc_001",
    );

    expect(refreshed).toEqual({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 12,
      lastSyncedAt: expect.any(String),
    });
    expect(persisted).toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 12,
        sourceVersion: null,
      }),
    );
  });

  it("corrects stale local data while preserving the current source version", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 9 })],
      }),
    );

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 4,
      sourceVersion: "batch_2026_002",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });

    await balanceService.refreshBalance("emp_123", "loc_001");

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 9,
        sourceVersion: "batch_2026_002",
      }),
    );
  });

  it("does not corrupt the local projection when HCM is unavailable", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 7 })],
      }),
    );

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 5,
      sourceVersion: "batch_2026_003",
      lastSyncedAt: "2026-01-02T00:00:00.000Z",
    });
    mockHcmService.scheduleTransientFailure("GET_BALANCE");

    await expect(
      balanceService.refreshBalance("emp_123", "loc_001"),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 5,
        sourceVersion: "batch_2026_003",
        lastSyncedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
  });

  it("preserves an existing local projection when HCM rejects the employee and location", async () => {
    mockHcmService.reset(createMockHcmSeedState({ balances: [] }));

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 6,
      sourceVersion: "batch_2026_004",
      lastSyncedAt: "2026-01-03T00:00:00.000Z",
    });

    await expect(
      balanceService.refreshBalance("emp_123", "loc_001"),
    ).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LOCATION",
      message: "Employee and location were not found in HCM.",
    });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 6,
        sourceVersion: "batch_2026_004",
        lastSyncedAt: "2026-01-03T00:00:00.000Z",
      }),
    );
  });
});
