import type { CreateSlotsDto } from './dto/create-slots.dto';
import {
  CUSTOM_STEP_LABEL,
  DEFAULT_SLOT_MODE,
  type DayOfWeek,
  type SlotMode,
} from './dto/schedule.constants';
import type { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { normaliseTime, uniqueDays } from './schedule.utils';

type RoutineStepInput = UpsertRoutineStepsDto['steps'][number];

export type NormalizedSlotInput = {
  dayOfWeek: DayOfWeek;
  slotNotes: string | null;
  slotTime: string;
  mode: SlotMode;
};

export type NormalizedCreateSlotsInput = {
  daysOfWeek: DayOfWeek[];
  slotNotes: string | null;
  slotTime: string;
  mode: SlotMode;
};

export function normalizeSlotInput(input: {
  dayOfWeek: DayOfWeek;
  slotNotes?: string | null;
  slotTime: string;
  mode?: SlotMode;
}): NormalizedSlotInput {
  return {
    dayOfWeek: input.dayOfWeek,
    slotNotes: input.slotNotes ?? null,
    slotTime: normaliseTime(input.slotTime),
    mode: input.mode ?? DEFAULT_SLOT_MODE,
  };
}

export function normalizeCreateSlotsInput(
  dto: CreateSlotsDto,
): NormalizedCreateSlotsInput {
  return {
    daysOfWeek: uniqueDays(dto.daysOfWeek),
    slotNotes: dto.slotNotes ?? null,
    slotTime: normaliseTime(dto.slotTime),
    mode: dto.mode ?? DEFAULT_SLOT_MODE,
  };
}

export function buildScheduleSlotData(
  userId: string,
  input: NormalizedSlotInput,
) {
  return {
    user_id: userId,
    day_of_week: input.dayOfWeek,
    slot_time: input.slotTime,
    mode: input.mode,
    slot_notes: input.slotNotes,
  };
}

export function getMissingDays(
  daysOfWeek: readonly DayOfWeek[],
  existingDays: ReadonlySet<DayOfWeek>,
): DayOfWeek[] {
  return daysOfWeek.filter((day) => !existingDays.has(day));
}

export function collectReferencedProductIds(
  steps: readonly RoutineStepInput[],
): string[] {
  return Array.from(
    new Set(
      steps
        .map((step) => step.inventoryProductId)
        .filter((productId): productId is string => Boolean(productId)),
    ),
  );
}

export function hasMissingCustomLabel(
  steps: readonly RoutineStepInput[],
): boolean {
  return steps.some(
    (step) => step.stepLabel === CUSTOM_STEP_LABEL && !step.customLabel?.trim(),
  );
}

export function buildRoutineStepWriteData(
  slotId: string,
  steps: readonly RoutineStepInput[],
) {
  return [...steps]
    .sort((left, right) => left.stepOrder - right.stepOrder)
    .map((step, index) => ({
      slot_id: slotId,
      step_order: index,
      inventory_product_id: step.inventoryProductId ?? null,
      step_label: step.stepLabel,
      custom_label: step.customLabel ?? null,
      notes: step.notes ?? null,
      optional: step.optional ?? false,
    }));
}
