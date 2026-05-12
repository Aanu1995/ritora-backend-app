import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SmartPicksOverviewService } from './smart-picks-overview.service';

@Injectable()
export class SmartPicksPreparationService {
  private readonly logger = new Logger(SmartPicksPreparationService.name);
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly overviewService: SmartPicksOverviewService,
  ) {}

  scheduleForUser(userId: string): void {
    if (this.jobs.has(userId)) return;

    const job = this.prepareForUser(userId)
      .catch((error) => {
        this.logger.warn(
          `Smart Picks background preparation failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      })
      .finally(() => {
        this.jobs.delete(userId);
      });

    this.jobs.set(userId, job);
  }

  async waitForIdle(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.allSettled(this.jobs.values());
    }
  }

  private async prepareForUser(userId: string): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) return;

    await this.overviewService.getOverview(user, null);
  }
}
