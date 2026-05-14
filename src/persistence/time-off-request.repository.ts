import type { TimeOffRequest as PrismaTimeOffRequest } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { getDurationMs } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";
import type { TimeOffRequestStatus } from "../time-off/shapes/time-off-request-status";
import type {
  CreatePendingTimeOffRequestInput,
  TimeOffRequestRecord,
  UpdateTimeOffRequestStatusInput,
} from "./shapes/time-off-request.types";
import {
  classifyPersistenceError,
  PersistenceConstraintError,
  translatePersistenceError,
} from "./persistence.errors";

@Injectable()
export class TimeOffRequestRepository {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  async createPending(
    input: CreatePendingTimeOffRequestInput,
  ): Promise<TimeOffRequestRecord> {
    const requestId = input.id ?? randomUUID();
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const createdAt = input.createdAt ?? updatedAt;
    const idempotencyKey = input.idempotencyKey ?? null;
    const idempotencyPayloadHash = input.idempotencyPayloadHash ?? null;
    const startedAt = process.hrtime.bigint();

    if ((idempotencyKey === null) !== (idempotencyPayloadHash === null)) {
      throw new PersistenceConstraintError(
        "time_off_requests.idempotency_pair",
        "Idempotency key and payload hash must both be provided or both be omitted.",
      );
    }

    try {
      const request = await this.databaseService.timeOffRequest.create({
        data: {
          id: requestId,
          employeeId: input.employeeId,
          locationId: input.locationId,
          requestedDays: input.requestedDays,
          status: "PENDING",
          idempotencyKey,
          idempotencyPayloadHash,
          hcmTransactionId: null,
          failureCode: null,
          failureReason: null,
          createdAt,
          updatedAt,
          approvedAt: null,
          rejectedAt: null,
        },
      });

      this.telemetryService.info({
        event: "repo.time_off_request.create_pending.completed",
        component: "TimeOffRequestRepository",
        operation: "createPending",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        hasIdempotencyKey: idempotencyKey !== null,
      });

      return toTimeOffRequestRecord(request);
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "time_off_requests.create",
        "Time off request could not be created.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.time_off_request.create_pending.failed",
        component: "TimeOffRequestRepository",
        operation: "createPending",
        outcome,
        durationMs: getDurationMs(startedAt),
        hasIdempotencyKey: idempotencyKey !== null,
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }
  }

  async findById(id: string): Promise<TimeOffRequestRecord | null> {
    const request = await this.databaseService.timeOffRequest.findUnique({
      where: { id },
    });

    return request ? toTimeOffRequestRecord(request) : null;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<TimeOffRequestRecord | null> {
    const request = await this.databaseService.timeOffRequest.findUnique({
      where: { idempotencyKey },
    });

    return request ? toTimeOffRequestRecord(request) : null;
  }

  async updateStatus(
    input: UpdateTimeOffRequestStatusInput,
  ): Promise<TimeOffRequestRecord | null> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const approvedAt =
      input.status === "APPROVED" ? (input.approvedAt ?? updatedAt) : null;
    const rejectedAt =
      input.status === "REJECTED" ? (input.rejectedAt ?? updatedAt) : null;
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.databaseService.timeOffRequest.updateMany({
        where: {
          id: input.id,
          status: "PENDING",
        },
        data: {
          status: input.status,
          hcmTransactionId: input.hcmTransactionId ?? null,
          failureCode: input.failureCode ?? null,
          failureReason: input.failureReason ?? null,
          updatedAt,
          approvedAt,
          rejectedAt,
        },
      });

      if (result.count === 0) {
        this.telemetryService.warn({
          event: "repo.time_off_request.update_status.noop",
          component: "TimeOffRequestRepository",
          operation: "updateStatus",
          outcome: "precondition_miss",
          durationMs: getDurationMs(startedAt),
          statusTo: input.status,
        });

        return null;
      }
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "time_off_requests.status",
        "Time off request status could not be updated.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.time_off_request.update_status.failed",
        component: "TimeOffRequestRepository",
        operation: "updateStatus",
        outcome,
        durationMs: getDurationMs(startedAt),
        statusTo: input.status,
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }

    const request = await this.findById(input.id);

    this.telemetryService.info({
      event: "repo.time_off_request.update_status.completed",
      component: "TimeOffRequestRepository",
      operation: "updateStatus",
      outcome: "success",
      durationMs: getDurationMs(startedAt),
      statusTo: input.status,
    });

    return request;
  }
}

function toTimeOffRequestRecord(
  request: PrismaTimeOffRequest,
): TimeOffRequestRecord {
  return {
    id: request.id,
    employeeId: request.employeeId,
    locationId: request.locationId,
    requestedDays: request.requestedDays,
    status: request.status as TimeOffRequestStatus,
    idempotencyKey: request.idempotencyKey,
    idempotencyPayloadHash: request.idempotencyPayloadHash,
    hcmTransactionId: request.hcmTransactionId,
    failureCode: request.failureCode,
    failureReason: request.failureReason,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    approvedAt: request.approvedAt,
    rejectedAt: request.rejectedAt,
  };
}
