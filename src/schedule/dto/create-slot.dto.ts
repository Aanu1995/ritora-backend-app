import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  MAX_SLOT_NOTES_LENGTH,
  SLOT_MODES,
  type SlotMode,
  TIME_REGEX,
} from './schedule.constants';

export class CreateSlotDto {
  @ApiProperty({ enum: DAYS_OF_WEEK })
  @IsIn([...DAYS_OF_WEEK])
  dayOfWeek!: DayOfWeek;

  @ApiProperty({ example: '07:30', description: 'HH:MM, 24-hour' })
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
