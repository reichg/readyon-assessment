import type { HcmBalanceClient } from "../../src/hcm/hcm-balance.client";
import type { HcmTimeOffClient } from "../../src/hcm/hcm-time-off.client";
import {
  createInsufficientBalanceHcmError,
  createInvalidEmployeeLocationHcmError,
} from "../../src/hcm/hcm.errors";
import type { BalanceRepository } from "../../src/persistence/balance.repository";
import type { HcmTransactionAuditRepository } from "../../src/persistence/hcm-transaction-audit.repository";
import { PersistenceConflictError } from "../../src/persistence/persistence.errors";
import type { TimeOffRequestRecord } from "../../src/persistence/shapes/time-off-request.types";
import type { TimeOffRequestLifecycleRepository } from "../../src/persistence/time-off-request-lifecycle.repository";
import type { TimeOffRequestRepository } from "../../src/persistence/time-off-request.repository";
import { ApprovalConcurrencyGate } from "../../src/time-off/approval-concurrency-gate";
import { TimeOffRequestService } from "../../src/time-off/time-off-request.service";

describe("TimeOffRequestService recovery branches", () => {
  let balanceRepository: {
    findByEmployeeLocation: jest.Mock;
  };
  let hcmBalanceClient: {
    getBalance: jest.Mock;
  };
  let hcmTimeOffClient: {
    submitTimeOff: jest.Mock;
  };
  let hcmTransactionAuditRepository: {
    findByExternalRequestId: jest.Mock;
    createAttempt: jest.Mock;
  };
  let timeOffRequestLifecycleRepository: {
    finalizeApprovalOutcome: jest.Mock;
  };
  let timeOffRequestRepository: {
    findById: jest.Mock;
    findByIdempotencyKey: jest.Mock;
    createPending: jest.Mock;
    updateStatus: jest.Mock;
  };
  let service: TimeOffRequestService;

  beforeEach(() => {
    balanceRepository = {
      findByEmployeeLocation: jest.fn(),
    };
    hcmBalanceClient = {
      getBalance: jest.fn(),
    };
    hcmTimeOffClient = {
      submitTimeOff: jest.fn(),
    };
    hcmTransactionAuditRepository = {
      findByExternalRequestId: jest.fn(),
      createAttempt: jest.fn(),
    };
    timeOffRequestLifecycleRepository = {
      finalizeApprovalOutcome: jest.fn(),
    };
    timeOffRequestRepository = {
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      createPending: jest.fn(),
      updateStatus: jest.fn(),
    };

    service = new TimeOffRequestService(
      balanceRepository as unknown as BalanceRepository,
      hcmBalanceClient as unknown as HcmBalanceClient,
      hcmTimeOffClient as unknown as HcmTimeOffClient,
      hcmTransactionAuditRepository as unknown as HcmTransactionAuditRepository,
      timeOffRequestLifecycleRepository as unknown as TimeOffRequestLifecycleRepository,
      timeOffRequestRepository as unknown as TimeOffRequestRepository,
      new ApprovalConcurrencyGate(),
    );
  });

  it("returns HCM unavailable when an existing approval audit is already terminal", async () => {
    const pendingRequest = createRequest();

    timeOffRequestRepository.findById.mockResolvedValue(pendingRequest);
    hcmBalanceClient.getBalance.mockResolvedValue(
      createBalance({ availableDays: 10 }),
    );
    hcmTransactionAuditRepository.findByExternalRequestId.mockResolvedValue(
      createAudit({ status: "COMPLETED" }),
    );

    await expect(
      service.approveRequest(pendingRequest.id),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });

    expect(hcmTransactionAuditRepository.createAttempt).not.toHaveBeenCalled();
    expect(hcmTimeOffClient.submitTimeOff).not.toHaveBeenCalled();
  });

  it("reuses a raced STARTED audit after audit creation conflicts", async () => {
    const pendingRequest = createRequest();
    const startedAudit = createAudit({ status: "STARTED" });
    const approvedRequest = createRequest({
      status: "APPROVED",
      updatedAt: "2026-01-10T00:00:02.000Z",
      approvedAt: "2026-01-10T00:00:02.000Z",
    });

    timeOffRequestRepository.findById.mockResolvedValue(pendingRequest);
    hcmBalanceClient.getBalance.mockResolvedValue(
      createBalance({ availableDays: 10 }),
    );
    hcmTransactionAuditRepository.findByExternalRequestId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(startedAudit);
    hcmTransactionAuditRepository.createAttempt.mockRejectedValue(
      new PersistenceConflictError(
        "hcm_transaction_audits.external_request_id",
        "HCM transaction audit could not be created.",
      ),
    );
    hcmTimeOffClient.submitTimeOff.mockResolvedValue({
      hcmTransactionId: "txn_123",
      processedAt: "2026-01-10T00:00:02.000Z",
      remainingAvailableDays: 8,
    });
    timeOffRequestLifecycleRepository.finalizeApprovalOutcome.mockResolvedValue(
      approvedRequest,
    );

    await expect(service.approveRequest(pendingRequest.id)).resolves.toEqual({
      id: pendingRequest.id,
      employeeId: pendingRequest.employeeId,
      locationId: pendingRequest.locationId,
      requestedDays: pendingRequest.requestedDays,
      status: "APPROVED",
      failureCode: null,
      createdAt: pendingRequest.createdAt,
      updatedAt: "2026-01-10T00:00:02.000Z",
      approvedAt: "2026-01-10T00:00:02.000Z",
      rejectedAt: null,
    });

    expect(hcmTransactionAuditRepository.createAttempt).toHaveBeenCalledTimes(
      1,
    );
    expect(hcmTimeOffClient.submitTimeOff).toHaveBeenCalledTimes(1);
  });

  it("returns HCM unavailable when audit creation races with a terminal audit row", async () => {
    const pendingRequest = createRequest();

    timeOffRequestRepository.findById.mockResolvedValue(pendingRequest);
    hcmBalanceClient.getBalance.mockResolvedValue(
      createBalance({ availableDays: 10 }),
    );
    hcmTransactionAuditRepository.findByExternalRequestId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createAudit({ status: "FAILED" }));
    hcmTransactionAuditRepository.createAttempt.mockRejectedValue(
      new PersistenceConflictError(
        "hcm_transaction_audits.external_request_id",
        "HCM transaction audit could not be created.",
      ),
    );

    await expect(
      service.approveRequest(pendingRequest.id),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });

    expect(hcmTimeOffClient.submitTimeOff).not.toHaveBeenCalled();
  });

  it("rejects safely when submit-time insufficient balance is followed by a failed balance reload", async () => {
    const pendingRequest = createRequest();
    const startedAudit = createAudit({ status: "STARTED" });
    const rejectedRequest = createRequest({
      status: "REJECTED",
      failureCode: "INSUFFICIENT_BALANCE",
      updatedAt: "2026-01-10T00:00:03.000Z",
      rejectedAt: "2026-01-10T00:00:03.000Z",
    });

    timeOffRequestRepository.findById.mockResolvedValue(pendingRequest);
    hcmBalanceClient.getBalance
      .mockResolvedValueOnce(createBalance({ availableDays: 10 }))
      .mockRejectedValueOnce(new Error("retry balance lookup failed"));
    hcmTransactionAuditRepository.findByExternalRequestId.mockResolvedValue(
      null,
    );
    hcmTransactionAuditRepository.createAttempt.mockResolvedValue(startedAudit);
    hcmTimeOffClient.submitTimeOff.mockRejectedValue(
      createInsufficientBalanceHcmError(),
    );
    timeOffRequestLifecycleRepository.finalizeApprovalOutcome.mockResolvedValue(
      rejectedRequest,
    );

    await expect(
      service.approveRequest(pendingRequest.id),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      message: "Available balance is insufficient for the requested time off.",
      details: {
        employeeId: pendingRequest.employeeId,
        locationId: pendingRequest.locationId,
        requestedDays: pendingRequest.requestedDays,
      },
    });

    expect(
      timeOffRequestLifecycleRepository.finalizeApprovalOutcome,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pendingRequest.id,
        status: "REJECTED",
        failureCode: "INSUFFICIENT_BALANCE",
        balanceProjection: undefined,
        audit: expect.objectContaining({
          id: startedAudit.id,
          status: "FAILED",
          errorCode: "INSUFFICIENT_BALANCE",
        }),
      }),
    );
  });

  it("rejects with invalid employee/location after balance confirmation when HCM submit fails late", async () => {
    const pendingRequest = createRequest();
    const startedAudit = createAudit({ status: "STARTED" });
    const rejectedRequest = createRequest({
      status: "REJECTED",
      failureCode: "INVALID_EMPLOYEE_LOCATION",
      updatedAt: "2026-01-10T00:00:04.000Z",
      rejectedAt: "2026-01-10T00:00:04.000Z",
    });

    timeOffRequestRepository.findById.mockResolvedValue(pendingRequest);
    hcmBalanceClient.getBalance.mockResolvedValue(
      createBalance({ availableDays: 10 }),
    );
    hcmTransactionAuditRepository.findByExternalRequestId.mockResolvedValue(
      null,
    );
    hcmTransactionAuditRepository.createAttempt.mockResolvedValue(startedAudit);
    hcmTimeOffClient.submitTimeOff.mockRejectedValue(
      createInvalidEmployeeLocationHcmError(),
    );
    timeOffRequestLifecycleRepository.finalizeApprovalOutcome.mockResolvedValue(
      rejectedRequest,
    );

    await expect(
      service.approveRequest(pendingRequest.id),
    ).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LOCATION",
      message: "Employee and location were not found in HCM.",
      details: {
        requestId: pendingRequest.id,
        employeeId: pendingRequest.employeeId,
        locationId: pendingRequest.locationId,
        operation: "APPROVE_TIME_OFF",
      },
    });

    expect(
      timeOffRequestLifecycleRepository.finalizeApprovalOutcome,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: pendingRequest.id,
        status: "REJECTED",
        failureCode: "INVALID_EMPLOYEE_LOCATION",
        balanceProjection: undefined,
        audit: expect.objectContaining({
          id: startedAudit.id,
          status: "FAILED",
          errorCode: "INVALID_EMPLOYEE_LOCATION",
        }),
      }),
    );
  });

  it("returns the approved request when finalize approval no-ops after prior success", async () => {
    const pendingRequest = createRequest();
    const approvedRequest = createRequest({
      status: "APPROVED",
      updatedAt: "2026-01-10T00:00:05.000Z",
      approvedAt: "2026-01-10T00:00:05.000Z",
    });

    timeOffRequestRepository.findById
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(pendingRequest)
      .mockResolvedValueOnce(approvedRequest);
    hcmBalanceClient.getBalance.mockResolvedValue(
      createBalance({ availableDays: 10 }),
    );
    hcmTransactionAuditRepository.findByExternalRequestId.mockResolvedValue(
      createAudit({ status: "STARTED" }),
    );
    hcmTimeOffClient.submitTimeOff.mockResolvedValue({
      hcmTransactionId: "txn_456",
      processedAt: "2026-01-10T00:00:05.000Z",
      remainingAvailableDays: 8,
    });
    timeOffRequestLifecycleRepository.finalizeApprovalOutcome.mockResolvedValue(
      null,
    );

    await expect(service.approveRequest(pendingRequest.id)).resolves.toEqual({
      id: approvedRequest.id,
      employeeId: approvedRequest.employeeId,
      locationId: approvedRequest.locationId,
      requestedDays: approvedRequest.requestedDays,
      status: "APPROVED",
      failureCode: null,
      createdAt: approvedRequest.createdAt,
      updatedAt: approvedRequest.updatedAt,
      approvedAt: approvedRequest.approvedAt,
      rejectedAt: null,
    });
  });
});

