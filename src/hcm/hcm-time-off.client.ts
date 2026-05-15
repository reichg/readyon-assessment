import { Inject, Injectable } from "@nestjs/common";
import {
  createHcmIdempotencyConflictClientError,
  createHcmUnavailableClientError,
  createInsufficientBalanceHcmError,
  createInvalidEmployeeLocationHcmError,
} from "./hcm.errors";
import { MockHcmError } from "./mock-hcm.errors";
import { MockHcmService } from "./mock-hcm.service";
import type {
  HcmTimeOffSubmissionInput,
  HcmTimeOffSubmissionResult,
} from "./shapes/hcm-time-off.types";

@Injectable()
export class HcmTimeOffClient {
  constructor(
    @Inject(MockHcmService)
    private readonly mockHcmService: MockHcmService,
  ) {}

  async submitTimeOff(
    input: HcmTimeOffSubmissionInput,
  ): Promise<HcmTimeOffSubmissionResult> {
    try {
      const result = this.mockHcmService.submitTimeOff(input);

      return {
        externalRequestId: result.externalRequestId,
        hcmTransactionId: result.hcmTransactionId,
        remainingAvailableDays: result.remainingAvailableDays,
        processedAt: result.processedAt,
      };
    } catch (error) {
      if (error instanceof MockHcmError) {
        if (error.code === "INVALID_EMPLOYEE_LOCATION") {
          throw createInvalidEmployeeLocationHcmError();
        }

        if (error.code === "INSUFFICIENT_BALANCE") {
          throw createInsufficientBalanceHcmError();
        }

        if (error.code === "IDEMPOTENCY_KEY_CONFLICT") {
          throw createHcmIdempotencyConflictClientError();
        }

        throw createHcmUnavailableClientError();
      }

      throw error;
    }
  }
}
