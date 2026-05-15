import { Inject, Injectable } from "@nestjs/common";
import {
  createHcmUnavailableClientError,
  createInvalidEmployeeLocationHcmError,
} from "./hcm.errors";
import { MockHcmError } from "./mock-hcm.errors";
import { MockHcmService } from "./mock-hcm.service";
import type { HcmBalanceProjection } from "./shapes/hcm-balance.types";

@Injectable()
export class HcmBalanceClient {
  constructor(
    @Inject(MockHcmService)
    private readonly mockHcmService: MockHcmService,
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<HcmBalanceProjection> {
    try {
      const balance = this.mockHcmService.getBalance({
        employeeId,
        locationId,
      });

      return {
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        availableDays: balance.availableDays,
      };
    } catch (error) {
      if (error instanceof MockHcmError) {
        if (error.code === "INVALID_EMPLOYEE_LOCATION") {
          throw createInvalidEmployeeLocationHcmError();
        }

        throw createHcmUnavailableClientError();
      }

      throw error;
    }
  }
}
