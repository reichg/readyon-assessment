import { Body, Controller, Get, Param, Post, UseFilters } from "@nestjs/common";
import {
  MockHcmAdjustBalanceParamsDto,
  MockHcmAdjustBalanceRequestDto,
  MockHcmBalanceParamsDto,
  MockHcmTimeOffRequestDto,
} from "./dto";
import { MockHcmExceptionFilter } from "./mock-hcm.exception-filter";
import { MockHcmService } from "./mock-hcm.service";
import type {
  MockHcmBalanceRecord,
  MockHcmBatchSnapshot,
  MockHcmTimeOffResult,
} from "./shapes/mock-hcm.types";

const mockHcmRuntimeDependencies = [
  MockHcmAdjustBalanceParamsDto,
  MockHcmAdjustBalanceRequestDto,
  MockHcmBalanceParamsDto,
  MockHcmTimeOffRequestDto,
  MockHcmService,
];

void mockHcmRuntimeDependencies;

@UseFilters(MockHcmExceptionFilter)
@Controller("mock-hcm")
export class MockHcmController {
  constructor(private readonly mockHcmService: MockHcmService) {}

  @Get("balances/batch")
  getBatchSnapshot(): MockHcmBatchSnapshot {
    return this.mockHcmService.getBatchSnapshot();
  }

  @Get("balances/:employeeId/:locationId")
  getBalance(@Param() params: MockHcmBalanceParamsDto): MockHcmBalanceRecord {
    return this.mockHcmService.getBalance(params);
  }

  @Post("time-off")
  submitTimeOff(
    @Body() request: MockHcmTimeOffRequestDto,
  ): MockHcmTimeOffResult {
    return this.mockHcmService.submitTimeOff(request);
  }

  @Post("balances/:employeeId/:locationId/adjust")
  adjustBalance(
    @Param() params: MockHcmAdjustBalanceParamsDto,
    @Body() request: MockHcmAdjustBalanceRequestDto,
  ): MockHcmBalanceRecord {
    return this.mockHcmService.adjustBalance({
      ...params,
      deltaDays: request.deltaDays,
    });
  }
}
