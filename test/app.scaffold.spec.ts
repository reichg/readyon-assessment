import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { getDatabasePath } from "../src/database/database.constants";
import { HcmModule } from "../src/hcm/hcm.module";
import { HealthController } from "../src/health/health.controller";
import { HealthModule } from "../src/health/health.module";
import { ReconciliationModule } from "../src/reconciliation/reconciliation.module";
import {
  DEFAULT_PORT,
  getPort,
  isMockHcmHttpEnabled,
  loadEnvironmentFileIfPresent,
} from "../src/runtime-environment";
import { HttpTelemetryInterceptor } from "../src/telemetry/http-telemetry.interceptor";
import { TimeOffModule } from "../src/time-off/time-off.module";

const RUNTIME_ENV_KEYS = new Set([
  "database_url",
  "port",
  "readyon_db_path",
  "readyon_enable_mock_hcm_http",
]);

function createRuntimeEnvironmentSnapshot(): Array<[string, string]> {
  return Object.entries(process.env).filter(([key, value]) => {
    return value !== undefined && RUNTIME_ENV_KEYS.has(key.toLowerCase());
  }) as Array<[string, string]>;
}

function clearRuntimeEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (RUNTIME_ENV_KEYS.has(key.toLowerCase())) {
      delete process.env[key];
    }
  }
}

function restoreRuntimeEnvironment(
  environmentSnapshot: Array<[string, string]>,
): void {
  clearRuntimeEnvironment();

  for (const [key, value] of environmentSnapshot) {
    process.env[key] = value;
  }
}

function createEnvironmentFile(contents: string): {
  environmentDirectory: string;
  environmentFilePath: string;
} {
  const environmentDirectory = mkdtempSync(join(tmpdir(), "readyon-env-"));
  const environmentFilePath = join(environmentDirectory, ".env");

  writeFileSync(environmentFilePath, contents, "utf8");

  return {
    environmentDirectory,
    environmentFilePath,
  };
}

describe("Application scaffold", () => {
  const environmentSnapshot = createRuntimeEnvironmentSnapshot();

  afterEach(() => {
    restoreRuntimeEnvironment(environmentSnapshot);
  });

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

  it("loads runtime values from env files when present", () => {
    const { environmentDirectory, environmentFilePath } = createEnvironmentFile(
      "READYON_DB_PATH=env-data/readyon-from-env.sqlite\nREADYON_ENABLE_MOCK_HCM_HTTP=true\n",
    );

    clearRuntimeEnvironment();

    try {
      expect(loadEnvironmentFileIfPresent(environmentFilePath)).toBe(true);
      expect(isMockHcmHttpEnabled()).toBe(true);
      expect(getDatabasePath()).toContain("env-data");
      expect(getDatabasePath()).toContain("readyon-from-env.sqlite");
    } finally {
      rmSync(environmentDirectory, { recursive: true, force: true });
    }
  });

  it("reads configured port values from the runtime environment", () => {
    clearRuntimeEnvironment();
    process.env.PORT = "4123";

    expect(getPort()).toBe(4123);
  });

  it("keeps explicit runtime env values over env file values", () => {
    const { environmentDirectory, environmentFilePath } = createEnvironmentFile(
      "PORT=4123\nREADYON_ENABLE_MOCK_HCM_HTTP=true\n",
    );

    clearRuntimeEnvironment();
    process.env.PORT = "5123";
    process.env.READYON_ENABLE_MOCK_HCM_HTTP = "false";

    try {
      expect(loadEnvironmentFileIfPresent(environmentFilePath)).toBe(true);
      expect(getPort()).toBe(5123);
      expect(isMockHcmHttpEnabled()).toBe(false);
    } finally {
      rmSync(environmentDirectory, { recursive: true, force: true });
    }
  });

  it("keeps missing env files optional and falls back to the default port", () => {
    clearRuntimeEnvironment();

    expect(
      loadEnvironmentFileIfPresent(
        join(tmpdir(), "readyon-missing-env", ".env"),
      ),
    ).toBe(false);
    expect(getPort()).toBe(DEFAULT_PORT);
    expect(isMockHcmHttpEnabled()).toBe(false);
  });
});
