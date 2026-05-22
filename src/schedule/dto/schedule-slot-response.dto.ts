import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import { ProductImageUrlResolverOptions } from '../../inventory/product-image-url-resolver';
import { ScheduleSlot } from '../entities/schedule-slot.entity';
import { RoutineStepResponseDto } from './routine-step-response.dto';

function formatSlotTime(value: string | Date): string {
  if (typeof value === 'string') {
    return value.slice(0, 5);
  }
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export class ScheduleSlotResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  dayOfWeek: string;

  @ApiProperty({ example: '07:30' })
  slotTime: string;

  @ApiProperty()
  mode: string;

  @ApiProperty({ nullable: true })
  slotNotes: string | null;

  @ApiProperty({ nullable: true })
  specialistProviderName: string | null;

  @ApiProperty({ nullable: true })
  specialistClinicName: string | null;

  @ApiProperty({ nullable: true })
  specialistActiveSince: string | null;

  @ApiProperty({ nullable: true })
  specialistSafetyNotes: string | null;

  @ApiProperty({ type: [RoutineStepResponseDto] })
  steps: RoutineStepResponseDto[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(
    id: string,
    dayOfWeek: string,
    slotTime: string,
    mode: string,
    slotNotes: string | null,
    specialistProviderName: string | null,
    specialistClinicName: string | null,
    specialistActiveSince: string | null,
    specialistSafetyNotes: string | null,
    steps: RoutineStepResponseDto[],
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.dayOfWeek = dayOfWeek;
    this.slotTime = slotTime;
    this.mode = mode;
    this.slotNotes = slotNotes;
    this.specialistProviderName = specialistProviderName;
    this.specialistClinicName = specialistClinicName;
    this.specialistActiveSince = specialistActiveSince;
    this.specialistSafetyNotes = specialistSafetyNotes;
    this.steps = steps;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromEntity(
    slot: ScheduleSlot,
    options: ProductImageUrlResolverOptions = {},
  ): ScheduleSlotResponseDto {
    const steps = (slot.steps ?? [])
      .slice()
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => RoutineStepResponseDto.fromEntity(step, options));

    return new ScheduleSlotResponseDto(
      slot.id,
      slot.day_of_week,
      formatSlotTime(slot.slot_time),
      slot.mode,
      slot.slot_notes,
      slot.specialist_provider_name,
      slot.specialist_clinic_name,
      slot.specialist_active_since,
      slot.specialist_safety_notes,
      steps,
      toIsoString(slot.created_at),
      toIsoString(slot.updated_at),
    );
  }
}
