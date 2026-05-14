export function getDurationMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
