import type { INestApplication, Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppWithMockHcmModule } from "../../src/app-with-mock-hcm.module";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "../helpers/database-path";

let databasePath: string | undefined;

describe("Mock HCM live app composition (e2e)", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }

    delete process.env.DATABASE_URL;
    delete process.env.READYON_DB_PATH;
    delete process.env.READYON_ENABLE_MOCK_HCM_HTTP;
    removeDatabaseFiles(databasePath);
    databasePath = undefined;
  });

  it("keeps /mock-hcm routes disabled in the standard app composition", async () => {
    app = await createApp(AppModule, "mock-hcm-disabled");

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/emp_123/loc_001")
      .expect(404);
  });

  it("exposes a live mock HCM surface that drives public refresh behavior when enabled", async () => {
    process.env.READYON_ENABLE_MOCK_HCM_HTTP = "true";
    app = await createApp(AppWithMockHcmModule, "mock-hcm-enabled");

    await request(app.getHttpServer())
      .get("/mock-hcm/balances/emp_123/loc_001")
      .expect(200)
      .expect({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 10,
      });

    await request(app.getHttpServer())
      .post("/mock-hcm/balances/emp_123/loc_001/adjust")
      .send({
        deltaDays: 3,
      })
      .expect(201)
      .expect({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 13,
      });

    await request(app.getHttpServer())
      .post("/balances/emp_123/loc_001/refresh")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          employeeId: "emp_123",
          locationId: "loc_001",
          availableDays: 13,
          lastSyncedAt: expect.any(String),
        });
      });
  });
});

async function createApp(
  rootModule: Type<unknown>,
  scope: string,
): Promise<INestApplication> {
  databasePath = createTestDatabasePath(scope);
  process.env.READYON_DB_PATH = databasePath;

  const moduleRef = await Test.createTestingModule({
    imports: [rootModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return app;
}
