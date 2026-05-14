import type { INestApplication } from "@nestjs/common";
import { existsSync } from "node:fs";
import { TelemetryService } from "../src/telemetry/telemetry.service";
import request from "supertest";
import { closeTestApp, createTestApp } from "./helpers/test-app";
import { createTestDatabasePath } from "./helpers/database-path";

const TRUSTED_REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("Health (e2e)", () => {
  let app: INestApplication | undefined;
  let databasePath: string | undefined;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("health-e2e");
    app = await createTestApp(databasePath);
  });

  afterEach(async () => {
    await closeTestApp(app, databasePath);
    app = undefined;
    databasePath = undefined;
  });

  it("returns service liveness and initializes sqlite", async () => {
    if (!app || !databasePath) {
      throw new Error("Test application did not initialize.");
    }

    const telemetryService = app.get(TelemetryService);
    const telemetryLogger = (
      telemetryService as unknown as {
        logger: {
          log: (message: string) => void;
        };
      }
    ).logger;
    const logSpy = jest.spyOn(telemetryLogger, "log");

    const response = await request(app.getHttpServer())
      .get("/health")
      .set("x-request-id", TRUSTED_REQUEST_ID)
      .expect(200)
      .expect({ status: "ok" });

    expect(existsSync(databasePath)).toBe(true);
    expect(response.headers["x-request-id"]).toBe(TRUSTED_REQUEST_ID);

    const events = logSpy.mock.calls.map(([message]) => JSON.parse(message));
    const requestEvent = events.find(
      (event) => event.event === "http.request.completed",
    );
    const pingEvent = events.find(
      (event) => event.event === "db.ping.completed",
    );

    expect(requestEvent).toEqual(
      expect.objectContaining({
        event: "http.request.completed",
        component: "HttpTelemetryInterceptor",
        operation: "intercept",
        outcome: "success",
        requestId: TRUSTED_REQUEST_ID,
        method: "GET",
        route: "/health",
        controller: "HealthController",
        handler: "getHealth",
        statusCode: 200,
      }),
    );
    expect(pingEvent).toEqual(
      expect.objectContaining({
        event: "db.ping.completed",
        component: "DatabaseService",
        operation: "ping",
        outcome: "success",
        requestId: TRUSTED_REQUEST_ID,
      }),
    );
    expect(requestEvent).not.toHaveProperty("body");
    expect(requestEvent).not.toHaveProperty("employeeId");
  });

  it("sanitizes malformed inbound request ids before echoing or logging them", async () => {
    if (!app) {
      throw new Error("Test application did not initialize.");
    }

    const telemetryService = app.get(TelemetryService);
    const telemetryLogger = (
      telemetryService as unknown as {
        logger: {
          log: (message: string) => void;
        };
      }
    ).logger;
    const logSpy = jest.spyOn(telemetryLogger, "log");
    const invalidRequestId = "not-a-trusted-request-id";

    const response = await request(app.getHttpServer())
      .get("/health")
      .set("x-request-id", invalidRequestId)
      .expect(200);

    const sanitizedRequestId = response.headers["x-request-id"];
    const events = logSpy.mock.calls.map(([message]) => JSON.parse(message));
    const requestEvent = events.find(
      (event) => event.event === "http.request.completed",
    );
    const pingEvent = events.find(
      (event) => event.event === "db.ping.completed",
    );

    expect(sanitizedRequestId).toMatch(UUID_PATTERN);
    expect(sanitizedRequestId).not.toBe(invalidRequestId);
    expect(requestEvent).toEqual(
      expect.objectContaining({
        event: "http.request.completed",
        requestId: sanitizedRequestId,
      }),
    );
    expect(pingEvent).toEqual(
      expect.objectContaining({
        event: "db.ping.completed",
        requestId: sanitizedRequestId,
      }),
    );
  });
});
