import { ApiProperty } from '@nestjs/swagger';
import { ScheduleSlot } from '../entities/schedule-slot.entity';
import { ScheduleSlotResponseDto } from './schedule-slot-response.dto';

export class ScheduleResponseDto {
  @ApiProperty({ type: [ScheduleSlotResponseDto] })
  slots: ScheduleSlotResponseDto[];

  @ApiProperty()
  timeZone: string;

  constructor(slots: ScheduleSlotResponseDto[], timeZone: string) {
    this.slots = slots;
    this.timeZone = timeZone;
  }

  static fromEntities(
    slots: ScheduleSlot[],
    timeZone: string,
  ): ScheduleResponseDto {
    return new ScheduleResponseDto(
      slots.map((slot) => ScheduleSlotResponseDto.fromEntity(slot)),
      timeZone,
    );
  }
}

export class TodaysScheduleResponseDto {
  @ApiProperty()
  dayOfWeek: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty({ type: [ScheduleSlotResponseDto] })
  slots: ScheduleSlotResponseDto[];

  constructor(
    dayOfWeek: string,
    timeZone: string,
    slots: ScheduleSlotResponseDto[],
  ) {
    this.dayOfWeek = dayOfWeek;
    this.timeZone = timeZone;
    this.slots = slots;
  }

  static fromEntities(
    dayOfWeek: string,
    timeZone: string,
    slots: ScheduleSlot[],
  ): TodaysScheduleResponseDto {
    return new TodaysScheduleResponseDto(
      dayOfWeek,
      timeZone,
      slots.map((slot) => ScheduleSlotResponseDto.fromEntity(slot)),
    );
  }
}
