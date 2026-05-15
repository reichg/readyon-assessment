import { Transform } from "class-transformer";
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";

export class MockHcmTimeOffRequestDto {
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
  days!: number;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  externalRequestId!: string;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
