import { Inject, Injectable } from "@nestjs/common";
import type { HcmTransactionAudit as PrismaHcmTransactionAudit } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { getDurationMs } from "../telemetry/telemetry.helpers";
import { TelemetryService } from "../telemetry/telemetry.service";
import type {
  CompleteHcmTransactionAuditInput,
  CreateHcmTransactionAuditInput,
  HcmTransactionAuditOperation,
  HcmTransactionAuditRecord,
  HcmTransactionAuditStatus,
} from "./shapes/hcm-transaction-audit.types";
import {
  classifyPersistenceError,
  PersistenceConstraintError,
  translatePersistenceError,
} from "./persistence.errors";

@Injectable()
export class HcmTransactionAuditRepository {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TelemetryService)
    private readonly telemetryService: TelemetryService,
  ) {}

  async createAttempt(
    input: CreateHcmTransactionAuditInput,
  ): Promise<HcmTransactionAuditRecord> {
    const auditId = input.id ?? randomUUID();
    const startedAt = process.hrtime.bigint();

    ensureCreateAttemptInput(input);

    try {
      const audit = await this.databaseService.hcmTransactionAudit.create({
        data: {
          id: auditId,
          timeOffRequestId: input.timeOffRequestId,
          externalRequestId: input.externalRequestId,
          hcmTransactionId: null,
          operation: input.operation,
          status: input.status,
          attemptedAt: input.attemptedAt ?? new Date().toISOString(),
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      this.telemetryService.info({
        event: "repo.hcm_transaction_audit.create_attempt.completed",
        component: "HcmTransactionAuditRepository",
        operation: "createAttempt",
        outcome: "success",
        durationMs: getDurationMs(startedAt),
        status: input.status,
      });

      return toHcmTransactionAuditRecord(audit);
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "hcm_transaction_audits.external_request_id",
        "HCM transaction audit could not be created.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.hcm_transaction_audit.create_attempt.failed",
        component: "HcmTransactionAuditRepository",
        operation: "createAttempt",
        outcome,
        durationMs: getDurationMs(startedAt),
        status: input.status,
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }
  }

  async findByExternalRequestId(
    externalRequestId: string,
  ): Promise<HcmTransactionAuditRecord | null> {
    const audit = await this.databaseService.hcmTransactionAudit.findUnique({
      where: { externalRequestId },
    });

    return audit ? toHcmTransactionAuditRecord(audit) : null;
  }

  async findByTimeOffRequestId(
    timeOffRequestId: string,
  ): Promise<HcmTransactionAuditRecord[]> {
    const audits = await this.databaseService.hcmTransactionAudit.findMany({
      where: { timeOffRequestId },
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
    });

    return audits.map(toHcmTransactionAuditRecord);
  }

  async markCompleted(
    input: CompleteHcmTransactionAuditInput,
  ): Promise<HcmTransactionAuditRecord | null> {
    ensureCompletionInput(input);
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.databaseService.hcmTransactionAudit.updateMany({
        where: {
          id: input.id,
          status: "STARTED",
        },
        data: {
          status: input.status,
          completedAt: input.completedAt ?? new Date().toISOString(),
          hcmTransactionId: input.hcmTransactionId ?? null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
        },
      });

      if (result.count === 0) {
        this.telemetryService.warn({
          event: "repo.hcm_transaction_audit.mark_completed.noop",
          component: "HcmTransactionAuditRepository",
          operation: "markCompleted",
          outcome: "precondition_miss",
          durationMs: getDurationMs(startedAt),
          statusTo: input.status,
        });

        return null;
      }
    } catch (error) {
      const persistenceError = translatePersistenceError(
        error,
        "hcm_transaction_audits.status",
        "HCM transaction audit could not be updated.",
      );

      const outcome = classifyPersistenceError(persistenceError);
      const logLevel = outcome === "unexpected" ? "error" : "warn";

      this.telemetryService[logLevel]({
        event: "repo.hcm_transaction_audit.mark_completed.failed",
        component: "HcmTransactionAuditRepository",
        operation: "markCompleted",
        outcome,
        durationMs: getDurationMs(startedAt),
        statusTo: input.status,
        errorName: persistenceError.name,
      });

      throw persistenceError;
    }

    const audit = await this.findById(input.id);

    this.telemetryService.info({
      event: "repo.hcm_transaction_audit.mark_completed.completed",
      component: "HcmTransactionAuditRepository",
      operation: "markCompleted",
      outcome: "success",
      durationMs: getDurationMs(startedAt),
      statusTo: input.status,
    });

    return audit;
  }

  private async findById(
    id: string,
  ): Promise<HcmTransactionAuditRecord | null> {
    const audit = await this.databaseService.hcmTransactionAudit.findUnique({
      where: { id },
    });

    return audit ? toHcmTransactionAuditRecord(audit) : null;
  }
}

function ensureCreateAttemptInput(input: CreateHcmTransactionAuditInput): void {
  if (input.operation !== "DEDUCT_TIME_OFF") {
    throw new PersistenceConstraintError(
      "hcm_transaction_audits.operation",
      "HCM transaction audit operation is invalid.",
    );
  }

  if (input.status !== "STARTED") {
    throw new PersistenceConstraintError(
      "hcm_transaction_audits.status",
      "HCM transaction audit attempts must start in STARTED status.",
    );
  }
}

function ensureCompletionInput(input: CompleteHcmTransactionAuditInput): void {
  if (input.status === "COMPLETED" && !input.hcmTransactionId) {
    throw new PersistenceConstraintError(
      "hcm_transaction_audits.hcm_transaction_id",
      "Completed HCM transaction audits require an HCM transaction id.",
    );
  }
}

function toHcmTransactionAuditRecord(
  audit: PrismaHcmTransactionAudit,
): HcmTransactionAuditRecord {
  return {
    id: audit.id,
    timeOffRequestId: audit.timeOffRequestId,
    externalRequestId: audit.externalRequestId,
    hcmTransactionId: audit.hcmTransactionId,
    operation: audit.operation as HcmTransactionAuditOperation,
    status: audit.status as HcmTransactionAuditStatus,
    attemptedAt: audit.attemptedAt,
    completedAt: audit.completedAt,
    errorCode: audit.errorCode,
    errorMessage: audit.errorMessage,
  };
}
