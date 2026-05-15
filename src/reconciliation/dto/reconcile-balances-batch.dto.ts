import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

class ReconciliationBalanceRowDto {
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

  @IsInt()
  @Min(0)
  availableDays!: number;
}

export class ReconcileBalancesBatchDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sourceVersion!: string;

  @IsString()
  @IsISO8601()
  effectiveAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconciliationBalanceRowDto)
  balances!: ReconciliationBalanceRowDto[];
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
