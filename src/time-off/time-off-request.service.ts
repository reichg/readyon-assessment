import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { HcmBalanceClient } from "../hcm/hcm-balance.client";
import { HcmTimeOffClient } from "../hcm/hcm-time-off.client";
import { HcmClientError } from "../hcm/hcm.errors";
import { BalanceRepository } from "../persistence/balance.repository";
import { HcmTransactionAuditRepository } from "../persistence/hcm-transaction-audit.repository";
import { PersistenceConflictError } from "../persistence/persistence.errors";
import type { TimeOffRequestRecord } from "../persistence/shapes/time-off-request.types";
import { TimeOffRequestLifecycleRepository } from "../persistence/time-off-request-lifecycle.repository";
import { TimeOffRequestRepository } from "../persistence/time-off-request.repository";
import type { CreateTimeOffRequestResult } from "./shapes/create-time-off-request-result";
import type { TimeOffRequestResponse } from "./shapes/time-off-request-response";
import {
  createApprovalInvalidEmployeeLocationError,
  createHcmUnavailableError,
  createIdempotencyKeyConflictError,
  createInsufficientBalanceError,
  createInvalidRequestStateError,
  createTimeOffRequestNotFoundError,
} from "./time-off.errors";

interface CreateTimeOffRequestInput {
  employeeId: string;
  locationId: string;
  requestedDays: number;
  idempotencyKey?: string | null;
}

@Injectable()
export class TimeOffRequestService {
  constructor(
    @Inject(BalanceRepository)
    private readonly balanceRepository: BalanceRepository,
    @Inject(HcmBalanceClient)
    private readonly hcmBalanceClient: HcmBalanceClient,
    @Inject(HcmTimeOffClient)
    private readonly hcmTimeOffClient: HcmTimeOffClient,
    @Inject(HcmTransactionAuditRepository)
    private readonly hcmTransactionAuditRepository: HcmTransactionAuditRepository,
    @Inject(TimeOffRequestLifecycleRepository)
    private readonly timeOffRequestLifecycleRepository: TimeOffRequestLifecycleRepository,
    @Inject(TimeOffRequestRepository)
    private readonly timeOffRequestRepository: TimeOffRequestRepository,
  ) {}

  async createRequest(
    input: CreateTimeOffRequestInput,
  ): Promise<CreateTimeOffRequestResult> {
    const idempotencyKey = input.idempotencyKey ?? null;
    const payloadHash = idempotencyKey ? buildPayloadHash(input) : null;

    if (idempotencyKey && payloadHash) {
      const existingRequest =
        await this.timeOffRequestRepository.findByIdempotencyKey(
          idempotencyKey,
        );

      if (existingRequest) {
        return resolveIdempotentRequest(existingRequest, payloadHash);
      }
    }

    const balance = await this.balanceRepository.findByEmployeeLocation(
      input.employeeId,
      input.locationId,
    );

    if (balance && balance.availableDays < input.requestedDays) {
      throw createInsufficientBalanceError();
    }

    try {
      const request = await this.timeOffRequestRepository.createPending({
        employeeId: input.employeeId,
        locationId: input.locationId,
        requestedDays: input.requestedDays,
        idempotencyKey,
        idempotencyPayloadHash: payloadHash,
      });

      return {
        request: toTimeOffRequestResponse(request),
        wasReplay: false,
      };
    } catch (error) {
      if (
        idempotencyKey &&
        payloadHash &&
        error instanceof PersistenceConflictError
      ) {
        const existingRequest =
          await this.timeOffRequestRepository.findByIdempotencyKey(
            idempotencyKey,
          );

        if (existingRequest) {
          return resolveIdempotentRequest(existingRequest, payloadHash);
        }

        throw createIdempotencyKeyConflictError();
      }

      throw error;
    }
  }

  async getRequest(id: string): Promise<TimeOffRequestResponse> {
    const request = await this.findRequestOrThrow(id);

    return toTimeOffRequestResponse(request);
  }

  async approveRequest(id: string): Promise<TimeOffRequestResponse> {
    const request = await this.findRequestOrThrow(id);

    if (request.status === "APPROVED") {
      return toTimeOffRequestResponse(request);
    }

    if (request.status !== "PENDING") {
      throw createInvalidRequestStateError();
    }

    const checkedAt = new Date().toISOString();

    try {
      const balance = await this.hcmBalanceClient.getBalance(
        request.employeeId,
        request.locationId,
      );

      if (balance.availableDays < request.requestedDays) {
        await this.persistRejectedApproval(
          request,
          {
            employeeId: balance.employeeId,
            locationId: balance.locationId,
            availableDays: balance.availableDays,
            lastSyncedAt: checkedAt,
          },
          {
            code: "INSUFFICIENT_BALANCE",
            message:
              "Available balance is insufficient for the requested time off.",
          },
        );
      }
    } catch (error) {
      if (error instanceof HcmClientError) {
        if (error.code === "INVALID_EMPLOYEE_LOCATION") {
          await this.persistRejectedApproval(request, undefined, {
            code: "INVALID_EMPLOYEE_LOCATION",
            message: error.message,
          });
        }

        throw createHcmUnavailableError();
      }

      throw error;
    }

    const audit = await this.findOrCreateApprovalAudit(request.id);

    try {
      const submission = await this.hcmTimeOffClient.submitTimeOff({
        employeeId: request.employeeId,
        locationId: request.locationId,
        days: request.requestedDays,
        externalRequestId: request.id,
      });
      const approvedRequest =
        await this.timeOffRequestLifecycleRepository.finalizeApprovalOutcome({
          id: request.id,
          status: "APPROVED",
          hcmTransactionId: submission.hcmTransactionId,
          audit: {
            id: audit.id,
            status: "COMPLETED",
            completedAt: submission.processedAt,
            hcmTransactionId: submission.hcmTransactionId,
          },
          balanceProjection: {
            employeeId: request.employeeId,
            locationId: request.locationId,
            availableDays: submission.remainingAvailableDays,
            lastSyncedAt: submission.processedAt,
          },
          updatedAt: submission.processedAt,
        });

      if (!approvedRequest) {
        return this.resolveApproveTransitionNoop(request.id);
      }

      return toTimeOffRequestResponse(approvedRequest);
    } catch (error) {
      if (error instanceof HcmClientError) {
        if (error.code === "INSUFFICIENT_BALANCE") {
          const projection = await this.tryLoadLatestBalanceProjection(request);

          await this.persistRejectedApproval(
            request,
            projection,
            {
              code: "INSUFFICIENT_BALANCE",
              message:
                "Available balance is insufficient for the requested time off.",
            },
            audit.id,
          );
        }

        if (error.code === "INVALID_EMPLOYEE_LOCATION") {
          await this.persistRejectedApproval(
            request,
            undefined,
            {
              code: "INVALID_EMPLOYEE_LOCATION",
              message: error.message,
            },
            audit.id,
          );
        }

        throw createHcmUnavailableError();
      }

      throw error;
    }
  }

