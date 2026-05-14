import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  DATABASE_PATH,
  getDatabaseUrl,
  getDatabasePathSource,
  getPrismaSchemaPath,
  getProjectRoot,
  resolveDatabasePath,
} from "./database.constants";
import { getDurationMs, getErrorName } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly databasePath: string;
  private readonly databaseUrl: string;

  constructor(
    @Inject(DATABASE_PATH) databasePath: string,
    @Inject(TelemetryService)
    private readonly telemetryService?: TelemetryService,
  ) {
    const absolutePath = resolveDatabasePath(databasePath);
    const databaseUrl = getDatabaseUrl(absolutePath);
    const adapter = new PrismaLibSql({ url: databaseUrl });

    mkdirSync(dirname(absolutePath), { recursive: true });

    super({
      adapter,
    });

    this.databasePath = absolutePath;
    this.databaseUrl = databaseUrl;
  }

  async onModuleInit(): Promise<void> {
    const startedAt = process.hrtime.bigint();

    try {
      this.applyMigrations();
      await this.$connect();
      await this.$queryRawUnsafe("PRAGMA journal_mode = WAL");
      await this.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
      await this.$queryRawUnsafe("PRAGMA foreign_keys = ON");

      this.telemetryService?.info({
        event: "db.bootstrap.ready",
        component: "DatabaseService",
        operation: "onModuleInit",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        databaseEngine: "sqlite",
        databaseAdapter: "libsql",
        databaseSource: getDatabasePathSource(),
      });
    } catch (error) {
      this.telemetryService?.error({
        event: "db.bootstrap.failed",
        component: "DatabaseService",
        operation: "onModuleInit",
        outcome: "failure",
        durationMs: getDurationMs(startedAt),
        databaseEngine: "sqlite",
        databaseAdapter: "libsql",
        databaseSource: getDatabasePathSource(),
        errorName: getErrorName(error),
      });

      throw error;
    }
  }

  async ping(): Promise<void> {
    const startedAt = process.hrtime.bigint();

    try {
      await this.$queryRawUnsafe("SELECT 1");

      this.telemetryService?.info({
        event: "db.ping.completed",
        component: "DatabaseService",
        operation: "ping",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
      });
    } catch (error) {
      this.telemetryService?.warn({
        event: "db.ping.failed",
        component: "DatabaseService",
        operation: "ping",
        outcome: "failure",
        durationMs: getDurationMs(startedAt),
        errorName: getErrorName(error),
      });

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    const startedAt = process.hrtime.bigint();

    try {
      await this.$disconnect();

      this.telemetryService?.info({
        event: "db.disconnect.completed",
        component: "DatabaseService",
        operation: "onModuleDestroy",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
      });
    } catch (error) {
      this.telemetryService?.warn({
        event: "db.disconnect.failed",
        component: "DatabaseService",
        operation: "onModuleDestroy",
        outcome: "failure",
        durationMs: getDurationMs(startedAt),
        errorName: getErrorName(error),
      });

      throw error;
    }
  }

  private applyMigrations(): void {
    const schemaPath = getPrismaSchemaPath();

    if (!existsSync(schemaPath)) {
      throw new Error("Prisma schema file is missing.");
    }

    try {
      execFileSync(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          schemaPath,
        ],
        {
          cwd: getProjectRoot(),
          env: {
            ...process.env,
            DATABASE_URL: this.databaseUrl,
            READYON_DB_PATH: this.databasePath,
          },
          stdio: "pipe",
        },
      );
    } catch {
      throw new Error("Database schema could not be applied.");
    }
  }
}
