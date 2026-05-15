import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import { BalanceService } from "./balance.service";
import { BalanceParamsDto } from "./dto/balance-params.dto";
import type { BalanceResponse } from "./shapes/balance-response";
import { TimeOffExceptionFilter } from "./time-off.exception-filter";

const balanceControllerRuntimeDependencies = [BalanceParamsDto];

void balanceControllerRuntimeDependencies;

@UseFilters(TimeOffExceptionFilter)
@Controller("balances")
export class BalancesController {
  constructor(
    @Inject(BalanceService)
    private readonly balanceService: BalanceService,
  ) {}

  @Get(":employeeId/:locationId")
  getBalance(@Param() params: BalanceParamsDto): Promise<BalanceResponse> {
    return this.balanceService.getBalance(params.employeeId, params.locationId);
  }

  @Post(":employeeId/:locationId/refresh")
  @HttpCode(200)
  refreshBalance(@Param() params: BalanceParamsDto): Promise<BalanceResponse> {
    return this.balanceService.refreshBalance(
      params.employeeId,
      params.locationId,
    );
  }
}
