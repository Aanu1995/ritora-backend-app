import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SkinJournalInsightState } from '../entities/skin-journal-insight-state.entity';
import { SkinJournalService } from '../skin-journal.service';

const INSIGHT_SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const INSIGHT_SCHEDULER_BATCH_SIZE = 500;

@Injectable()
export class SkinJournalInsightSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkinJournalInsightSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(SkinJournalInsightState)
    private readonly states: Repository<SkinJournalInsightState>,
    private readonly journal: SkinJournalService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.runScheduledInsightSweep().catch((error) => {
        this.logger.warn(
          `Scheduled Skin Journal insight sweep failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, INSIGHT_SCHEDULER_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runScheduledInsightSweep(): Promise<number> {
    const rows = await this.states
      .createQueryBuilder('state')
      .select('state.user_id', 'user_id')
      .addSelect('user.preferred_language', 'preferred_language')
      .leftJoin(User, 'user', 'user.id = state.user_id')
      .where('state.dirty_since IS NOT NULL')
      .orderBy('state.dirty_since', 'ASC')
      .limit(INSIGHT_SCHEDULER_BATCH_SIZE)
      .getRawMany<{ user_id: string; preferred_language: string | null }>();

    let queued = 0;
    for (const row of rows) {
      try {
        const didQueue = await this.journal.generateInsightsIfNeeded(
          row.user_id,
          row.preferred_language ?? 'en',
        );
        if (didQueue) {
          queued += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Scheduled insight enqueue failed for a user: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    return queued;
  }
}
