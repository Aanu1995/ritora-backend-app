import type { ApplyPresetDto } from './dto/apply-preset.dto';
import type { CreateSlotsDto } from './dto/create-slots.dto';
import { In, Not, type Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../shelf/shelf.types';
import {
  DAYS_OF_WEEK,
  CUSTOM_STEP_LABEL,
  DEFAULT_SLOT_MODE,
  MAX_STEPS_PER_SLOT,
  type DayOfWeek,
  type SlotMode,
} from './dto/schedule.constants';
import type { UpdateSlotDto } from './dto/update-slot.dto';
import type { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { RoutineStep } from './entities/routine-step.entity';
import type { ScheduleSlot } from './entities/schedule-slot.entity';
import {
  scheduleCustomLabelRequired,
  scheduleProductsNotOwned,
  scheduleRequiresProduct,
  scheduleTooManySteps,
} from './schedule.errors';
import { normaliseTime, uniqueDays } from './schedule.utils';

type RoutineStepInput = UpsertRoutineStepsDto['steps'][number];

export type NormalizedSlotInput = {
  dayOfWeek: DayOfWeek;
  slotNotes: string | null;
  specialistProviderName: string | null;
  specialistClinicName: string | null;
  specialistActiveSince: string | null;
  specialistSafetyNotes: string | null;
  slotTime: string;
  mode: SlotMode;
  steps: RoutineStepInput[];
};

export type NormalizedCreateSlotsInput = {
  daysOfWeek: DayOfWeek[];
  slotNotes: string | null;
  specialistProviderName: string | null;
  specialistClinicName: string | null;
  specialistActiveSince: string | null;
  specialistSafetyNotes: string | null;
  slotTime: string;
  mode: SlotMode;
  steps: RoutineStepInput[];
};

export function normalizeSlotInput(input: {
  dayOfWeek: DayOfWeek;
  slotNotes?: string | null;
  specialistProviderName?: string | null;
  specialistClinicName?: string | null;
  specialistActiveSince?: string | null;
  specialistSafetyNotes?: string | null;
  slotTime: string;
  mode?: SlotMode;
  steps?: readonly RoutineStepInput[] | null;
}): NormalizedSlotInput {
  return {
    dayOfWeek: input.dayOfWeek,
    slotNotes: normalizeNullableString(input.slotNotes),
    specialistProviderName: normalizeNullableString(
      input.specialistProviderName,
    ),
    specialistClinicName: normalizeNullableString(input.specialistClinicName),
    specialistActiveSince: normalizeNullableString(input.specialistActiveSince),
    specialistSafetyNotes: normalizeNullableString(input.specialistSafetyNotes),
    slotTime: normaliseTime(input.slotTime),
    mode: input.mode ?? DEFAULT_SLOT_MODE,
    steps: normalizeRoutineSteps(input.steps),
  };
}

export function normalizeCreateSlotsInput(
  dto: CreateSlotsDto,
): NormalizedCreateSlotsInput {
  return {
    daysOfWeek: uniqueDays(dto.daysOfWeek),
    slotNotes: normalizeNullableString(dto.slotNotes),
    specialistProviderName: normalizeNullableString(dto.specialistProviderName),
    specialistClinicName: normalizeNullableString(dto.specialistClinicName),
    specialistActiveSince: normalizeNullableString(dto.specialistActiveSince),
    specialistSafetyNotes: normalizeNullableString(dto.specialistSafetyNotes),
    slotTime: normaliseTime(dto.slotTime),
    mode: dto.mode ?? DEFAULT_SLOT_MODE,
    steps: normalizeRoutineSteps(dto.steps),
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
    specialist_provider_name: input.specialistProviderName,
    specialist_clinic_name: input.specialistClinicName,
    specialist_active_since: input.specialistActiveSince,
    specialist_safety_notes: input.specialistSafetyNotes,
  };
}

export function buildEveryDaySlotsInput(dto: ApplyPresetDto): CreateSlotsDto {
  return {
    daysOfWeek: [...DAYS_OF_WEEK],
    slotTime: dto.slotTime,
    mode: dto.mode,
    slotNotes: dto.slotNotes,
    specialistProviderName: dto.specialistProviderName,
    specialistClinicName: dto.specialistClinicName,
    specialistActiveSince: dto.specialistActiveSince,
    specialistSafetyNotes: dto.specialistSafetyNotes,
    steps: dto.steps,
  };
}

export function buildSlotInputForDay(
  dayOfWeek: DayOfWeek,
  slotInput: NormalizedCreateSlotsInput,
): NormalizedSlotInput {
  return {
    dayOfWeek,
    slotTime: slotInput.slotTime,
    mode: slotInput.mode,
    slotNotes: slotInput.slotNotes,
    specialistProviderName: slotInput.specialistProviderName,
    specialistClinicName: slotInput.specialistClinicName,
    specialistActiveSince: slotInput.specialistActiveSince,
    specialistSafetyNotes: slotInput.specialistSafetyNotes,
    steps: slotInput.steps,
  };
}

export function applySlotUpdatePatch(
  slot: ScheduleSlot,
  dto: UpdateSlotDto,
): void {
  if (dto.mode !== undefined) {
    slot.mode = dto.mode;
  }
  if (dto.slotNotes !== undefined) {
    slot.slot_notes = normalizeNullableString(dto.slotNotes);
  }
  if (dto.specialistProviderName !== undefined) {
    slot.specialist_provider_name = normalizeNullableString(
      dto.specialistProviderName,
    );
  }
  if (dto.specialistClinicName !== undefined) {
    slot.specialist_clinic_name = normalizeNullableString(
      dto.specialistClinicName,
    );
  }
  if (dto.specialistActiveSince !== undefined) {
    slot.specialist_active_since = normalizeNullableString(
      dto.specialistActiveSince,
    );
  }
  if (dto.specialistSafetyNotes !== undefined) {
    slot.specialist_safety_notes = normalizeNullableString(
      dto.specialistSafetyNotes,
    );
  }
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
      is_specialist_locked: step.isSpecialistLocked ?? false,
    }));
}

