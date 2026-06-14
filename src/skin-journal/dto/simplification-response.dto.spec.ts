import type { RoutineSimplificationEvent } from '../entities/routine-simplification-event.entity';
import { SimplificationResponseDto } from './simplification-response.dto';

describe('SimplificationResponseDto', () => {
  it('backfills Recovery Mode defaults for legacy simplification rows', () => {
    const dto = SimplificationResponseDto.fromEntity({
      id: 'simplification-1',
      triggered_by_event_id: null,
      started_at: new Date('2026-06-14T10:00:00.000Z'),
      ended_at: null,
      simplification_mode: 'barrier_repair',
      reason: null,
      acknowledged_at: null,
      restore_strategy: 'full',
      original_schedule_snapshot: null,
    } as RoutineSimplificationEvent);

    expect(dto.recovery_phase).toBe('stabilize');
    expect(dto.recovery_trigger_source).toBe('unknown');
    expect(dto.recovery_trigger_symptoms).toEqual([]);
    expect(dto.recovery_trigger_severity).toBeNull();
    expect(dto.recovery_active_overuse).toBe(false);
    expect(dto.recovery_return_step).toBe('not_started');
  });
});
