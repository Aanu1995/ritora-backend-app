import { ConfigService } from '@nestjs/config';
import { ObjectLiteral, Repository } from 'typeorm';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { RoutineBreakService } from './routine-break.service';
import { SuggestionGenerationService } from './suggestion-generation.service';
import { SuggestionGenerationWorker } from './suggestion-generation-worker.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';

describe('SuggestionGenerationWorker', () => {
  const generationService = {
    generateForJob: jest.fn(),
  } as unknown as jest.Mocked<SuggestionGenerationService>;
  const jobRepo = repo<SuggestionGenerationJob>();
  const suggestionRepo = repo<SuggestionInstance>();
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const routineBreakService = {
    isRoutineBreakActive: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const queryBuilder = updateQueryBuilder();
  const worker = new SuggestionGenerationWorker(
    {
      get: jest.fn().mockReturnValue('development'),
    } as unknown as ConfigService,
    generationService,
    jobRepo,
    suggestionRepo,
    observability,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jobRepo.createQueryBuilder.mockReturnValue(queryBuilder as never);
    jobRepo.find.mockResolvedValue([]);
    queryBuilder.execute.mockResolvedValue({
      raw: [
        {
          id: 'job-1',
          user_id: 'user-1',
          slot_id: 'slot-1',
          target_date: new Date(2026, 4, 4, 0, 0, 0),
          target_time: '08:00',
          attempt_count: 0,
        },
      ],
    });
    generationService.generateForJob.mockResolvedValue(undefined);
    routineBreakService.isRoutineBreakActive.mockResolvedValue(false);
    jobRepo.update.mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    });
    suggestionRepo.update.mockResolvedValue({
      affected: 1,
      raw: [],
      generatedMaps: [],
    });
  });

  it('recovers stale running jobs before claiming new work', async () => {
    const staleLockedAt = new Date('2026-05-04T05:40:00.000Z');
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T06:00:00.000Z'));
    jobRepo.find.mockResolvedValue([
      {
        id: 'stale-job',
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        target_time: '08:00',
        attempt_count: 0,
        locked_at: staleLockedAt,
      } as SuggestionGenerationJob,
    ]);
    queryBuilder.execute.mockResolvedValue({ raw: [] });

    await worker.pollOnce();

    expect(jobRepo.update).toHaveBeenCalledWith(
      { id: 'stale-job' },
      expect.objectContaining({
        status: 'queued',
        attempt_count: 1,
        locked_at: null,
        locked_by: null,
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'job_recovered',
        severity: 'warning',
        jobId: 'stale-job',
      }),
    );
    jest.useRealTimers();
  });

  it('marks the pending suggestion as generating before invoking AI generation', async () => {
    await worker.pollOnce();

    expect(suggestionRepo.update).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        generation_status: 'pending',
      },
      {
        generation_status: 'generating',
        ai_error: null,
      },
    );
    expect(suggestionRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      generationService.generateForJob.mock.invocationCallOrder[0],
    );
    expect(generationService.generateForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        target_date: '2026-05-04',
      }),
    );
  });

  it('cancels claimed queued work when a break becomes active before generation', async () => {
    routineBreakService.isRoutineBreakActive.mockResolvedValue(true);

    await worker.pollOnce();

    expect(generationService.generateForJob).not.toHaveBeenCalled();
    expect(suggestionRepo.update).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-05-04',
        generation_status: 'pending',
      },
      {
        generation_status: 'superseded',
        ai_error: 'routine_break_active',
      },
    );
    expect(jobRepo.update).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({
        status: 'cancelled',
        last_error: 'routine_break_active',
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function updateQueryBuilder() {
  return {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };
}
