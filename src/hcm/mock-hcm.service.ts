import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  createHcmUnavailableError,
  createIdempotencyConflictError,
  createInsufficientBalanceError,
  createInvalidEmployeeLocationError,
  createValidationError,
} from "./mock-hcm.errors";
import type {
  MockHcmAdjustBalanceInput,
  MockHcmBalanceKey,
  MockHcmBalanceRecord,
  MockHcmBatchSnapshot,
  MockHcmOperation,
  MockHcmSeedState,
  MockHcmTimeOffInput,
  MockHcmTimeOffResult,
} from "./shapes/mock-hcm.types";

interface StoredMockHcmRequest {
  fingerprint: string;
  result: MockHcmTimeOffResult;
}

const DEFAULT_EFFECTIVE_AT = "2026-01-01T00:00:00.000Z";
const DEFAULT_MOCK_HCM_SEED_STATE: MockHcmSeedState = {
  balances: [
    {
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 10,
    },
  ],
};

@Injectable()
export class MockHcmService {
  private readonly balances = new Map<string, MockHcmBalanceRecord>();
  private readonly processedRequests = new Map<string, StoredMockHcmRequest>();
  private readonly transientFailures = new Map<MockHcmOperation, number>();
  private batchSequence = 0;
  private sourceVersion = buildSourceVersion(0);
  private effectiveAt = DEFAULT_EFFECTIVE_AT;

  constructor() {
    this.reset(DEFAULT_MOCK_HCM_SEED_STATE);
  }

  reset(seedState: MockHcmSeedState = DEFAULT_MOCK_HCM_SEED_STATE): void {
    this.balances.clear();
    this.processedRequests.clear();
    this.transientFailures.clear();

    for (const balance of seedState.balances) {
      ensureAvailableDays(balance.availableDays);
      this.balances.set(createBalanceKey(balance), cloneBalance(balance));
    }

    this.batchSequence = 0;
    this.sourceVersion = seedState.sourceVersion ?? buildSourceVersion(0);
    this.effectiveAt = seedState.effectiveAt ?? DEFAULT_EFFECTIVE_AT;
  }

  scheduleTransientFailure(operation: MockHcmOperation, count = 1): void {
    if (!Number.isInteger(count) || count < 1) {
      throw createValidationError(
        "Transient failure count must be a positive integer.",
      );
    }

    this.transientFailures.set(
      operation,
      (this.transientFailures.get(operation) ?? 0) + count,
    );
  }

  getBalance(input: MockHcmBalanceKey): MockHcmBalanceRecord {
    this.consumeTransientFailure("GET_BALANCE");
    return cloneBalance(this.requireBalance(input));
  }

  submitTimeOff(input: MockHcmTimeOffInput): MockHcmTimeOffResult {
    ensurePositiveInteger(
      input.days,
      "Requested days must be a positive integer.",
    );
    ensureIdentifier(
      input.externalRequestId,
      "External request id is required.",
    );

    const fingerprint = createFingerprint(input);
    const existingRequest = this.processedRequests.get(input.externalRequestId);

    if (existingRequest) {
      if (existingRequest.fingerprint !== fingerprint) {
        throw createIdempotencyConflictError();
      }

      return cloneTimeOffResult(existingRequest.result);
    }

    this.consumeTransientFailure("SUBMIT_TIME_OFF");

    const balance = this.requireBalance(input);

    if (balance.availableDays < input.days) {
      throw createInsufficientBalanceError();
    }

    const result: MockHcmTimeOffResult = {
      externalRequestId: input.externalRequestId,
      hcmTransactionId: randomUUID(),
      remainingAvailableDays: balance.availableDays - input.days,
      processedAt: new Date().toISOString(),
    };

    balance.availableDays = result.remainingAvailableDays;
    this.processedRequests.set(input.externalRequestId, {
      fingerprint,
      result,
    });
    this.advanceBatchVersion();

    return cloneTimeOffResult(result);
  }

  adjustBalance(input: MockHcmAdjustBalanceInput): MockHcmBalanceRecord {
    ensureNonZeroInteger(
      input.deltaDays,
      "Balance adjustment delta must be a non-zero integer.",
    );
    this.consumeTransientFailure("ADJUST_BALANCE");

    const balance = this.requireBalance(input);
    const nextAvailableDays = balance.availableDays + input.deltaDays;

    if (nextAvailableDays < 0) {
      throw createInsufficientBalanceError();
    }

    balance.availableDays = nextAvailableDays;
    this.advanceBatchVersion();

    return cloneBalance(balance);
  }

  getBatchSnapshot(): MockHcmBatchSnapshot {
    this.consumeTransientFailure("GET_BATCH_SNAPSHOT");

    return {
      sourceVersion: this.sourceVersion,
      effectiveAt: this.effectiveAt,
      balances: Array.from(this.balances.values())
        .map(cloneBalance)
        .sort(compareBalances),
    };
  }

  private requireBalance(input: MockHcmBalanceKey): MockHcmBalanceRecord {
    ensureIdentifier(input.employeeId, "Employee id is required.");
    ensureIdentifier(input.locationId, "Location id is required.");

    const balance = this.balances.get(createBalanceKey(input));

    if (!balance) {
      throw createInvalidEmployeeLocationError();
    }

    return balance;
  }

  private consumeTransientFailure(operation: MockHcmOperation): void {
    const remainingCount = this.transientFailures.get(operation) ?? 0;

    if (remainingCount === 0) {
      return;
    }

    if (remainingCount === 1) {
      this.transientFailures.delete(operation);
    } else {
      this.transientFailures.set(operation, remainingCount - 1);
    }

    throw createHcmUnavailableError();
  }

  private advanceBatchVersion(): void {
    this.batchSequence += 1;
    this.sourceVersion = buildSourceVersion(this.batchSequence);
    this.effectiveAt = new Date().toISOString();
  }
}

function ensureIdentifier(value: string, message: string): void {
  if (value.trim().length === 0) {
    throw createValidationError(message);
  }
}

function ensureAvailableDays(availableDays: number): void {
  ensureNonNegativeInteger(
    availableDays,
    "Available days must be a non-negative integer.",
  );
}

function ensurePositiveInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw createValidationError(message);
  }
}

function ensureNonZeroInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value === 0) {
    throw createValidationError(message);
  }
}

function ensureNonNegativeInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw createValidationError(message);
  }
}

function createFingerprint(input: MockHcmTimeOffInput): string {
  return [input.employeeId, input.locationId, input.days.toString()].join("::");
}

function createBalanceKey(input: MockHcmBalanceKey): string {
  return `${input.employeeId}::${input.locationId}`;
}

function buildSourceVersion(sequence: number): string {
  return `mock_batch_${sequence.toString().padStart(4, "0")}`;
}

function compareBalances(
  left: MockHcmBalanceRecord,
  right: MockHcmBalanceRecord,
): number {
  return `${left.employeeId}::${left.locationId}`.localeCompare(
    `${right.employeeId}::${right.locationId}`,
  );
}

function cloneBalance(balance: MockHcmBalanceRecord): MockHcmBalanceRecord {
  return {
    employeeId: balance.employeeId,
    locationId: balance.locationId,
    availableDays: balance.availableDays,
  };
}

function cloneTimeOffResult(
  result: MockHcmTimeOffResult,
): MockHcmTimeOffResult {
  return {
    externalRequestId: result.externalRequestId,
    hcmTransactionId: result.hcmTransactionId,
    remainingAvailableDays: result.remainingAvailableDays,
    processedAt: result.processedAt,
  };
}
