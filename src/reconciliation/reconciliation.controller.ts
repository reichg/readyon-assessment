import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { ReconcileBalancesBatchDto } from "./dto";
import { ReconciliationService } from "./reconciliation.service";
import type { ReconciliationBatchSummary } from "./shapes/reconciliation-batch.types";

const reconciliationControllerRuntimeDependencies = [ReconcileBalancesBatchDto];

void reconciliationControllerRuntimeDependencies;

@Controller("hcm/balances")
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService)
    private readonly reconciliationService: ReconciliationService,
  ) {}

  @Post("batch")
  @HttpCode(200)
  reconcileBatch(
    @Body() body: ReconcileBalancesBatchDto,
  ): Promise<ReconciliationBatchSummary> {
    return this.reconciliationService.reconcileBatch({
      sourceVersion: body.sourceVersion,
      effectiveAt: body.effectiveAt,
      balances: body.balances,
    });
  }
}
