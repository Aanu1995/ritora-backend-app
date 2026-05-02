import { Logger } from '@nestjs/common';
import { SkinJournalMediaDeletionJob } from '../entities/skin-journal-media-deletion-job.entity';
import { SkinJournalMediaRetentionService } from './skin-journal-media-retention.service';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';

const deletionJob = (
  overrides: Partial<SkinJournalMediaDeletionJob> = {},
): SkinJournalMediaDeletionJob => ({
  id: 'media-job-1',
  user_id: 'user-1',
  object_key: 'skin-journal/user-1/entry-1/photo.webp',
  status: 'pending',
  attempt_count: 0,
  run_after: new Date('2026-04-30T00:00:00.000Z'),
  last_error: null,
  verified_at: null,
  created_at: new Date('2026-04-30T00:00:00.000Z'),
  updated_at: new Date('2026-04-30T00:00:00.000Z'),
  generateId: jest.fn(),
  ...overrides,
});

const repo = () => ({
  create: jest.fn((data) => deletionJob(data)),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
});

describe('SkinJournalMediaRetentionService', () => {
  let jobs: ReturnType<typeof repo>;
  const photoStorage = {
    deletePhoto: jest.fn(),
    photoExists: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jobs = repo();
    photoStorage.deletePhoto.mockResolvedValue(undefined);
    photoStorage.photoExists.mockResolvedValue(false);
  });

  it('records deletion verification jobs without storing user media URLs', async () => {
    const service = new SkinJournalMediaRetentionService(
      jobs as never,
      photoStorage as unknown as SkinJournalPhotoStorageService,
    );

    await service.enqueueDeletionVerification({
      userId: 'user-1',
      objectKey: 'skin-journal/user-1/entry-1/photo.webp',
      reason: 'entry_deleted',
    });
    service.onModuleDestroy();

    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        object_key: 'skin-journal/user-1/entry-1/photo.webp',
        status: 'pending',
        last_error: 'entry_deleted',
      }),
    );
  });

  it('marks deleted media verified once storage confirms it no longer exists', async () => {
    const job = deletionJob();
    jobs.find.mockResolvedValue([job]);
    const service = new SkinJournalMediaRetentionService(
      jobs as never,
      photoStorage as unknown as SkinJournalPhotoStorageService,
    );

    const verified = await service.verifyDueDeletions(
      new Date('2026-04-30T01:00:00.000Z'),
    );

    expect(verified).toBe(1);
    expect(photoStorage.deletePhoto).toHaveBeenCalledWith(job.object_key);
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'verified',
        verified_at: new Date('2026-04-30T01:00:00.000Z'),
      }),
    );
  });

  it('backs off failed deletion verification without throwing', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const job = deletionJob();
    jobs.find.mockResolvedValue([job]);
    photoStorage.photoExists.mockResolvedValue(true);
    const service = new SkinJournalMediaRetentionService(
      jobs as never,
      photoStorage as unknown as SkinJournalPhotoStorageService,
    );

    const verified = await service.verifyDueDeletions(
      new Date('2026-04-30T01:00:00.000Z'),
    );
    loggerSpy.mockRestore();

    expect(verified).toBe(0);
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        attempt_count: 1,
        last_error: 'Media object still exists after delete attempt',
        run_after: expect.any(Date),
      }),
    );
  });

  it('does not reschedule deletion verification after shutdown', async () => {
    jest.useFakeTimers();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let resolveFind!: (jobs: SkinJournalMediaDeletionJob[]) => void;
    jobs.find.mockReturnValue(
      new Promise<SkinJournalMediaDeletionJob[]>((resolve) => {
        resolveFind = resolve;
      }),
    );
    const service = new SkinJournalMediaRetentionService(
      jobs as never,
      photoStorage as unknown as SkinJournalPhotoStorageService,
    );

    try {
      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(300000);

      expect(jobs.find).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      resolveFind([]);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(3600000);

      expect(jobs.find).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      jest.useRealTimers();
    }
  });
});
