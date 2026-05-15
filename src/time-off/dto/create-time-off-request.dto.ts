import { Transform } from "class-transformer";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class CreateTimeOffRequestDto {
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
  @Min(1)
  requestedDays!: number;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  idempotencyKey?: string;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}

function trimOptionalString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