export async function assertRoutineStepsSchedulable(
  productsRepository: Repository<InventoryProduct>,
  userId: string,
  steps: readonly RoutineStepInput[],
): Promise<void> {
  if (steps.length > MAX_STEPS_PER_SLOT) {
    throw scheduleTooManySteps(MAX_STEPS_PER_SLOT);
  }
  await assertProductsAvailable(productsRepository, userId, steps);
  if (hasMissingCustomLabel(steps)) {
    throw scheduleCustomLabelRequired();
  }
}

export async function assertUserHasSchedulableProduct(
  productsRepository: Repository<InventoryProduct>,
  userId: string,
): Promise<void> {
  const productCount = await productsRepository.count({
    where: { user_id: userId, status: Not(ShelfStatus.Archived) },
  });
  if (productCount === 0) throw scheduleRequiresProduct();
}

export async function replaceRoutineSteps(
  stepsRepository: Repository<RoutineStep>,
  slotId: string,
  steps: readonly RoutineStepInput[],
): Promise<void> {
  const stepWriteData = buildRoutineStepWriteData(slotId, steps);
  await stepsRepository.delete({ slot_id: slotId });

  if (stepWriteData.length === 0) {
    return;
  }

  await stepsRepository.save(
    stepWriteData.map((step) => stepsRepository.create(step)),
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeRoutineSteps(
  steps: readonly RoutineStepInput[] | null | undefined,
): RoutineStepInput[] {
  return [...(steps ?? [])];
}

async function assertProductsAvailable(
  productsRepository: Repository<InventoryProduct>,
  userId: string,
  steps: readonly RoutineStepInput[],
): Promise<void> {
  const referencedProductIds = collectReferencedProductIds(steps);

  if (referencedProductIds.length === 0) {
    return;
  }

  const ownedProducts = await productsRepository.find({
    where: {
      id: In(referencedProductIds),
      user_id: userId,
      status: Not(ShelfStatus.Archived),
    },
    select: ['id'],
  });
  const ownedIds = new Set(ownedProducts.map((product) => product.id));
  const foreignProductIds = referencedProductIds.filter(
    (productId) => !ownedIds.has(productId),
  );

  if (foreignProductIds.length > 0) {
    throw scheduleProductsNotOwned(foreignProductIds);
  }
}
