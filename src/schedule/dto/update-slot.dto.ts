import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  DATE_ONLY_REGEX,
  MAX_SPECIALIST_CLINIC_NAME_LENGTH,
  MAX_SPECIALIST_PROVIDER_NAME_LENGTH,
  MAX_SPECIALIST_SAFETY_NOTES_LENGTH,
  MAX_SLOT_NOTES_LENGTH,
  SLOT_MODES,
  type SlotMode,
  TIME_REGEX,
} from './schedule.constants';

export class UpdateSlotDto {
  @ApiPropertyOptional({ example: '07:30', description: 'HH:MM, 24-hour' })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'slotTime must be in HH:MM 24-hour format' })
  slotTime?: string;

  @ApiPropertyOptional({ enum: SLOT_MODES })
  @IsOptional()
  @IsIn([...SLOT_MODES])
  mode?: SlotMode;

  @ApiPropertyOptional({ maxLength: MAX_SLOT_NOTES_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SLOT_NOTES_LENGTH)
  slotNotes?: string | null;

  @ApiPropertyOptional({
    maxLength: MAX_SPECIALIST_PROVIDER_NAME_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SPECIALIST_PROVIDER_NAME_LENGTH)
  specialistProviderName?: string | null;

  @ApiPropertyOptional({
    maxLength: MAX_SPECIALIST_CLINIC_NAME_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SPECIALIST_CLINIC_NAME_LENGTH)
  specialistClinicName?: string | null;

  @ApiPropertyOptional({ example: '2026-03-12', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY_REGEX, { message: 'activeSince must be YYYY-MM-DD' })
  specialistActiveSince?: string | null;

  @ApiPropertyOptional({
    maxLength: MAX_SPECIALIST_SAFETY_NOTES_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SPECIALIST_SAFETY_NOTES_LENGTH)
  specialistSafetyNotes?: string | null;
}
