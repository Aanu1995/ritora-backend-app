import { ApiProperty } from '@nestjs/swagger';
import { RoutineSimplificationEvent } from '../entities/routine-simplification-event.entity';
import type {
  RestoreStrategy,
  ScheduleSnapshot,
  SimplificationMode,
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
    dto.reason = event.reason;
    dto.acknowledged_at = event.acknowledged_at;
    dto.restore_strategy = event.restore_strategy;
    dto.original_schedule_snapshot = event.original_schedule_snapshot;
    return dto;
  }
}
