import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { HcmModule } from "../src/hcm/hcm.module";
import { HealthController } from "../src/health/health.controller";
import { HealthModule } from "../src/health/health.module";
import { ReconciliationModule } from "../src/reconciliation/reconciliation.module";
import { HttpTelemetryInterceptor } from "../src/telemetry/http-telemetry.interceptor";
import { TimeOffModule } from "../src/time-off/time-off.module";

describe("Application scaffold", () => {
  it("configures the Nest application with a global validation pipe", () => {
    const telemetryInterceptor = {} as HttpTelemetryInterceptor;
    const app = {
      useGlobalPipes: jest.fn(),
      useGlobalInterceptors: jest.fn(),
      get: jest.fn().mockReturnValue(telemetryInterceptor),
    } as unknown as INestApplication;

    configureApp(app);

    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.useGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));
    expect(app.get).toHaveBeenCalledWith(HttpTelemetryInterceptor);
    expect(app.useGlobalInterceptors).toHaveBeenCalledWith(
      telemetryInterceptor,
    );
  });

  it("exposes the scaffold modules", () => {
    expect(AppModule).toBeDefined();
    expect(HealthModule).toBeDefined();
    expect(HcmModule).toBeDefined();
    expect(TimeOffModule).toBeDefined();
    expect(ReconciliationModule).toBeDefined();
  });

  it("returns ok from the health controller after a database ping", async () => {
    const databaseService = {
      ping: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new HealthController(databaseService as never);

    await expect(controller.getHealth()).resolves.toEqual({ status: "ok" });
    expect(databaseService.ping).toHaveBeenCalledTimes(1);
  });
});
