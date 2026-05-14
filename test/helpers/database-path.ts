import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestDatabasePath(scope: string): string {
  const sanitizedScope = scope.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return join(
    tmpdir(),
    `readyon-${sanitizedScope}-${process.pid}-${randomUUID()}.sqlite`,
  );
}

export function removeDatabaseFiles(databasePath: string | undefined): void {
  if (!databasePath) {
    return;
  }

  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      rmSync(`${databasePath}${suffix}`, { force: true });
    } catch {
      // Best-effort cleanup keeps isolated test paths from turning Windows file-lock timing into false negatives.
    }
  }
}
