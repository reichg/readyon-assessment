import { IsInt, NotEquals } from "class-validator";

export class MockHcmAdjustBalanceRequestDto {
  @IsInt()
  @NotEquals(0)
  deltaDays!: number;
}
