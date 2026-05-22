import { ConfigService } from '@nestjs/config';
import { SkinJournalAnalysisQueueService } from './skin-journal-analysis-queue.service';

const queueUrl = process.env.SKIN_JOURNAL_ANALYSIS_SQS_INTEGRATION_QUEUE_URL;
const describeSqs = queueUrl ? describe : describe.skip;

const repo = () => ({
  create: jest.fn((data) => ({
    id: 'analysis-job-integration',
    status: 'queued',
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
  find: jest.fn().mockResolvedValue([
    {
      id: 'analysis-job-integration',
      user_id: 'user-integration',
      entry_id: 'entry-integration',
      photo_object_key: 'skin-journal/integration/photo.webp',
      status: 'queued',
      run_after: new Date(),
    },
  ]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
});

function config(): ConfigService {
  return {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER') return 'sqs';
      if (key === 'SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL') return queueUrl;
      return fallback;
    }),
  } as unknown as ConfigService;
}

describeSqs('Skin Journal SQS integration', () => {
  it('sends and receives job-id-only messages against a real or local SQS queue', async () => {
    const service = new SkinJournalAnalysisQueueService(
      repo() as never,
      config(),
    );

    await service.dispatchDueJobs(1);
    const messages = await service.receiveMessages();
    const message = messages.find(
      (candidate) => candidate.jobId === 'analysis-job-integration',
    );

    expect(message).toBeDefined();
    expect(JSON.stringify(message)).not.toContain('user-integration');
    expect(JSON.stringify(message)).not.toContain('photo.webp');
    if (message) {
      await service.deleteMessage(message.receiptHandle);
    }
    service.onModuleDestroy();
  }, 30000);
});
