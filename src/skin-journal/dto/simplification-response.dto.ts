import { ApiProperty } from '@nestjs/swagger';
import { RoutineSimplificationEvent } from '../entities/routine-simplification-event.entity';
import type {
  ReactionReportSeverity,
  ReactionReportSymptom,
  RecoveryPhase,
  RecoveryReturnStep,
  RecoveryTriggerSource,
  RestoreStrategy,
  ScheduleSnapshot,
  SimplificationMode,
} from '../skin-journal.constants';
import {
  RecoveryPhaseValue,
  RecoveryReturnStepValue,
  RecoveryTriggerSourceValue,
} from '../skin-journal.constants';

export class SimplificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  triggered_by_event_id: string | null;

  @ApiProperty()
  started_at: Date;

  @ApiProperty({ required: false, nullable: true })
  ended_at: Date | null;

  @ApiProperty()
  simplification_mode: SimplificationMode;

  @ApiProperty()
  recovery_phase: RecoveryPhase;

  @ApiProperty()
  recovery_trigger_source: RecoveryTriggerSource;

  @ApiProperty({ type: [String] })
  recovery_trigger_symptoms: ReactionReportSymptom[];

  @ApiProperty({ required: false, nullable: true })
  recovery_trigger_severity: ReactionReportSeverity | null;

  @ApiProperty()
  recovery_active_overuse: boolean;

  @ApiProperty({ required: false, nullable: true })
  recovery_review_after: Date | null;

  @ApiProperty({ required: false, nullable: true })
  recovery_exit_eligible_at: Date | null;

  @ApiProperty()
  recovery_return_step: RecoveryReturnStep;

  @ApiProperty({ required: false, nullable: true })
  reason: string | null;

  @ApiProperty({ required: false, nullable: true })
  acknowledged_at: Date | null;

  @ApiProperty()
  restore_strategy: RestoreStrategy;

  @ApiProperty({ required: false, nullable: true })
  original_schedule_snapshot: ScheduleSnapshot | null;

  static fromEntity(
    event: RoutineSimplificationEvent,
  ): SimplificationResponseDto {
    const dto = new SimplificationResponseDto();
    dto.id = event.id;
    dto.triggered_by_event_id = event.triggered_by_event_id;
    dto.started_at = event.started_at;
    dto.ended_at = event.ended_at;
    dto.simplification_mode = event.simplification_mode;
    dto.recovery_phase = event.recovery_phase ?? RecoveryPhaseValue.Stabilize;
    dto.recovery_trigger_source =
      event.recovery_trigger_source ?? RecoveryTriggerSourceValue.Unknown;
    dto.recovery_trigger_symptoms = event.recovery_trigger_symptoms ?? [];
    dto.recovery_trigger_severity = event.recovery_trigger_severity ?? null;
    dto.recovery_active_overuse = event.recovery_active_overuse ?? false;
    dto.recovery_review_after = event.recovery_review_after ?? null;
    dto.recovery_exit_eligible_at = event.recovery_exit_eligible_at ?? null;
    dto.recovery_return_step =
      event.recovery_return_step ?? RecoveryReturnStepValue.NotStarted;
    dto.reason = event.reason;
    dto.acknowledged_at = event.acknowledged_at;
    dto.restore_strategy = event.restore_strategy;
    dto.original_schedule_snapshot = event.original_schedule_snapshot;
    return dto;
  }
}
