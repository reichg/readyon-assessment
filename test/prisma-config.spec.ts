import {
  getConfiguredDatabaseUrl,
  getDatabasePath,
  getDatabasePathFromUrl,
  getDatabaseUrl,
} from "../src/database/database.constants";

describe("Prisma config", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalReadyOnDbPath = process.env.READYON_DB_PATH;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalReadyOnDbPath === undefined) {
      delete process.env.READYON_DB_PATH;
    } else {
      process.env.READYON_DB_PATH = originalReadyOnDbPath;
    }

    jest.resetModules();
  });

  it("uses the READYON_DB_PATH-derived SQLite URL when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;
    process.env.READYON_DB_PATH = "C:\\temp\\readyon-prisma-config.sqlite";

    const { default: prismaConfig } = await import("../prisma.config");

    expect(getConfiguredDatabaseUrl()).toBe(getDatabaseUrl(getDatabasePath()));
    expect(prismaConfig.datasource?.url).toBe(getConfiguredDatabaseUrl());
  });

  it("prefers DATABASE_URL when it is explicitly provided", async () => {
    process.env.DATABASE_URL = "file:/tmp/readyon-explicit.sqlite";
    process.env.READYON_DB_PATH = "C:\\temp\\readyon-prisma-config.sqlite";

    const { default: prismaConfig } = await import("../prisma.config");

    expect(getDatabasePath()).toBe(
      getDatabasePathFromUrl(process.env.DATABASE_URL),
    );
    expect(prismaConfig.datasource?.url).toBe(getConfiguredDatabaseUrl());
  });
});
