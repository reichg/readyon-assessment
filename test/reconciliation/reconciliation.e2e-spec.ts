import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { createTestDatabasePath } from "../helpers/database-path";
import { closeTestApp, createTestApp } from "../helpers/test-app";

describe("Reconciliation (e2e)", () => {
  let app: INestApplication | undefined;
  let databasePath: string | undefined;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("reconciliation-e2e");
    app = await createTestApp(databasePath);
  });

  afterEach(async () => {
    await closeTestApp(app, databasePath);
    app = undefined;
    databasePath = undefined;
  });

  it("ingests a batch snapshot and updates local projections", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 1,
      sourceVersion: "batch_2026_000",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });

    const batchSnapshot = {
      sourceVersion: "batch_2026_050",
      effectiveAt: "2026-01-15T00:00:00.000Z",
      balances: [
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 10,
        },
        {
          employeeId: "emp_456",
          locationId: "loc_002",
          availableDays: 6,
        },
      ],
    };

    await request(app.getHttpServer())
      .post("/hcm/balances/batch")
      .send(batchSnapshot)
      .expect(200)
      .expect({
        sourceVersion: "batch_2026_050",
        received: 2,
        inserted: 1,
        updated: 1,
        ignored: 0,
        rejected: 0,
      });

    await request(app.getHttpServer())
      .get("/balances/emp_123/loc_001")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 10,
          lastSyncedAt: expect.any(String),
        });
      });

    await request(app.getHttpServer())
      .get("/balances/emp_456/loc_002")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_456",
          locationId: "loc_002",
          availableDays: 6,
          lastSyncedAt: expect.any(String),
        });
      });
  });

  it("returns a stable validation error for invalid batch payloads", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/hcm/balances/batch")
      .send({
        effectiveAt: "not-an-iso-date",
        balances: [],
      })
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
        expect(body.error.details).toEqual({
          violations: expect.arrayContaining([
            "sourceVersion should not be empty",
            "sourceVersion must be a string",
            "effectiveAt must be a valid ISO 8601 date string",
          ]),
        });
      });
  });

  it("rejects duplicate rows with a stable domain error", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/hcm/balances/batch")
      .send({
        sourceVersion: "batch_2026_051",
        effectiveAt: "2026-01-16T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 5,
          },
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 7,
          },
        ],
      })
      .expect(400)
      .expect({
        error: {
          code: "DUPLICATE_RECONCILIATION_ROW",
          message:
            "Reconciliation batch contains duplicate employee/location rows.",
          details: {
            duplicateKeys: ["emp_123::loc_001"],
          },
        },
      });
  });

  it("rejects stale batches after a newer snapshot has already been applied", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/hcm/balances/batch")
      .send({
        sourceVersion: "batch_2026_060",
        effectiveAt: "2026-01-20T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 8,
          },
        ],
      })
      .expect(200);

    await request(app.getHttpServer())
      .post("/hcm/balances/batch")
      .send({
        sourceVersion: "batch_2026_061",
        effectiveAt: "2026-01-20T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 4,
          },
        ],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual({
          error: {
            code: "STALE_SOURCE_VERSION",
            message:
              "Reconciliation batch is stale compared with the latest applied snapshot.",
            details: {
              receivedSourceVersion: "batch_2026_061",
              receivedEffectiveAt: "2026-01-20T00:00:00.000Z",
              latestSourceVersion: "batch_2026_060",
              latestEffectiveAt: "2026-01-20T00:00:00.000Z",
            },
          },
        });
      });

    await request(app.getHttpServer())
      .get("/balances/emp_123/loc_001")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 8,
          lastSyncedAt: expect.any(String),
        });
      });
  });
});
