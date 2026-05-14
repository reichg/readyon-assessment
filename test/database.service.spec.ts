jest.mock("node:child_process", () => {
  const actual = jest.requireActual("node:child_process");

  return {
    ...actual,
    execFileSync: jest.fn(actual.execFileSync),
  };
});

jest.mock("node:fs", () => {
  const actual = jest.requireActual("node:fs");

  return {
    ...actual,
    existsSync: jest.fn(actual.existsSync),
  };
});

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { DatabaseService } from "../src/database/database.service";
import type { TelemetryService } from "../src/telemetry/telemetry.service";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "./helpers/database-path";

function createTelemetryServiceMock(): jest.Mocked<
  Pick<TelemetryService, "info" | "warn" | "error">
> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

describe("DatabaseService failure handling", () => {
  let databasePath: string | undefined;

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.READYON_DB_PATH;
    jest.restoreAllMocks();
    jest.clearAllMocks();
    removeDatabaseFiles(databasePath);
    databasePath = undefined;
  });

  it("fails with a generic message when the Prisma schema file is missing", async () => {
    databasePath = createTestDatabasePath("database-service-missing-schema");
    const telemetryService = createTelemetryServiceMock();
    const service = new DatabaseService(
      databasePath,
      telemetryService as unknown as TelemetryService,
    );
    jest.mocked(fs.existsSync).mockReturnValue(false);

    await expect(service.onModuleInit()).rejects.toThrow(
      "Prisma schema file is missing.",
    );

    const failureEvent = telemetryService.error.mock.calls.find(
      ([event]) => event.event === "db.bootstrap.failed",
    )?.[0];

    expect(failureEvent).toEqual(
      expect.objectContaining({
        event: "db.bootstrap.failed",
        component: "DatabaseService",
        operation: "onModuleInit",
        outcome: "failure",
        errorName: "Error",
      }),
    );
    expect(failureEvent).not.toHaveProperty("databasePath");
    expect(failureEvent).not.toHaveProperty("databaseUrl");

    await service.onModuleDestroy();
  });

  it("fails with a generic message when Prisma migrate deploy fails", async () => {
    databasePath = createTestDatabasePath("database-service-migrate-failure");
    const telemetryService = createTelemetryServiceMock();
    const service = new DatabaseService(
      databasePath,
      telemetryService as unknown as TelemetryService,
    );
    jest.mocked(fs.existsSync).mockReturnValue(true);
    jest.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error("migrate failed");
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      "Database schema could not be applied.",
    );

    const failureEvent = telemetryService.error.mock.calls.find(
      ([event]) => event.event === "db.bootstrap.failed",
    )?.[0];

    expect(failureEvent).toEqual(
      expect.objectContaining({
        event: "db.bootstrap.failed",
        outcome: "failure",
        errorName: "Error",
      }),
    );
    expect(failureEvent).not.toHaveProperty("databasePath");
    expect(failureEvent).not.toHaveProperty("databaseUrl");

    await service.onModuleDestroy();
  });
});