function createRequest(
  overrides: Partial<TimeOffRequestRecord> = {},
): TimeOffRequestRecord {
  return {
    id: overrides.id ?? "request_123",
    employeeId: overrides.employeeId ?? "emp_123",
    locationId: overrides.locationId ?? "loc_001",
    requestedDays: overrides.requestedDays ?? 2,
    status: overrides.status ?? "PENDING",
    idempotencyKey: overrides.idempotencyKey ?? null,
    idempotencyPayloadHash: overrides.idempotencyPayloadHash ?? null,
    hcmTransactionId: overrides.hcmTransactionId ?? null,
    failureCode: overrides.failureCode ?? null,
    failureReason: overrides.failureReason ?? null,
    createdAt: overrides.createdAt ?? "2026-01-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-10T00:00:00.000Z",
    approvedAt: overrides.approvedAt ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
  };
}

function createAudit(overrides: {
  id?: string;
  status: "STARTED" | "COMPLETED" | "FAILED";
}) {
  return {
    id: overrides.id ?? "audit_123",
    timeOffRequestId: "request_123",
    externalRequestId: "request_123",
    hcmTransactionId: null,
    operation: "DEDUCT_TIME_OFF" as const,
    status: overrides.status,
    attemptedAt: "2026-01-10T00:00:00.000Z",
    completedAt:
      overrides.status === "STARTED" ? null : "2026-01-10T00:00:01.000Z",
    errorCode: overrides.status === "FAILED" ? "HCM_UNAVAILABLE" : null,
    errorMessage:
      overrides.status === "FAILED" ? "HCM is temporarily unavailable." : null,
  };
}

function createBalance(overrides: { availableDays: number }) {
  return {
    employeeId: "emp_123",
    locationId: "loc_001",
    availableDays: overrides.availableDays,
  };
}
