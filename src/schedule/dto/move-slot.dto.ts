import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';
import { DAYS_OF_WEEK, type DayOfWeek, TIME_REGEX } from './schedule.constants';

export class MoveSlotDto {
  @ApiProperty({ enum: DAYS_OF_WEEK })
  @IsIn([...DAYS_OF_WEEK])
  toDay!: DayOfWeek;

  @ApiProperty({ example: '21:00', description: 'HH:MM, 24-hour' })
  @IsString()
  @Matches(TIME_REGEX, { message: 'toTime must be in HH:MM 24-hour format' })
  toTime!: string;
}
