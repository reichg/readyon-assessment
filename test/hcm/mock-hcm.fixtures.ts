import type {
  MockHcmBalanceRecord,
  MockHcmSeedState,
  MockHcmTimeOffInput,
} from "../../src/hcm/shapes/mock-hcm.types";

export function createMockHcmBalance(
  overrides: Partial<MockHcmBalanceRecord> = {},
): MockHcmBalanceRecord {
  return {
    employeeId: "emp_123",
    locationId: "loc_001",
    availableDays: 10,
    ...overrides,
  };
}

export function createMockHcmSeedState(
  overrides: Partial<MockHcmSeedState> = {},
): MockHcmSeedState {
  return {
    balances: [createMockHcmBalance()],
    ...overrides,
  };
}

export function createMockHcmTimeOffInput(
  overrides: Partial<MockHcmTimeOffInput> = {},
): MockHcmTimeOffInput {
  return {
    employeeId: "emp_123",
    locationId: "loc_001",
    days: 2,
    externalRequestId: "request_123",
    ...overrides,
  };
}
