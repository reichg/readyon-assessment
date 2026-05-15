import { MockHcmError } from "../../src/hcm/mock-hcm.errors";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
  createMockHcmTimeOffInput,
} from "./mock-hcm.fixtures";

describe("MockHcmService", () => {
  let mockHcmService: MockHcmService;

  beforeEach(() => {
    mockHcmService = new MockHcmService();
    mockHcmService.reset(createMockHcmSeedState());
  });

  it("deducts time off once and replays duplicate external request ids idempotently", () => {
    const request = createMockHcmTimeOffInput();

    const firstResult = mockHcmService.submitTimeOff(request);
    const replayResult = mockHcmService.submitTimeOff(request);
    const balance = mockHcmService.getBalance({
      employeeId: request.employeeId,
      locationId: request.locationId,
    });

    expect(replayResult).toEqual(firstResult);
    expect(firstResult.hcmTransactionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(firstResult.remainingAvailableDays).toBe(8);
    expect(balance.availableDays).toBe(8);
  });

  it("rejects insufficient balance without partial mutation", () => {
    expect(() =>
      mockHcmService.submitTimeOff(
        createMockHcmTimeOffInput({
          days: 11,
          externalRequestId: "request_insufficient",
        }),
      ),
    ).toThrow(MockHcmError);

    expect(() =>
      mockHcmService.submitTimeOff(
        createMockHcmTimeOffInput({
          days: 11,
          externalRequestId: "request_insufficient",
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "INSUFFICIENT_BALANCE",
        retryable: false,
        statusCode: 409,
      }),
    );

    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }).availableDays,
    ).toBe(10);
  });

  it("supports independent external balance increases and decreases", () => {
    const increased = mockHcmService.adjustBalance({
      employeeId: "emp_123",
      locationId: "loc_001",
      deltaDays: 3,
    });
    const decreased = mockHcmService.adjustBalance({
      employeeId: "emp_123",
      locationId: "loc_001",
      deltaDays: -2,
    });

    expect(increased.availableDays).toBe(13);
    expect(decreased.availableDays).toBe(11);
    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }).availableDays,
    ).toBe(11);
  });

  it("keeps state retry-safe when a transient submission failure is injected", () => {
    const request = createMockHcmTimeOffInput({
      externalRequestId: "request_transient",
    });
    mockHcmService.scheduleTransientFailure("SUBMIT_TIME_OFF");

    expect(() => mockHcmService.submitTimeOff(request)).toThrow(
      expect.objectContaining({
        code: "HCM_UNAVAILABLE",
        retryable: true,
        statusCode: 503,
      }),
    );

    expect(
      mockHcmService.getBalance({
        employeeId: request.employeeId,
        locationId: request.locationId,
      }).availableDays,
    ).toBe(10);

    const successResult = mockHcmService.submitTimeOff(request);

    expect(successResult.remainingAvailableDays).toBe(8);
    expect(
      mockHcmService.getBalance({
        employeeId: request.employeeId,
        locationId: request.locationId,
      }).availableDays,
    ).toBe(8);
  });

  it("replays a stored successful submission even if a later transient failure is queued", () => {
    const request = createMockHcmTimeOffInput({
      externalRequestId: "request_replay_after_success",
    });

    const firstResult = mockHcmService.submitTimeOff(request);
    mockHcmService.scheduleTransientFailure("SUBMIT_TIME_OFF");

    const replayResult = mockHcmService.submitTimeOff(request);

    expect(replayResult).toEqual(firstResult);
    expect(
      mockHcmService.getBalance({
        employeeId: request.employeeId,
        locationId: request.locationId,
      }).availableDays,
    ).toBe(8);
  });

  it("returns a stable batch snapshot after mock-state changes", () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [
          createMockHcmBalance({
            employeeId: "emp_456",
            locationId: "loc_002",
            availableDays: 4,
          }),
          createMockHcmBalance({
            employeeId: "emp_123",
            locationId: "loc_001",
            availableDays: 9,
          }),
        ],
      }),
    );

    mockHcmService.adjustBalance({
      employeeId: "emp_456",
      locationId: "loc_002",
      deltaDays: 1,
    });

    const snapshot = mockHcmService.getBatchSnapshot();

    expect(snapshot.sourceVersion).toBe("mock_batch_0001");
    expect(snapshot.effectiveAt).toEqual(expect.any(String));
    expect(snapshot.balances).toEqual([
      {
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 9,
      },
      {
        employeeId: "emp_456",
        locationId: "loc_002",
        availableDays: 5,
      },
    ]);
  });
});
