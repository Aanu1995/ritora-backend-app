import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SkinJournalInsightQueueService } from './skin-journal-insight-queue.service';

const repo = () => ({
  create: jest.fn((data) => ({
    id: 'insight-job-1',
    status: 'queued',
    trigger: 'scheduled_refresh',
    locale: 'en',
    input_signature: 'signature-1',
    attempt_count: 0,
    max_attempts: 5,
    run_after: new Date(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...data,
  })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
});

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : fallback,
    ),
  } as unknown as ConfigService;
}

describe('SkinJournalInsightQueueService', () => {
  const services: SkinJournalInsightQueueService[] = [];

  afterEach(() => {
    for (const service of services) {
      service.onModuleDestroy();
    }
    services.length = 0;
    jest.clearAllMocks();
  });

  it('creates a DB job and sends an SQS message containing only the job id', async () => {
    const jobs = repo();
    jobs.find.mockResolvedValue([
      {
        id: 'insight-job-1',
        user_id: 'user-1',
        status: 'queued',
        run_after: new Date(),
      },
    ]);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      }),
    );
    services.push(service);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'photo_analysis_completed',
      locale: 'en',
      inputSignature: 'signature-1',
      reason: 'Insight generation queued.',
    });

    const command = send.mock.calls[0]?.[0] as {
      input: { MessageBody: string; QueueUrl: string };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      job_id: 'insight-job-1',
    });
    expect(command.input.MessageBody).not.toContain('user-1');
    expect(command.input.MessageBody).not.toContain('signature-1');
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' }),
    );
  });

  it('coalesces active user jobs instead of creating duplicate expensive work', async () => {
    const jobs = repo();
    const activeJob = {
      id: 'insight-job-1',
      user_id: 'user-1',
      status: 'queued',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: 'old-signature',
      attempt_count: 0,
      max_attempts: 5,
      run_after: new Date('2026-05-01T09:00:00.000Z'),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    };
    jobs.findOne.mockResolvedValue(activeJob);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'check_in_updated',
      locale: 'sv',
      inputSignature: 'new-signature',
    });

    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'insight-job-1',
        trigger: 'check_in_updated',
        locale: 'sv',
        input_signature: 'new-signature',
        status: 'queued',
      }),
    );
  });

  it('does not overwrite a running user job when a later enqueue arrives', async () => {
    const jobs = repo();
    const runningJob = {
      id: 'insight-job-running',
      user_id: 'user-1',
      status: 'running',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: 'running-signature',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date('2026-05-01T09:00:00.000Z'),
      locked_at: new Date('2026-05-01T09:01:00.000Z'),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
    };
    jobs.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(runningJob);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const result = await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'check_in_updated',
      locale: 'sv',
      inputSignature: 'new-signature',
    });

    expect(result).toBe(runningJob);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('keeps the DB job queued when SQS send fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const jobs = repo();
    jobs.find.mockResolvedValue([
      {
        id: 'insight-job-1',
        user_id: 'user-1',
        status: 'queued',
        run_after: new Date(),
      },
    ]);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      }),
    );
    services.push(service);
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send: jest.fn().mockRejectedValue(new Error('sqs unavailable')),
    };

    await service.dispatchDueJobs();

    loggerSpy.mockRestore();
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        last_error: 'sqs unavailable',
      }),
    );
  });
});
