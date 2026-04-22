import { BadRequestException } from '@nestjs/common';
import { type DayOfWeek } from './dto/schedule.constants';
import { ScheduleSlot } from './entities/schedule-slot.entity';

const DAY_ORDER: Record<DayOfWeek, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

export function compareSlots(a: ScheduleSlot, b: ScheduleSlot): number {
  const dayDiff = DAY_ORDER[a.day_of_week] - DAY_ORDER[b.day_of_week];
  if (dayDiff !== 0) return dayDiff;
  return String(a.slot_time).localeCompare(String(b.slot_time));
}

export function normaliseTime(time: string): string {
  if (/^\d{2}:\d{2}$/.test(time)) {
    return `${time}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  throw new BadRequestException(`Invalid time format: ${time}`);
}

export function uniqueDays(daysOfWeek: readonly DayOfWeek[]): DayOfWeek[] {
  return Array.from(new Set(daysOfWeek));
}
