import { ObjectLiteral, Repository } from 'typeorm';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import {
  insertSuggestionGenerationJob,
  requeueSuggestionGenerationJob,
} from './suggestion-generation-job-queue';

describe('suggestion generation job queue helpers', () => {
  const repoMock = repo<SuggestionGenerationJob>();

  beforeEach(() => {
    jest.clearAllMocks();
    repoMock.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });
  });

  it('inserts a job with an explicit id because TypeORM insert hooks are not run for plain rows', async () => {
    const inserted = await insertSuggestionGenerationJob(repoMock, draft());

    expect(inserted).toBe(true);
    expect(repoMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        locked_at: null,
        locked_by: null,
      }),
    );
  });

  it('requeues an existing job without changing its primary id', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'job-1',
    } as SuggestionGenerationJob);

    await requeueSuggestionGenerationJob(repoMock, draft());

    expect(repoMock.insert).not.toHaveBeenCalled();
    expect(repoMock.update).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        status: 'queued',
        locked_at: null,
        locked_by: null,
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    findOne: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function draft() {
  return {
    user_id: 'user-1',
    slot_id: 'slot-1',
    target_date: '2026-04-29',
    target_time: '08:00',
    visible_at: new Date('2026-04-29T06:00:00.000Z'),
    status: 'queued' as const,
    attempt_count: 0,
    run_after: new Date('2026-04-29T06:00:00.000Z'),
    last_error: null,
  };
}
