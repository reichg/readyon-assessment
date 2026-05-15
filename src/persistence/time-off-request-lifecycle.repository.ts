import { Inject, Injectable } from "@nestjs/common";
import type {
  Prisma,
  Balance as PrismaBalance,
  TimeOffRequest as PrismaTimeOffRequest,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import type { TimeOffRequestStatus } from "../time-off/shapes/time-off-request-status";
import { translatePersistenceError } from "./persistence.errors";
import type { TimeOffRequestRecord } from "./shapes/time-off-request.types";

interface FinalizeApprovalOutcomeBalanceProjectionInput {
  employeeId: string;
  locationId: string;
  availableDays: number;
  lastSyncedAt: string;
}

interface FinalizeApprovalOutcomeAuditInput {
  id: string;
  status: "COMPLETED" | "FAILED";
  completedAt: string;
  hcmTransactionId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface FinalizeApprovalOutcomeInput {
  id: string;
  status: "APPROVED" | "REJECTED";
  updatedAt?: string;
  hcmTransactionId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  audit?: FinalizeApprovalOutcomeAuditInput;
  balanceProjection?: FinalizeApprovalOutcomeBalanceProjectionInput;
}

@Injectable()
export class TimeOffRequestLifecycleRepository {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  async finalizeApprovalOutcome(
    input: FinalizeApprovalOutcomeInput,
  ): Promise<TimeOffRequestRecord | null> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const approvedAt = input.status === "APPROVED" ? updatedAt : null;
    const rejectedAt = input.status === "REJECTED" ? updatedAt : null;

    try {
      return await this.databaseService.$transaction(async (transaction) => {
        const requestUpdate = await transaction.timeOffRequest.updateMany({
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

        if (requestUpdate.count === 0) {
          return null;
        }

        if (input.audit) {
          const auditUpdate = await transaction.hcmTransactionAudit.updateMany({
            where: {
              id: input.audit.id,
              status: "STARTED",
            },
            data: {
              status: input.audit.status,
              completedAt: input.audit.completedAt,
              hcmTransactionId: input.audit.hcmTransactionId ?? null,
              errorCode: input.audit.errorCode ?? null,
              errorMessage: input.audit.errorMessage ?? null,
            },
          });

          if (auditUpdate.count === 0) {
            throw new Error("HCM approval audit could not be finalized.");
          }
        }

        if (input.balanceProjection) {
          const existingBalance = await transaction.balance.findUnique({
            where: {
              employeeId_locationId: {
                employeeId: input.balanceProjection.employeeId,
                locationId: input.balanceProjection.locationId,
              },
            },
          });

          await upsertBalanceProjection(transaction, existingBalance, {
            ...input.balanceProjection,
            updatedAt,
          });
        }

        const request = await transaction.timeOffRequest.findUnique({
          where: { id: input.id },
        });

        return request ? toTimeOffRequestRecord(request) : null;
      });
    } catch (error) {
      throw translatePersistenceError(
        error,
        "time_off_requests.lifecycle",
        "Time off request lifecycle outcome could not be saved.",
      );
    }
  }
}

async function upsertBalanceProjection(
  transaction: Prisma.TransactionClient,
  existingBalance: PrismaBalance | null,
  input: FinalizeApprovalOutcomeBalanceProjectionInput & { updatedAt: string },
): Promise<void> {
  await transaction.balance.upsert({
    where: {
      employeeId_locationId: {
        employeeId: input.employeeId,
        locationId: input.locationId,
      },
    },
    create: {
      id: existingBalance?.id ?? randomUUID(),
      employeeId: input.employeeId,
      locationId: input.locationId,
      availableDays: input.availableDays,
      sourceVersion: existingBalance?.sourceVersion ?? null,
      lastSyncedAt: input.lastSyncedAt,
      createdAt: existingBalance?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    },
    update: {
      availableDays: input.availableDays,
      sourceVersion: existingBalance?.sourceVersion ?? null,
      lastSyncedAt: input.lastSyncedAt,
      updatedAt: input.updatedAt,
    },
  });
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
