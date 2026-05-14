import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../src/database/database.constants";
import { DatabaseModule } from "../src/database/database.module";
import { DatabaseService } from "../src/database/database.service";
import { TelemetryService } from "../src/telemetry/telemetry.service";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "./helpers/database-path";

const EXPECTED_TABLES = [
  "balances",
  "time_off_requests",
  "hcm_transaction_audits",
  "reconciliation_runs",
] as const;

describe("Database bootstrap", () => {
  let moduleRef: TestingModule | undefined;
  let databasePath: string | undefined;
  let databaseService: DatabaseService | undefined;

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

  it("initializes an isolated sqlite database with Prisma-managed schema", async () => {
    databasePath = createTestDatabasePath("sqlite-bootstrap");
    process.env.READYON_DB_PATH = databasePath;

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const telemetryService = moduleRef.get(TelemetryService);
    const infoSpy = jest.spyOn(telemetryService, "info");

    await moduleRef.init();

    databaseService = moduleRef.get(DatabaseService);
    const prisma = databaseService!;

    const bootstrapEvent = infoSpy.mock.calls.find(
      ([event]) => event.event === "db.bootstrap.ready",
    )?.[0];

    expect(bootstrapEvent).toEqual(
      expect.objectContaining({
        event: "db.bootstrap.ready",
        component: "DatabaseService",
        operation: "onModuleInit",
        outcome: "success",
        databaseEngine: "sqlite",
        databaseAdapter: "libsql",
        databaseSource: "READYON_DB_PATH",
      }),
    );
    expect(bootstrapEvent).not.toHaveProperty("databasePath");
    expect(bootstrapEvent).not.toHaveProperty("databaseUrl");

    const tables = (await prisma.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )) as Array<{ name: string }>;

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(EXPECTED_TABLES),
    );
    expect(tables.map((table) => table.name)).not.toContain("app_metadata");

    await expect(prisma.ping()).resolves.toBeUndefined();
    expect(await prisma.balance.count()).toBe(0);

    await prisma.balance.create({
      data: {
        id: "balance-bootstrap-1",
        employeeId: "emp-bootstrap-1",
        locationId: "loc-bootstrap-1",
        availableDays: 10,
        sourceVersion: "bootstrap-1",
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const storedRow = await prisma.balance.findUnique({
      where: { id: "balance-bootstrap-1" },
    });

    expect(storedRow?.availableDays).toBe(10);

    const transactionCount = await prisma.$transaction(async (transaction) => {
      await transaction.balance.create({
        data: {
          id: "balance-bootstrap-2",
          employeeId: "emp-bootstrap-2",
          locationId: "loc-bootstrap-2",
          availableDays: 8,
          sourceVersion: "bootstrap-2",
          lastSyncedAt: "2026-01-02T00:00:00.000Z",
          createdAt: "2026-01-02T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      });

      return transaction.balance.count();
    });

    expect(transactionCount).toBe(2);
  });

  it("initializes an isolated sqlite database from DATABASE_URL", async () => {
    databasePath = createTestDatabasePath("sqlite-bootstrap-url");
    process.env.DATABASE_URL = getDatabaseUrl(databasePath);

    moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    const telemetryService = moduleRef.get(TelemetryService);
    const infoSpy = jest.spyOn(telemetryService, "info");

    await moduleRef.init();

    databaseService = moduleRef.get(DatabaseService);
    const prisma = databaseService!;

    const bootstrapEvent = infoSpy.mock.calls.find(
      ([event]) => event.event === "db.bootstrap.ready",
    )?.[0];

    expect(bootstrapEvent).toEqual(
      expect.objectContaining({
        event: "db.bootstrap.ready",
        databaseSource: "DATABASE_URL",
      }),
    );

    expect(existsSync(databasePath)).toBe(true);
    await expect(prisma.ping()).resolves.toBeUndefined();
    expect(await prisma.balance.count()).toBe(0);
  });
});
