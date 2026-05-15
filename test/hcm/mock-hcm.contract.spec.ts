import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { configureApp } from "../../src/app.setup";
import { MockHcmHttpModule } from "../../src/hcm/mock-hcm-http.module";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import { TelemetryModule } from "../../src/telemetry/telemetry.module";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
} from "./mock-hcm.fixtures";

describe("Mock HCM contract", () => {
  let app: INestApplication | undefined;
  let mockHcmService: MockHcmService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TelemetryModule, MockHcmHttpModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    mockHcmService = app.get(MockHcmService);
    mockHcmService.reset(createMockHcmSeedState());
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it("returns the current HCM balance for valid dimensions", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 12 })],
      }),
    );

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/emp_123/loc_001")
      .expect(200)
      .expect({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 12,
      });
  });

  it("returns a clean invalid-dimension error when the balance is missing", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/missing-employee/missing-location")
      .expect(404)
      .expect({
        error: {
          code: "INVALID_EMPLOYEE_LOCATION",
          message: "Employee and location were not found in HCM.",
          retryable: false,
        },
      });
  });

  it("returns a full batch snapshot from the static balances route", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [
          createMockHcmBalance({
            employeeId: "emp_456",
            locationId: "loc_002",
            availableDays: 4,
          }),
          createMockHcmBalance({
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 9,
          }),
        ],
      }),
    );

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/batch")
      .expect(200)
      .expect({
        sourceVersion: "mock_batch_0000",
        effectiveAt: "2026-01-01T00:00:00.000Z",
        balances: [
          {
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 9,
          },
          {
            employeeId: "emp_456",
            locationId: "loc_002",
            availableDays: 4,
          },
        ],
      });
  });

  it("maps scheduled transient balance failures to a retry-safe error contract", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    mockHcmService.scheduleTransientFailure("GET_BALANCE");

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/emp_123/loc_001")
      .expect(503)
      .expect({
        error: {
          code: "HCM_UNAVAILABLE",
          message: "Mock HCM is temporarily unavailable.",
          retryable: true,
        },
      });
  });

  it("returns validation errors with the mock HCM error envelope", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/mock-hcm/time-off")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        days: 0,
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              code: "VALIDATION_ERROR",
              message: "Request validation failed.",
              retryable: false,
            }),
          }),
        );
        expect(body.error.details).toEqual(
          expect.arrayContaining([
            "days must not be less than 1",
            "externalRequestId should not be empty",
            "externalRequestId must be shorter than or equal to 64 characters",
            "externalRequestId must be a string",
          ]),
        );
      });
  });

  it("maps duplicate external request conflicts on the POST time-off route", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/mock-hcm/time-off")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        days: 2,
        externalRequestId: "request_conflict",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/mock-hcm/time-off")
      .send({
        employeeId: "emp_123",
        locationId: "loc_001",
        days: 3,
        externalRequestId: "request_conflict",
      })
      .expect(409)
      .expect({
        error: {
          code: "IDEMPOTENCY_KEY_CONFLICT",
          message: "External request id was reused with a different payload.",
          retryable: false,
        },
      });
  });

  it("maps adjust-route insufficient-balance errors with the mock HCM error envelope", async () => {
    if (!app) {
      throw new Error("Mock HCM app did not initialize.");
    }

    await request(app.getHttpServer())
      .post("/mock-hcm/balances/emp_123/loc_001/adjust")
      .send({
        deltaDays: -11,
      })
      .expect(409)
      .expect({
        error: {
          code: "INSUFFICIENT_BALANCE",
          message:
            "Available balance is insufficient for the requested deduction.",
          retryable: false,
        },
      });
  });
});
