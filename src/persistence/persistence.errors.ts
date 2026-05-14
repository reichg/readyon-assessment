import { Prisma } from "@prisma/client";

const PRISMA_CONSTRAINT_ERROR_CODES = new Set([
  "P2003",
  "P2004",
  "P2011",
  "P2012",
  "P2014",
]);

interface SqliteConstraintLikeError extends Error {
  code?: string;
}

export class PersistenceConflictError extends Error {
  constructor(
    public readonly constraint: string,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

export class PersistenceConstraintError extends Error {
  constructor(
    public readonly constraint: string,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceConstraintError";
  }
}

export class PersistenceUnexpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceUnexpectedError";
  }
}

export type PersistenceErrorCategory = "conflict" | "constraint" | "unexpected";

export function classifyPersistenceError(
  error: Error,
): PersistenceErrorCategory {
  if (error instanceof PersistenceConflictError) {
    return "conflict";
  }

  if (error instanceof PersistenceConstraintError) {
    return "constraint";
  }

  return "unexpected";
}

export function translatePersistenceError(
  error: unknown,
  constraint: string,
  message: string,
): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new PersistenceConflictError(constraint, message);
    }

    if (PRISMA_CONSTRAINT_ERROR_CODES.has(error.code)) {
      return new PersistenceConstraintError(constraint, message);
    }

    return createUnexpectedPersistenceError(message, error);
  }

  if (
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return createUnexpectedPersistenceError(message, error);
  }

  if (error instanceof Error) {
    const sqliteError = error as SqliteConstraintLikeError;
    const errorCode =
      typeof sqliteError.code === "string" ? sqliteError.code : undefined;
    const errorMessage = sqliteError.message;

    if (
      (typeof errorCode === "string" &&
        errorCode.startsWith("SQLITE_CONSTRAINT")) ||
      errorMessage.includes("SQLITE_CONSTRAINT")
    ) {
      if (
        errorCode === "SQLITE_CONSTRAINT_UNIQUE" ||
        errorCode === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
        errorMessage.includes("UNIQUE constraint failed")
      ) {
        return new PersistenceConflictError(constraint, message);
      }

      return new PersistenceConstraintError(constraint, message);
    }
  }

  return createUnexpectedPersistenceError(message, error);
}

function createUnexpectedPersistenceError(
  message: string,
  cause: unknown,
): PersistenceUnexpectedError {
  const unexpectedError = new PersistenceUnexpectedError(message);

  if (cause instanceof Error) {
    Object.defineProperty(unexpectedError, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  return unexpectedError;
}
