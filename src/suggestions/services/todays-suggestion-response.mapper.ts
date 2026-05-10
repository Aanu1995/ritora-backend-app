import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { toDateOnlyString, toIsoString } from '../../common/utils/date';
import { ProductImageUrlResolverOptions } from '../../inventory/product-image-url-resolver';
import { SlotModeValue } from '../../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import {
  TodaysSuggestionRecordingDto,
  TodaysOnDemandSuggestionDto,
  TodaysSuggestionSlotDto,
  TodaysSuggestionSpecialistDto,
  TodaysSuggestionSummaryDto,
} from '../dto/todays-suggestion-response.dto';
import { SuggestionInstanceResponseDto } from '../dto/suggestion-instance-response.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionGapActionKind,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionSlotLifecycleStatus,
} from '../suggestions.constants';
import { deriveSuggestionDaypart } from './suggestion-helpers';
import { SuggestionLifecycle } from './suggestion-lifecycle';

type BuildTodaySlotInput = {
  slot: ScheduleSlot;
  suggestion: SuggestionInstance | null;
  applicationLog: ApplicationLog | null;
  gapActionByKey?: ReadonlyMap<string, SuggestionGapActionKind>;
  recordingReminderSnoozedUntil: Date | null;
  visibleAt: Date;
  lifecycle: SuggestionLifecycle;
} & ProductImageUrlResolverOptions;

export function buildTodaySlotDto({
  slot,
  suggestion,
  applicationLog,
  gapActionByKey,
  recordingReminderSnoozedUntil,
  visibleAt,
  lifecycle,
  resolveProductImageUrls,
}: BuildTodaySlotInput): TodaysSuggestionSlotDto {
  const productImageOptions = { resolveProductImageUrls };
  return {
    slotId: slot.id,
    daypart: deriveSuggestionDaypart(slot.slot_time),
    slotTime: slot.slot_time,
    mode: suggestion?.mode ?? deriveScheduledSlotMode(slot),
    slotNotes: slot.slot_notes ?? null,
    routineStepCount: slot.steps?.length ?? 0,
    specialistLockedStepCount: countSpecialistLockedSteps(slot),
    specialist: buildSpecialistDto(slot),
    visibleAt: visibleAt.toISOString(),
    isVisible: lifecycle.status !== SuggestionSlotLifecycleStatus.Locked,
    status: lifecycle.status,
    slotStartsAt: toIsoString(lifecycle.slotStartsAt),
    recordableAt: toIsoString(lifecycle.recordableAt),
    expiresAt: toIsoString(lifecycle.expiresAt),
    recording: applicationLog ? buildRecordingDto(applicationLog) : null,
    recordingReminderSnoozedUntil: recordingReminderSnoozedUntil
      ? toIsoString(recordingReminderSnoozedUntil)
      : null,
    applicationLog: applicationLog
      ? ApplicationLogResponseDto.fromEntity(
          applicationLog,
          productImageOptions,
        )
      : null,
    suggestion: suggestion
      ? SuggestionInstanceResponseDto.fromEntity(suggestion, {
          applicationLogId: applicationLog?.id ?? null,
          gapActionByKey,
          ...productImageOptions,
        })
      : null,
  };
}

export function deriveScheduledSlotMode(slot: ScheduleSlot): SuggestionMode {
  if (slot.mode === SlotModeValue.Ai) return SuggestionMode.Ai;
  const steps = slot.steps ?? [];
  if (steps.length === 0) return SuggestionMode.Manual;
  const lockedCount = countSpecialistLockedSteps(slot);
  if (lockedCount > 0 && lockedCount < steps.length) {
    return SuggestionMode.Mixed;
  }
  return SuggestionMode.Manual;
}

export function buildRecordingDto(
  log: ApplicationLog,
): TodaysSuggestionRecordingDto {
  const items = log.items ?? [];
  return {
    applicationLogId: log.id,
    appliedAt: log.applied_at ? toIsoString(log.applied_at) : null,
    hasBeenEdited: log.has_been_edited,
    editCount: log.edit_count,
    lastEditedAt: log.last_edited_at ? toIsoString(log.last_edited_at) : null,
    appliedCount: items.filter((item) => item.status === 'applied').length,
    totalItems: items.length,
  };
}

