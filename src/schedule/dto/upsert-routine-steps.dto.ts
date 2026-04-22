import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_CUSTOM_LABEL_LENGTH,
  MAX_STEPS_PER_SLOT,
  MAX_STEP_NOTES_LENGTH,
  STEP_LABELS,
  type StepLabel,
} from './schedule.constants';

export class RoutineStepInputDto {
  @ApiPropertyOptional({
    description: 'Present on existing steps being updated',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  stepOrder!: number;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ULID of a Shelf product',
  })
  @IsOptional()
  @IsString()
  inventoryProductId?: string | null;

  @ApiProperty({ enum: STEP_LABELS })
  @IsIn([...STEP_LABELS])
  stepLabel!: StepLabel;

  @ApiPropertyOptional({ maxLength: MAX_CUSTOM_LABEL_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CUSTOM_LABEL_LENGTH)
  customLabel?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_STEP_NOTES_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_STEP_NOTES_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  optional?: boolean;
}

export class UpsertRoutineStepsDto {
  @ApiProperty({ type: [RoutineStepInputDto], maxItems: MAX_STEPS_PER_SLOT })
  @IsArray()
  @ArrayMaxSize(MAX_STEPS_PER_SLOT)
  @ValidateNested({ each: true })
  @Type(() => RoutineStepInputDto)
  steps!: RoutineStepInputDto[];
}
