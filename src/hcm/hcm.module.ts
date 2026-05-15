import { Module } from "@nestjs/common";
import { HcmBalanceClient } from "./hcm-balance.client";
import { HcmTimeOffClient } from "./hcm-time-off.client";
import { MockHcmService } from "./mock-hcm.service";

@Module({
  providers: [MockHcmService, HcmBalanceClient, HcmTimeOffClient],
  exports: [MockHcmService, HcmBalanceClient, HcmTimeOffClient],
})
export class HcmModule {}
