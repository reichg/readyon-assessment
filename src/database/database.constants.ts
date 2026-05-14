import { join, resolve } from "node:path";

export const DATABASE_PATH = Symbol("DATABASE_PATH");

const PROJECT_ROOT = resolve(__dirname, "../..");
const DEFAULT_DATABASE_PATH = join(PROJECT_ROOT, "data", "readyon.sqlite");

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

export function getDatabasePathSource():
  | "DATABASE_URL"
  | "READYON_DB_PATH"
  | "DEFAULT" {
  if (process.env.DATABASE_URL) {
    return "DATABASE_URL";
  }

  if (process.env.READYON_DB_PATH) {
    return "READYON_DB_PATH";
  }

  return "DEFAULT";
}

export function getDatabasePath(): string {
  if (process.env.DATABASE_URL) {
    return getDatabasePathFromUrl(process.env.DATABASE_URL);
  }

  return process.env.READYON_DB_PATH ?? DEFAULT_DATABASE_PATH;
}

export function resolveDatabasePath(databasePath: string): string {
  return resolve(databasePath);
}

export function getDatabasePathFromUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Only file: SQLite database URLs are supported.");
  }

  return resolveDatabasePath(decodeURI(databaseUrl.slice("file:".length)));
}

export function getDatabaseUrl(databasePath: string): string {
  const absolutePath = resolveDatabasePath(databasePath).replace(/\\/g, "/");

  return `file:${encodeURI(absolutePath)}`;
}

export function getConfiguredDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? getDatabaseUrl(getDatabasePath());
}

export function getPrismaSchemaPath(): string {
  return join(PROJECT_ROOT, "prisma", "schema.prisma");
}
