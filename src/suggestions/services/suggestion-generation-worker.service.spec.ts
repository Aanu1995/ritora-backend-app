import { ConfigService } from '@nestjs/config';
import { ObjectLiteral, Repository } from 'typeorm';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionGenerationService } from './suggestion-generation.service';
import { SuggestionGenerationWorker } from './suggestion-generation-worker.service';

describe('SuggestionGenerationWorker', () => {
  const generationService = {
    generateForJob: jest.fn(),
  } as unknown as jest.Mocked<SuggestionGenerationService>;
  const jobRepo = repo<SuggestionGenerationJob>();
  const suggestionRepo = repo<SuggestionInstance>();
  const queryBuilder = updateQueryBuilder();
  const worker = new SuggestionGenerationWorker(
    {
      get: jest.fn().mockReturnValue('development'),
    } as unknown as ConfigService,
    generationService,
    jobRepo,
    suggestionRepo,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jobRepo.createQueryBuilder.mockReturnValue(queryBuilder as never);
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
});

function repo<T extends ObjectLiteral>() {
  return {
    createQueryBuilder: jest.fn(),
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
