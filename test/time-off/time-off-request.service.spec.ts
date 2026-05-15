import type { TestingModule } from "@nestjs/testing";
import { Test } from "@nestjs/testing";
import { createHash } from "node:crypto";
import { DatabaseService } from "../../src/database/database.service";
import { createInsufficientBalanceError as createMockHcmInsufficientBalanceError } from "../../src/hcm/mock-hcm.errors";
import { MockHcmService } from "../../src/hcm/mock-hcm.service";
import { BalanceRepository } from "../../src/persistence/balance.repository";
import { HcmTransactionAuditRepository } from "../../src/persistence/hcm-transaction-audit.repository";
import { PersistenceConflictError } from "../../src/persistence/persistence.errors";
import { PersistenceModule } from "../../src/persistence/persistence.module";
import { TimeOffRequestRepository } from "../../src/persistence/time-off-request.repository";
import { TimeOffRequestService } from "../../src/time-off/time-off-request.service";
import { TimeOffModule } from "../../src/time-off/time-off.module";
import {
  createMockHcmBalance,
  createMockHcmSeedState,
} from "../hcm/mock-hcm.fixtures";
import {
  createTestDatabasePath,
  removeDatabaseFiles,
} from "../helpers/database-path";

describe("TimeOffRequestService", () => {
  let moduleRef: TestingModule | undefined;
  let databasePath: string | undefined;
  let databaseService: DatabaseService;
  let balanceRepository: BalanceRepository;
  let hcmTransactionAuditRepository: HcmTransactionAuditRepository;
  let mockHcmService: MockHcmService;
  let timeOffRequestRepository: TimeOffRequestRepository;
  let timeOffRequestService: TimeOffRequestService;

  beforeEach(async () => {
    databasePath = createTestDatabasePath("time-off-request-service");
    process.env.READYON_DB_PATH = databasePath;

    moduleRef = await Test.createTestingModule({
      imports: [PersistenceModule, TimeOffModule],
    }).compile();
    await moduleRef.init();

    databaseService = moduleRef.get(DatabaseService);
    balanceRepository = moduleRef.get(BalanceRepository);
    hcmTransactionAuditRepository = moduleRef.get(
      HcmTransactionAuditRepository,
    );
    mockHcmService = moduleRef.get(MockHcmService);
    timeOffRequestRepository = moduleRef.get(TimeOffRequestRepository);
    timeOffRequestService = moduleRef.get(TimeOffRequestService);
  });

  afterEach(async () => {
    delete process.env.READYON_DB_PATH;

    if (moduleRef) {
      await moduleRef.close();
      moduleRef = undefined;
    }

    removeDatabaseFiles(databasePath);
    databasePath = undefined;
  });

  it("creates a pending request even when no local balance projection exists", async () => {
    const result = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    expect(result.wasReplay).toBe(false);
    expect(result.request).toEqual({
      id: expect.any(String),
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      status: "PENDING",
      failureCode: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      approvedAt: null,
      rejectedAt: null,
    });
    await expect(
      timeOffRequestRepository.findById(result.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: result.request.id,
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
        status: "PENDING",
      }),
    );
  });

  it("returns the original request on idempotent replay without creating a duplicate row", async () => {
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-create-123",
    });

    const replayed = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-create-123",
    });

    expect(created.wasReplay).toBe(false);
    expect(replayed.wasReplay).toBe(true);
    expect(replayed.request).toEqual(created.request);
    await expect(
      databaseService.timeOffRequest.count({
        where: { idempotencyKey: "idem-create-123" },
      }),
    ).resolves.toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-conflict-123",
    });

    await expect(
      timeOffRequestService.createRequest({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 3,
        idempotencyKey: "idem-conflict-123",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency key was reused with a different request payload.",
    });
  });

  it("rejects requests that exceed a known local balance without persisting them", async () => {
    await balanceRepository.upsertProjection({
      employeeId: "emp_123",
      locationId: "loc_001",
      availableDays: 1,
      sourceVersion: "batch_2026_010",
      lastSyncedAt: "2026-01-10T00:00:00.000Z",
    });

    await expect(
      timeOffRequestService.createRequest({
        employeeId: "emp_123",
        locationId: "loc_001",
        requestedDays: 2,
      }),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      message: "Available balance is insufficient for the requested time off.",
    });

    await expect(databaseService.timeOffRequest.count()).resolves.toBe(0);
  });

  it("returns an existing request by id", async () => {
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-get-123",
    });

    await expect(
      timeOffRequestService.getRequest(created.request.id),
    ).resolves.toEqual(created.request);
  });

  it("approves a pending request after HCM accepts and updates the local projection", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    const approved = await timeOffRequestService.approveRequest(
      created.request.id,
    );
    const persisted = await timeOffRequestRepository.findById(
      created.request.id,
    );
    const projection = await balanceRepository.findByEmployeeLocation(
      "emp_123",
      "loc_001",
    );
    const audit = await hcmTransactionAuditRepository.findByExternalRequestId(
      created.request.id,
    );

    expect(approved).toEqual({
      ...created.request,
      status: "APPROVED",
      updatedAt: expect.any(String),
      approvedAt: expect.any(String),
      rejectedAt: null,
    });
    expect(persisted).toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "APPROVED",
        hcmTransactionId: expect.any(String),
        failureCode: null,
      }),
    );
    expect(projection).toEqual(
      expect.objectContaining({
        employeeId: "emp_123",
        locationId: "loc_001",
        availableDays: 8,
      }),
    );
    expect(audit).toEqual(
      expect.objectContaining({
        externalRequestId: created.request.id,
        status: "COMPLETED",
        hcmTransactionId: persisted?.hcmTransactionId,
      }),
    );
  });

  it("returns the approved request on approval retry without a second HCM deduction", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });
    const submitSpy = jest.spyOn(mockHcmService, "submitTimeOff");

    const approved = await timeOffRequestService.approveRequest(
      created.request.id,
    );
    const replayed = await timeOffRequestService.approveRequest(
      created.request.id,
    );

    expect(replayed).toEqual(approved);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }),
    ).toEqual(
      expect.objectContaining({
        availableDays: 8,
      }),
    );
  });

  it("rejects approval when HCM reports insufficient balance and refreshes the local projection", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 1 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      message: "Available balance is insufficient for the requested time off.",
    });

    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "REJECTED",
        failureCode: "INSUFFICIENT_BALANCE",
        approvedAt: null,
        rejectedAt: expect.any(String),
      }),
    );
    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        availableDays: 1,
      }),
    );
    await expect(
      hcmTransactionAuditRepository.findByExternalRequestId(created.request.id),
    ).resolves.toBeNull();
  });

  it("rejects approval when HCM reports an invalid employee and location", async () => {
    mockHcmService.reset(createMockHcmSeedState({ balances: [] }));
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_missing",
      locationId: "loc_missing",
      requestedDays: 2,
    });

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).rejects.toMatchObject({
      code: "INVALID_EMPLOYEE_LOCATION",
      message: "Employee and location were not found in HCM.",
    });

    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "REJECTED",
        failureCode: "INVALID_EMPLOYEE_LOCATION",
        rejectedAt: expect.any(String),
      }),
    );
    await expect(
      balanceRepository.findByEmployeeLocation("emp_missing", "loc_missing"),
    ).resolves.toBeNull();
  });

  it("leaves the request pending and retry-safe when HCM is unavailable during approval", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    mockHcmService.scheduleTransientFailure("SUBMIT_TIME_OFF");

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });

    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "PENDING",
        approvedAt: null,
        rejectedAt: null,
      }),
    );
    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toBeNull();
    await expect(
      hcmTransactionAuditRepository.findByExternalRequestId(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        externalRequestId: created.request.id,
        status: "STARTED",
        completedAt: null,
      }),
    );

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "APPROVED",
      }),
    );
    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }),
    ).toEqual(
      expect.objectContaining({
        availableDays: 8,
      }),
    );
  });

  it("leaves the request pending when HCM is unavailable during approval-time balance confirmation", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    mockHcmService.scheduleTransientFailure("GET_BALANCE");

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).rejects.toMatchObject({
      code: "HCM_UNAVAILABLE",
      message: "HCM is temporarily unavailable.",
    });

    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "PENDING",
      }),
    );
    await expect(
      hcmTransactionAuditRepository.findByExternalRequestId(created.request.id),
    ).resolves.toBeNull();
    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toBeNull();
  });

  it("rejects the request when HCM denies the deduction after a successful balance confirmation", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });

    jest.spyOn(mockHcmService, "submitTimeOff").mockImplementationOnce(() => {
      throw createMockHcmInsufficientBalanceError();
    });

    await expect(
      timeOffRequestService.approveRequest(created.request.id),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      message: "Available balance is insufficient for the requested time off.",
    });

    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "REJECTED",
        failureCode: "INSUFFICIENT_BALANCE",
      }),
    );
    await expect(
      hcmTransactionAuditRepository.findByExternalRequestId(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        externalRequestId: created.request.id,
        status: "FAILED",
        errorCode: "INSUFFICIENT_BALANCE",
      }),
    );
    await expect(
      balanceRepository.findByEmployeeLocation("emp_123", "loc_001"),
    ).resolves.toEqual(
      expect.objectContaining({
        availableDays: 10,
      }),
    );
  });

  it("rejects a pending request without calling HCM", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const created = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });
    const getBalanceSpy = jest.spyOn(mockHcmService, "getBalance");
    const submitSpy = jest.spyOn(mockHcmService, "submitTimeOff");

    const rejected = await timeOffRequestService.rejectRequest(
      created.request.id,
    );

    expect(rejected).toEqual({
      ...created.request,
      status: "REJECTED",
      updatedAt: expect.any(String),
      approvedAt: null,
      rejectedAt: expect.any(String),
    });
    expect(getBalanceSpy).not.toHaveBeenCalled();
    expect(submitSpy).not.toHaveBeenCalled();
    await expect(
      timeOffRequestRepository.findById(created.request.id),
    ).resolves.toEqual(
      expect.objectContaining({
        id: created.request.id,
        status: "REJECTED",
      }),
    );
    expect(
      mockHcmService.getBalance({
        employeeId: "emp_123",
        locationId: "loc_001",
      }),
    ).toEqual(
      expect.objectContaining({
        availableDays: 10,
      }),
    );
  });

  it("rejects invalid approve and reject state transitions", async () => {
    mockHcmService.reset(
      createMockHcmSeedState({
        balances: [createMockHcmBalance({ availableDays: 10 })],
      }),
    );
    const rejectedRequest = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
    });
    await timeOffRequestService.rejectRequest(rejectedRequest.request.id);

    await expect(
      timeOffRequestService.approveRequest(rejectedRequest.request.id),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST_STATE",
      message: "Time off request is not in a valid state for this operation.",
    });

    const approvedRequest = await timeOffRequestService.createRequest({
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 1,
    });
    await timeOffRequestService.approveRequest(approvedRequest.request.id);

    await expect(
      timeOffRequestService.rejectRequest(approvedRequest.request.id),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST_STATE",
      message: "Time off request is not in a valid state for this operation.",
    });
  });

  it("resolves an idempotent create race when insert conflicts after the pre-read miss", async () => {
    const payload = {
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-race-123",
    };
    const payloadHash = createPayloadHash(payload);
    const racedRequest = await timeOffRequestRepository.createPending({
      employeeId: payload.employeeId,
      locationId: payload.locationId,
      requestedDays: payload.requestedDays,
      idempotencyKey: payload.idempotencyKey,
      idempotencyPayloadHash: payloadHash,
    });
    const findByIdempotencyKeySpy = jest
      .spyOn(timeOffRequestRepository, "findByIdempotencyKey")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(racedRequest);
    const createPendingSpy = jest
      .spyOn(timeOffRequestRepository, "createPending")
      .mockRejectedValueOnce(
        new PersistenceConflictError(
          "time_off_requests.create",
          "Time off request could not be created.",
        ),
      );

    const result = await timeOffRequestService.createRequest(payload);

    expect(result.wasReplay).toBe(true);
    expect(result.request.id).toBe(racedRequest.id);
    expect(findByIdempotencyKeySpy).toHaveBeenCalledTimes(2);
    expect(createPendingSpy).toHaveBeenCalledTimes(1);
  });

  it("returns an idempotency conflict when a raced insert resolves to a different payload", async () => {
    const payload = {
      employeeId: "emp_123",
      locationId: "loc_001",
      requestedDays: 2,
      idempotencyKey: "idem-race-conflict-123",
    };
    const conflictingRequest = await timeOffRequestRepository.createPending({
      employeeId: payload.employeeId,
      locationId: payload.locationId,
      requestedDays: 3,
      idempotencyKey: payload.idempotencyKey,
      idempotencyPayloadHash: createPayloadHash({
        ...payload,
        requestedDays: 3,
      }),
    });

    jest
      .spyOn(timeOffRequestRepository, "findByIdempotencyKey")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(conflictingRequest);
    jest
      .spyOn(timeOffRequestRepository, "createPending")
      .mockRejectedValueOnce(
        new PersistenceConflictError(
          "time_off_requests.create",
          "Time off request could not be created.",
        ),
      );

    await expect(
      timeOffRequestService.createRequest(payload),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency key was reused with a different request payload.",
    });
  });
});

function createPayloadHash(input: {
  employeeId: string;
  locationId: string;
  requestedDays: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        employeeId: input.employeeId,
        locationId: input.locationId,
        requestedDays: input.requestedDays,
      }),
    )
    .digest("hex");
}
