import { HcmTimeOffClient } from "../../src/hcm/hcm-time-off.client";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
  createMockHcmTimeOffInput,
} from "./mock-hcm.fixtures";

describe("HcmTimeOffClient", () => {
  let hcmTimeOffClient: HcmTimeOffClient;
  let mockHcmService: MockHcmService;

  beforeEach(() => {
    mockHcmService = new MockHcmService();
    mockHcmService.reset(createMockHcmSeedState());
    hcmTimeOffClient = new HcmTimeOffClient(mockHcmService);
  });

  it("returns the HCM deduction result on success", async () => {
    await expect(
      hcmTimeOffClient.submitTimeOff(createMockHcmTimeOffInput()),
    ).resolves.toEqual(
      expect.objectContaining({
        externalRequestId: "request_123",
        hcmTransactionId: expect.any(String),
        remainingAvailableDays: 8,
        processedAt: expect.any(String),
      }),
    );
  });

  it("maps invalid employee/location errors", async () => {
    mockHcmService.reset(createMockHcmSeedState({ balances: [] }));

    await expect(
      hcmTimeOffClient.submitTimeOff(createMockHcmTimeOffInput()),
    ).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LOCATION",
      message: "Employee and location were not found in HCM.",
    });
  });

  it("maps insufficient balance errors", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 1 })],
      }),
    );

    await expect(
      hcmTimeOffClient.submitTimeOff(createMockHcmTimeOffInput()),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      message: "Available balance is insufficient for the requested deduction.",
    });
  });

  it("maps HCM idempotency conflicts", async () => {
    await hcmTimeOffClient.submitTimeOff(
      createMockHcmTimeOffInput({ externalRequestId: "request_conflict" }),
    );

    await expect(
      hcmTimeOffClient.submitTimeOff(
        createMockHcmTimeOffInput({
          externalRequestId: "request_conflict",
          days: 3,
        }),
      ),
    ).rejects.toMatchObject({
      code: "HCM_IDEMPOTENCY_CONFLICT",
      message:
        "HCM rejected the approval retry because the external request id payload changed.",
    });
  });

  it("maps transient HCM failures to unavailable", async () => {
    mockHcmService.scheduleTransientFailure("SUBMIT_TIME_OFF");

    await expect(
      hcmTimeOffClient.submitTimeOff(createMockHcmTimeOffInput()),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });
  });
});
