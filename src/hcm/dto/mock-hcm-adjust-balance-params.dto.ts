import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class MockHcmAdjustBalanceParamsDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  employeeId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  locationId!: string;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
