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

  it('requeues a terminal existing job without changing its primary id', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'job-1',
      status: 'completed',
      target_time: '07:00',
    } as SuggestionGenerationJob);

    const requeued = await requeueSuggestionGenerationJob(repoMock, draft());

    expect(requeued).toBe(true);
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

  it('does not rewrite an already queued job for the same scheduled time', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'job-1',
      status: 'queued',
      target_time: '08:00:00',
    } as SuggestionGenerationJob);

    const requeued = await requeueSuggestionGenerationJob(repoMock, draft());

    expect(requeued).toBe(false);
    expect(repoMock.insert).not.toHaveBeenCalled();
    expect(repoMock.update).not.toHaveBeenCalled();
  });

  it('does not clobber a running scheduled job even when the target time changed', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'job-1',
      status: 'running',
      target_time: '07:00',
    } as SuggestionGenerationJob);

    const requeued = await requeueSuggestionGenerationJob(repoMock, draft());

    expect(requeued).toBe(false);
    expect(repoMock.insert).not.toHaveBeenCalled();
    expect(repoMock.update).not.toHaveBeenCalled();
  });

  it('requeues on-demand jobs by suggestion instance rather than slot/date', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'job-on-demand-1',
      status: 'failed',
      target_time: '12:15',
    } as SuggestionGenerationJob);

    const requeued = await requeueSuggestionGenerationJob(repoMock, {
      ...draft(),
      slot_id: null,
      suggestion_instance_id: 'suggestion-on-demand-1',
      request_source: 'on_demand',
    });

    expect(requeued).toBe(true);
    expect(repoMock.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          suggestion_instance_id: 'suggestion-on-demand-1',
          request_source: 'on_demand',
        },
      }),
    );
    expect(repoMock.update).toHaveBeenCalledWith(
      { id: 'job-on-demand-1' },
      expect.objectContaining({
        slot_id: null,
        suggestion_instance_id: 'suggestion-on-demand-1',
        request_source: 'on_demand',
      }),
    );
  });

  it('keeps scheduled jobs linked only by slot/date even when a replacement suggestion exists', async () => {
    repoMock.findOne.mockResolvedValue(null);

    const requeued = await requeueSuggestionGenerationJob(repoMock, {
      ...draft(),
      suggestion_instance_id: 'replacement-suggestion-1',
      request_source: 'scheduled',
    });

    expect(requeued).toBe(true);
    expect(repoMock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        slot_id: 'slot-1',
        suggestion_instance_id: null,
        request_source: 'scheduled',
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
