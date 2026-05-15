import { Inject, Injectable } from "@nestjs/common";
import { HcmBalanceClient } from "../hcm/hcm-balance.client";
import { HcmClientError } from "../hcm/hcm.errors";
import { BalanceRepository } from "../persistence/balance.repository";
import type { BalanceResponse } from "./shapes/balance-response";
import {
  createBalanceNotFoundError,
  createHcmUnavailableError,
  createInvalidEmployeeLocationError,
} from "./time-off.errors";

@Injectable()
export class BalanceService {
  constructor(
    @Inject(BalanceRepository)
    private readonly balanceRepository: BalanceRepository,
    @Inject(HcmBalanceClient)
    private readonly hcmBalanceClient: HcmBalanceClient,
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceResponse> {
    const balance = await this.balanceRepository.findByEmployeeLocation(
      employeeId,
      locationId,
    );

    if (!balance) {
      throw createBalanceNotFoundError({ employeeId, locationId });
    }

    return toBalanceResponse(balance);
  }

  async refreshBalance(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceResponse> {
    const existingBalance = await this.balanceRepository.findByEmployeeLocation(
      employeeId,
      locationId,
    );

    try {
      const balance = await this.hcmBalanceClient.getBalance(
        employeeId,
        locationId,
      );
      const refreshedBalance = await this.balanceRepository.upsertProjection({
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        availableDays: balance.availableDays,
        sourceVersion: existingBalance?.sourceVersion ?? undefined,
        lastSyncedAt: new Date().toISOString(),
      });

      return toBalanceResponse(refreshedBalance);
    } catch (error) {
      if (error instanceof HcmClientError) {
        if (error.code === "INVALID_EMPLOYEE_LOCATION") {
          throw createInvalidEmployeeLocationError({
            employeeId,
            locationId,
            operation: "REFRESH_BALANCE",
          });
        }

        throw createHcmUnavailableError({
          employeeId,
          locationId,
          operation: "REFRESH_BALANCE",
        });
      }

      throw error;
    }
  }
}

function toBalanceResponse(balance: {
  employeeId: string;
  locationId: string;
  availableDays: number;
  lastSyncedAt: string;
}): BalanceResponse {
  return {
    employeeId: balance.employeeId,
    locationId: balance.locationId,
    availableDays: balance.availableDays,
    lastSyncedAt: balance.lastSyncedAt,
  };
}
