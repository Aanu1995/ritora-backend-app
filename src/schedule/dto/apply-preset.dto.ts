import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  MAX_SLOT_NOTES_LENGTH,
  SCHEDULE_PRESETS,
  type SchedulePreset,
  SLOT_MODES,
  type SlotMode,
  TIME_REGEX,
} from './schedule.constants';

export class ApplyPresetDto {
  @ApiProperty({ enum: SCHEDULE_PRESETS })
  @IsIn([...SCHEDULE_PRESETS])
  preset!: SchedulePreset;

  @ApiProperty({ example: '08:00', description: 'HH:MM, 24-hour' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'slotTime must be in HH:MM 24-hour format' })
  slotTime!: string;

  @ApiPropertyOptional({ enum: SLOT_MODES, default: 'ai' })
  @IsOptional()
  @IsIn([...SLOT_MODES])
  mode?: SlotMode;

  @ApiPropertyOptional({ maxLength: MAX_SLOT_NOTES_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SLOT_NOTES_LENGTH)
  slotNotes?: string;
}