export function buildTodaySummary(
  slots: TodaysSuggestionSlotDto[],
  onDemandSuggestions: TodaysOnDemandSuggestionDto[] = [],
): TodaysSuggestionSummaryDto {
  const count = (statuses: SuggestionSlotLifecycleStatus[]) =>
    slots.filter((slot) => statuses.includes(slot.status)).length;
  const onDemandCount = (statuses: TodaysOnDemandSuggestionDto['status'][]) =>
    onDemandSuggestions.filter((suggestion) =>
      statuses.includes(suggestion.status),
    ).length;
  return {
    total: slots.length,
    locked: count([SuggestionSlotLifecycleStatus.Locked]),
    upcoming:
      count([
        SuggestionSlotLifecycleStatus.Generating,
        SuggestionSlotLifecycleStatus.Ready,
        SuggestionSlotLifecycleStatus.Active,
      ]) +
      onDemandCount([
        SuggestionSlotLifecycleStatus.Generating,
        SuggestionSlotLifecycleStatus.Ready,
      ]),
    ready:
      count([
        SuggestionSlotLifecycleStatus.Ready,
        SuggestionSlotLifecycleStatus.Active,
      ]) + onDemandCount([SuggestionSlotLifecycleStatus.Ready]),
    recordable: count([SuggestionSlotLifecycleStatus.Recordable]),
    recorded:
      count([
        SuggestionSlotLifecycleStatus.Recorded,
        SuggestionSlotLifecycleStatus.Edited,
      ]) +
      onDemandCount([
        SuggestionSlotLifecycleStatus.Recorded,
        SuggestionSlotLifecycleStatus.Edited,
      ]),
    edited:
      count([SuggestionSlotLifecycleStatus.Edited]) +
      onDemandCount([SuggestionSlotLifecycleStatus.Edited]),
    failed:
      count([SuggestionSlotLifecycleStatus.Failed]) +
      onDemandCount([SuggestionSlotLifecycleStatus.Failed]),
    onDemand: onDemandSuggestions.length,
  };
}

export function shouldExposeTodaySlot(slot: TodaysSuggestionSlotDto): boolean {
  if (slot.status !== SuggestionSlotLifecycleStatus.Missed) return true;
  if (slot.recording) return true;
  return slot.suggestion?.generationStatus === SuggestionGenerationStatus.Ready;
}

export function buildTodayOnDemandDto(
  params: {
    suggestion: SuggestionInstance;
    applicationLog: ApplicationLog | null;
    gapActionByKey?: ReadonlyMap<string, SuggestionGapActionKind>;
  } & ProductImageUrlResolverOptions,
): TodaysOnDemandSuggestionDto {
  const {
    suggestion,
    applicationLog,
    gapActionByKey,
    resolveProductImageUrls,
  } = params;
  const productImageOptions = { resolveProductImageUrls };
  const status = onDemandStatus(suggestion, applicationLog);
  return {
    id: suggestion.id,
    status,
    requestedAt: toIsoString(suggestion.visible_at ?? suggestion.created_at),
    recording: applicationLog ? buildRecordingDto(applicationLog) : null,
    applicationLog: applicationLog
      ? ApplicationLogResponseDto.fromEntity(
          applicationLog,
          productImageOptions,
        )
      : null,
    suggestion: SuggestionInstanceResponseDto.fromEntity(suggestion, {
      applicationLogId: applicationLog?.id ?? null,
      gapActionByKey,
      ...productImageOptions,
    }),
  };
}

function onDemandStatus(
  suggestion: SuggestionInstance,
  applicationLog: ApplicationLog | null,
): TodaysOnDemandSuggestionDto['status'] {
  if (applicationLog?.has_been_edited) {
    return SuggestionSlotLifecycleStatus.Edited;
  }
  if (applicationLog) return SuggestionSlotLifecycleStatus.Recorded;
  if (suggestion.generation_status === SuggestionGenerationStatus.Failed) {
    return SuggestionSlotLifecycleStatus.Failed;
  }
  if (suggestion.generation_status === SuggestionGenerationStatus.Ready) {
    return SuggestionSlotLifecycleStatus.Ready;
  }
  return SuggestionSlotLifecycleStatus.Generating;
}

export function buildPausedActiveNames(
  suggestions: SuggestionInstance[],
): string[] {
  return unique(
    suggestions.flatMap(
      (suggestion) =>
        suggestion.ai_explanation?.skipped.map((skipped) => skipped.name) ?? [],
    ),
  ).slice(0, 4);
}

function buildSpecialistDto(
  slot: ScheduleSlot,
): TodaysSuggestionSpecialistDto | null {
  const lockedStepCount = countSpecialistLockedSteps(slot);
  if (lockedStepCount === 0) return null;
  return {
    lockedStepCount,
    providerName: slot.specialist_provider_name ?? null,
    clinicName: slot.specialist_clinic_name ?? null,
    activeSince:
      slot.specialist_active_since ??
      earliestLockedStepDate(slot)?.slice(0, 10) ??
      null,
    safetyNetMessage: slot.specialist_safety_notes ?? null,
  };
}

function countSpecialistLockedSteps(slot: ScheduleSlot): number {
  return slot.steps?.filter((step) => step.is_specialist_locked).length ?? 0;
}

function earliestLockedStepDate(slot: ScheduleSlot): string | null {
  const dates = (slot.steps ?? [])
    .filter((step) => step.is_specialist_locked)
    .map((step) => step.created_at)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ? toDateOnlyString(dates[0]) : null;
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}
