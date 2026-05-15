import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class TimeOffRequestIdParamsDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string;
}

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