  async rejectRequest(id: string): Promise<TimeOffRequestResponse> {
    const request = await this.findRequestOrThrow(id);

    if (request.status !== "PENDING") {
      throw createInvalidRequestStateError();
    }

    const rejectedRequest = await this.timeOffRequestRepository.updateStatus({
      id: request.id,
      status: "REJECTED",
    });

    if (!rejectedRequest) {
      throw createInvalidRequestStateError();
    }

    return toTimeOffRequestResponse(rejectedRequest);
  }

  private async findRequestOrThrow(id: string): Promise<TimeOffRequestRecord> {
    const request = await this.timeOffRequestRepository.findById(id);

    if (!request) {
      throw createTimeOffRequestNotFoundError();
    }

    return request;
  }

  private async findOrCreateApprovalAudit(externalRequestId: string) {
    const existingAudit =
      await this.hcmTransactionAuditRepository.findByExternalRequestId(
        externalRequestId,
      );

    if (existingAudit) {
      if (existingAudit.status !== "STARTED") {
        throw createHcmUnavailableError();
      }

      return existingAudit;
    }

    try {
      return await this.hcmTransactionAuditRepository.createAttempt({
        timeOffRequestId: externalRequestId,
        externalRequestId,
        operation: "DEDUCT_TIME_OFF",
        status: "STARTED",
      });
    } catch (error) {
      if (error instanceof PersistenceConflictError) {
        const racedAudit =
          await this.hcmTransactionAuditRepository.findByExternalRequestId(
            externalRequestId,
          );

        if (racedAudit && racedAudit.status === "STARTED") {
          return racedAudit;
        }

        throw createHcmUnavailableError();
      }

      throw error;
    }
  }

  private async persistRejectedApproval(
    request: TimeOffRequestRecord,
    projection:
      | {
          employeeId: string;
          locationId: string;
          availableDays: number;
          lastSyncedAt: string;
        }
      | undefined,
    failure: { code: string; message: string },
    auditId?: string,
  ): Promise<never> {
    const updatedAt = projection?.lastSyncedAt ?? new Date().toISOString();
    const rejectedRequest =
      await this.timeOffRequestLifecycleRepository.finalizeApprovalOutcome({
        id: request.id,
        status: "REJECTED",
        failureCode: failure.code,
        failureReason: failure.message,
        audit: auditId
          ? {
              id: auditId,
              status: "FAILED",
              completedAt: updatedAt,
              errorCode: failure.code,
              errorMessage: failure.message,
            }
          : undefined,
        balanceProjection: projection,
        updatedAt,
      });

    if (!rejectedRequest) {
      throw createInvalidRequestStateError();
    }

    if (failure.code === "INVALID_EMPLOYEE_LOCATION") {
      throw createApprovalInvalidEmployeeLocationError();
    }

    throw createInsufficientBalanceError();
  }

  private async tryLoadLatestBalanceProjection(
    request: TimeOffRequestRecord,
  ): Promise<
    | {
        employeeId: string;
        locationId: string;
        availableDays: number;
        lastSyncedAt: string;
      }
    | undefined
  > {
    try {
      const balance = await this.hcmBalanceClient.getBalance(
        request.employeeId,
        request.locationId,
      );

      return {
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        availableDays: balance.availableDays,
        lastSyncedAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  private async resolveApproveTransitionNoop(
    id: string,
  ): Promise<TimeOffRequestResponse> {
    const currentRequest = await this.findRequestOrThrow(id);

    if (currentRequest.status === "APPROVED") {
      return toTimeOffRequestResponse(currentRequest);
    }

    throw createInvalidRequestStateError();
  }
}

function resolveIdempotentRequest(
  existingRequest: TimeOffRequestRecord,
  payloadHash: string,
): CreateTimeOffRequestResult {
  if (existingRequest.idempotencyPayloadHash !== payloadHash) {
    throw createIdempotencyKeyConflictError();
  }

  return {
    request: toTimeOffRequestResponse(existingRequest),
    wasReplay: true,
  };
}

function buildPayloadHash(input: CreateTimeOffRequestInput): string {
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

function toTimeOffRequestResponse(
  request: TimeOffRequestRecord,
): TimeOffRequestResponse {
  return {
    id: request.id,
    employeeId: request.employeeId,
    locationId: request.locationId,
    requestedDays: request.requestedDays,
    status: request.status,
    failureCode: request.failureCode,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    approvedAt: request.approvedAt,
    rejectedAt: request.rejectedAt,
  };
}
