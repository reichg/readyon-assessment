import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
} from "../hcm/mock-hcm.fixtures";
import { createTestDatabasePath } from "../helpers/database-path";
import { closeTestApp, createTestApp } from "../helpers/test-app";

describe("Balances (e2e)", () => {
  let app: INestApplication | undefined;
  let databasePath: string | undefined;
  let mockHcmService: MockHcmService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("balances-e2e");
    app = await createTestApp(databasePath);
    mockHcmService = app.get(MockHcmService);
  });

  afterEach(async () => {
    await closeTestApp(app, databasePath);
    app = undefined;
    databasePath = undefined;
  });

  it("returns the latest known local balance projection", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 10,
      sourceVersion: "batch_2026_001",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });

    await request(app.getHttpServer())
      .get("/balances/emp_123/loc_001")
      .expect(200)
      .expect({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 10,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      });
  });

  it("returns a stable not-found error when no local projection exists", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .get("/balances/missing-employee/missing-location")
      .expect(404)
      .expect({
        error: {
          code: "BALANCE_NOT_FOUND",
          message: "Balance projection was not found.",
        },
      });
  });

  it("returns a stable validation error for oversized route params", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .get(`/balances/${"e".repeat(65)}/loc_001`)
      .expect(400)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              code: "VALIDATION_ERROR",
              message: "Request validation failed.",
            }),
          }),
        );
        expect(body.error.details).toEqual(
          expect.arrayContaining([
            "employeeId must be shorter than or equal to 64 characters",
          ]),
        );
      });
  });

  it("refreshes the local projection from HCM and returns the updated balance", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 8 })],
      }),
    );

    await request(app.getHttpServer())
      .post("/balances/emp_123/loc_001/refresh")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 8,
          lastSyncedAt: expect.any(String),
        });
      });

    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 8,
      }),
    );
  });

  it("returns a stable invalid-dimension error when HCM rejects the employee and location", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);
    mockHcmService.reset(createMockHcmSeedState({ balances: [] }));

    await request(app.getHttpServer())
      .post("/balances/missing-employee/missing-location/refresh")
      .expect(404)
      .expect({
        error: {
          code: "INVALID_EMPLOYEE_LOCATION",
          message: "Employee and location were not found in HCM.",
        },
      });

    await expect(
      balanceRepository.findByEmployeeLocation(
        "missing-employee",
        "missing-location",
      ),
    ).resolves.toBeNull();
  });

  it("returns a stable upstream-unavailable error without corrupting local data", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);
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

    await request(app.getHttpServer())
      .post("/balances/emp_123/loc_001/refresh")
      .expect(503)
      .expect({
        error: {
          code: "HCM_UNAVAILABLE",
          message: "HCM is temporarily unavailable.",
        },
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
});
