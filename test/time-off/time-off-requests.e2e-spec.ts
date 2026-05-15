import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DatabaseService } from "../../src/database/database.service";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { TimeOffRequestRepository } from "../../src/persistence/time-off-request.repository";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
} from "../hcm/mock-hcm.fixtures";
import { createTestDatabasePath } from "../helpers/database-path";
import { closeTestApp, createTestApp } from "../helpers/test-app";

describe("TimeOffRequests (e2e)", () => {
  let app: INestApplication | undefined;
  let databasePath: string | undefined;
  let mockHcmService: MockHcmService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("time-off-requests-e2e");
    app = await createTestApp(databasePath);
    mockHcmService = app.get(MockHcmService);
  });

  afterEach(async () => {
    await closeTestApp(app, databasePath);
    app = undefined;
    databasePath = undefined;
  });

  it("creates a pending request and returns it by id", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const timeOffRequestRepository = app.get(TimeOffRequestRepository);

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    expect(createResponse.body).toEqual({
      id: expect.any(String),
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      status: "PENDING",
      failureCode: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      approvedAt: null,
      rejectedAt: null,
    });

    await expect(
      timeOffRequestRepository.findById(createResponse.body.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: createResponse.body.id,
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
        status: "PENDING",
      }),
    );

    await request(app.getHttpServer())
      .get(`/time-off-requests/${createResponse.body.id}`)
      .expect(200)
      .expect(createResponse.body);
  });

  it("returns the original request on idempotent replay with the same payload", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const initialResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
        idempotencyKey: "idem-e2e-123",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
        idempotencyKey: "idem-e2e-123",
      })
      .expect(200)
      .expect(initialResponse.body);
  });

  it("returns a stable idempotency conflict for the same key with a different payload", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer()).post("/time-off-requests").send({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-e2e-conflict",
    });

    await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 3,
        idempotencyKey: "idem-e2e-conflict",
      })
      .expect(409)
      .expect({
        error: {
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message:
            "Idempotency key was reused with a different request payload.",
        },
      });
  });

  it("returns a stable insufficient-balance error when the known local projection is too low", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const balanceRepository = app.get(BalanceRepository);
    const databaseService = app.get(DatabaseService);

    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 1,
      sourceVersion: "batch_2026_010",
      lastSyncedAt: "2026-01-10T00:00:00.000Z",
    });

    await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(409)
      .expect({
        error: {
          code: "INSUFFICIENT_BALANCE",
          message:
            "Available balance is insufficient for the requested time off.",
        },
      });

    await expect(databaseService.timeOffRequest.count()).resolves.toBe(0);
  });

  it.each([
    {
      description: "zero requestedDays",
      body: {
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 0,
      },
      detail: "requestedDays must not be less than 1",
    },
    {
      description: "negative requestedDays",
      body: {
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: -1,
      },
      detail: "requestedDays must not be less than 1",
    },
    {
      description: "missing employeeId",
      body: {
        locationId: "loc_001",
        requestedDays: 1,
      },
      detail: "employeeId should not be empty",
    },
    {
      description: "missing locationId",
      body: {
        employeeId: "emp_123",
        requestedDays: 1,
      },
      detail: "locationId should not be empty",
    },
  ])(
    "returns a stable validation error for $description",
    async ({ body, detail }) => {
      if (!app) {
        throw new Error("Test application did not initialize.");
      }

      await request(app.getHttpServer())
        .post("/time-off-requests")
        .send(body)
        .expect(400)
        .expect(({ body: responseBody }) => {
          expect(responseBody).toEqual(
            expect.objectContaining({
              error: expect.objectContaining({
                code: "VALIDATION_ERROR",
                message: "Request validation failed.",
              }),
            }),
          );
          expect(responseBody.error.details).toEqual(
            expect.arrayContaining([detail]),
          );
        });
    },
  );

  it("returns a stable not-found error when a request does not exist", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    await request(app.getHttpServer())
      .get("/time-off-requests/missing-request")
      .expect(404)
      .expect({
        error: {
          code: "TIME_OFF_REQUEST_NOT_FOUND",
          message: "Time off request was not found.",
        },
      });
  });

  it("approves a pending request after HCM accepts and updates the local projection", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    const approveResponse = await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(200);

    expect(approveResponse.body).toEqual({
      ...createResponse.body,
      status: "APPROVED",
      updatedAt: expect.any(String),
      approvedAt: expect.any(String),
      rejectedAt: null,
    });

    await request(app.getHttpServer())
      .get(`/time-off-requests/${createResponse.body.id}`)
      .expect(200)
      .expect(approveResponse.body);

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

  it("returns an approval rejection when HCM reports insufficient balance", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 1 })],
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(409)
      .expect({
        error: {
          code: "INSUFFICIENT_BALANCE",
          message:
            "Available balance is insufficient for the requested time off.",
        },
      });

    await request(app.getHttpServer())
      .get(`/time-off-requests/${createResponse.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          ...createResponse.body,
          status: "REJECTED",
          failureCode: "INSUFFICIENT_BALANCE",
          updatedAt: expect.any(String),
          approvedAt: null,
          rejectedAt: expect.any(String),
        });
      });

    await request(app.getHttpServer())
      .get("/balances/emp_123/loc_001")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 1,
          lastSyncedAt: expect.any(String),
        });
      });
  });

  it("returns an approval rejection when HCM rejects the employee and location", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(createMockHcmSeedState({ balances: [] }));

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_missing",
        locationId: "loc_missing",
        requestedDays: 2,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(409)
      .expect({
        error: {
          code: "INVALID_EMPLOYEE_LOCATION",
          message: "Employee and location were not found in HCM.",
        },
      });

    await request(app.getHttpServer())
      .get(`/time-off-requests/${createResponse.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          ...createResponse.body,
          status: "REJECTED",
          failureCode: "INVALID_EMPLOYEE_LOCATION",
          updatedAt: expect.any(String),
          approvedAt: null,
          rejectedAt: expect.any(String),
        });
      });
  });

  it("returns upstream unavailable without approving the request when HCM cannot confirm it", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    mockHcmService.scheduleTransientFailure("SUBMIT_TIME_OFF");

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(503)
      .expect({
        error: {
          code: "HCM_UNAVAILABLE",
          message: "HCM is temporarily unavailable.",
        },
      });

    await request(app.getHttpServer())
      .get(`/time-off-requests/${createResponse.body.id}`)
      .expect(200)
      .expect(createResponse.body);

    await request(app.getHttpServer())
      .get("/balances/emp_123/loc_001")
      .expect(404)
      .expect({
        error: {
          code: "BALANCE_NOT_FOUND",
          message: "Balance projection was not found.",
        },
      });
  });

  it("rejects a pending request without deducting from HCM", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    const rejectedResponse = await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/reject`)
      .expect(200);

    expect(rejectedResponse.body).toEqual({
      ...createResponse.body,
      status: "REJECTED",
      updatedAt: expect.any(String),
      approvedAt: null,
      rejectedAt: expect.any(String),
    });
    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }),
    ).toEqual(
      expect.objectContaining({
        availableDays: 10,
      }),
    );
  });

  it("returns invalid-request-state when approving a non-pending request", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/reject`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(409)
      .expect({
        error: {
          code: "INVALID_REQUEST_STATE",
          message:
            "Time off request is not in a valid state for this operation.",
        },
      });
  });

  it("returns invalid-request-state when rejecting an approved request", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );

    const createResponse = await request(app.getHttpServer())
      .post("/time-off-requests")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/approve`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/time-off-requests/${createResponse.body.id}/reject`)
      .expect(409)
      .expect({
        error: {
          code: "INVALID_REQUEST_STATE",
          message:
            "Time off request is not in a valid state for this operation.",
        },
      });
  });
});
