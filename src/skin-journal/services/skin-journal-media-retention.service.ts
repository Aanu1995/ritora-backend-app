import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { SkinJournalMediaDeletionJob } from '../entities/skin-journal-media-deletion-job.entity';
import {
  SKIN_JOURNAL_MEDIA_DELETION_VERIFY_BATCH_SIZE,
  SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS,
  SKIN_JOURNAL_MEDIA_DELETION_VERIFY_INTERVAL_MS,
  SKIN_JOURNAL_MEDIA_DELETION_VERIFY_MAX_ATTEMPTS,
} from '../skin-journal.constants';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';

@Injectable()
export class SkinJournalMediaRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkinJournalMediaRetentionService.name);
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(
    @InjectRepository(SkinJournalMediaDeletionJob)
    private readonly deletionJobs: Repository<SkinJournalMediaDeletionJob>,
    private readonly photoStorage: SkinJournalPhotoStorageService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.stopped = false;
    this.scheduleVerification(SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
  }

  async enqueueDeletionVerification(params: {
    userId: string | null;
    objectKey: string;
    reason: string;
    runAfter?: Date;
  }): Promise<SkinJournalMediaDeletionJob> {
    const existing = await this.deletionJobs.findOne({
      where: { object_key: params.objectKey },
    });
    const job =
      existing ??
      this.deletionJobs.create({
        object_key: params.objectKey,
        attempt_count: 0,
      });

    job.user_id = params.userId;
    job.object_key = params.objectKey;
    job.status = 'pending';
    job.run_after =
      params.runAfter ??
      new Date(Date.now() + SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS);
    job.last_error = params.reason;
    job.verified_at = null;
    const saved = await this.deletionJobs.save(job);
    this.scheduleVerification(SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS);
    return saved;
  }

  async verifyDueDeletions(now = new Date()): Promise<number> {
    const jobs = await this.deletionJobs.find({
      where: {
        status: 'pending',
        run_after: LessThanOrEqual(now),
      },
      order: { run_after: 'ASC' },
      take: SKIN_JOURNAL_MEDIA_DELETION_VERIFY_BATCH_SIZE,
    });
    let verified = 0;
    for (const job of jobs) {
      job.attempt_count += 1;
      try {
        await this.photoStorage.deletePhoto(job.object_key);
        const exists = await this.photoStorage.photoExists(job.object_key);
        if (exists) {
          throw new Error('Media object still exists after delete attempt');
        }
        job.status = 'verified';
        job.last_error = null;
        job.verified_at = now;
        await this.deletionJobs.save(job);
        verified += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown retention error';
        job.last_error = message;
        job.status =
          job.attempt_count >= SKIN_JOURNAL_MEDIA_DELETION_VERIFY_MAX_ATTEMPTS
            ? 'failed'
            : 'pending';
        job.run_after = new Date(
          now.getTime() + this.nextRetryDelayMs(job.attempt_count),
        );
        await this.deletionJobs.save(job);
        this.logger.warn(
          `Skin Journal media deletion verification failed for ${job.id}: ${message}`,
        );
      }
    }
    return verified;
  }

  private nextRetryDelayMs(attemptCount: number): number {
    return Math.min(
      24 * 60 * 60 * 1000,
      SKIN_JOURNAL_MEDIA_DELETION_VERIFY_DELAY_MS *
        2 ** Math.max(0, attemptCount - 1),
    );
  }

  private scheduleVerification(delayMs: number): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    if (this.stopped) {
      return;
    }
    if (this.verifyTimer) {
      clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
    this.verifyTimer = setTimeout(() => {
      this.verifyTimer = null;
      void this.verifyDueDeletions()
        .catch((error) => {
          this.logger.warn(
            `Skin Journal media deletion verification sweep failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        })
        .finally(() =>
          this.stopped
            ? undefined
            : this.scheduleVerification(
                SKIN_JOURNAL_MEDIA_DELETION_VERIFY_INTERVAL_MS,
              ),
        );
    }, delayMs);
    this.verifyTimer.unref?.();
  }
}
