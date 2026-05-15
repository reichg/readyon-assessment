import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import { CreateTimeOffRequestDto } from "./dto/create-time-off-request.dto";
import { TimeOffRequestIdParamsDto } from "./dto/time-off-request-id-params.dto";
import type { TimeOffRequestResponse } from "./shapes/time-off-request-response";
import { TimeOffRequestService } from "./time-off-request.service";

interface HttpStatusResponse {
  status(statusCode: number): unknown;
}

const timeOffRequestsControllerRuntimeDependencies = [
  CreateTimeOffRequestDto,
  TimeOffRequestIdParamsDto,
];

void timeOffRequestsControllerRuntimeDependencies;

@Controller("time-off-requests")
export class TimeOffRequestsController {
  constructor(
    @Inject(TimeOffRequestService)
    private readonly timeOffRequestService: TimeOffRequestService,
  ) {}

  @Post()
  async createRequest(
    @Body() body: CreateTimeOffRequestDto,
    @Res({ passthrough: true }) response: HttpStatusResponse,
  ): Promise<TimeOffRequestResponse> {
    const result = await this.timeOffRequestService.createRequest(body);

    response.status(result.wasReplay ? 200 : 201);

    return result.request;
  }

  @Get(":id")
  getRequest(
    @Param() params: TimeOffRequestIdParamsDto,
  ): Promise<TimeOffRequestResponse> {
    return this.timeOffRequestService.getRequest(params.id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approveRequest(
    @Param() params: TimeOffRequestIdParamsDto,
  ): Promise<TimeOffRequestResponse> {
    return this.timeOffRequestService.approveRequest(params.id);
  }

  @Post(":id/reject")
  @HttpCode(200)
  rejectRequest(
    @Param() params: TimeOffRequestIdParamsDto,
  ): Promise<TimeOffRequestResponse> {
    return this.timeOffRequestService.rejectRequest(params.id);
  }
}
