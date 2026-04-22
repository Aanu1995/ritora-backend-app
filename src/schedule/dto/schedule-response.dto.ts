import { ApiProperty } from '@nestjs/swagger';
import { ScheduleSlot } from '../entities/schedule-slot.entity';
import { ScheduleSlotResponseDto } from './schedule-slot-response.dto';

export class ScheduleResponseDto {
  @ApiProperty({ type: [ScheduleSlotResponseDto] })
  slots: ScheduleSlotResponseDto[];

  constructor(slots: ScheduleSlotResponseDto[]) {
    this.slots = slots;
  }

  static fromEntities(slots: ScheduleSlot[]): ScheduleResponseDto {
    return new ScheduleResponseDto(
      slots.map((slot) => ScheduleSlotResponseDto.fromEntity(slot)),
    );
  }
}

export class TodaysScheduleResponseDto {
  @ApiProperty()
  dayOfWeek: string;

  @ApiProperty({ type: [ScheduleSlotResponseDto] })
  slots: ScheduleSlotResponseDto[];

  constructor(dayOfWeek: string, slots: ScheduleSlotResponseDto[]) {
    this.dayOfWeek = dayOfWeek;
    this.slots = slots;
  }

  static fromEntities(
    dayOfWeek: string,
    slots: ScheduleSlot[],
  ): TodaysScheduleResponseDto {
    return new TodaysScheduleResponseDto(
      dayOfWeek,
      slots.map((slot) => ScheduleSlotResponseDto.fromEntity(slot)),
    );
  }
}
