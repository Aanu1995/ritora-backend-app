import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEvent } from '../skin-journal/entities/skin-journal-event.entity';
import { SKIN_JOURNAL_BADGE_WARNING_SEVERITIES } from './app-badges.constants';
import { AppNavBadgesResponseDto } from './dto/app-nav-badges-response.dto';

type NavBadgeCountParts = {
  notificationsUnreadCount: number;
  unacknowledgedJournalWarningCount: number;
  activeSimplificationWarningCount: number;
};

@Injectable()
export class AppBadgesService {
  constructor(
    @InjectRepository(InAppNotification)
    private readonly notifications: Repository<InAppNotification>,
    @InjectRepository(SkinJournalEvent)
    private readonly journalEvents: Repository<SkinJournalEvent>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplifications: Repository<RoutineSimplificationEvent>,
  ) {}

  async getNavBadges(userId: string): Promise<AppNavBadgesResponseDto> {
    const counts = await this.countNavBadgeParts(userId);

    return {
      notifications_unread_count: counts.notificationsUnreadCount,
      skin_journal_warning_count: journalWarningBadgeCount(counts),
    };
  }

  private async countNavBadgeParts(
    userId: string,
  ): Promise<NavBadgeCountParts> {
    const [
      notificationsUnreadCount,
      unacknowledgedJournalWarningCount,
      activeSimplificationWarningCount,
    ] = await Promise.all([
      this.notifications.count({
        where: { user_id: userId, read_at: IsNull() },
      }),
      this.journalEvents.count({
        where: {
          user_id: userId,
          acknowledged_at: IsNull(),
          severity: In([...SKIN_JOURNAL_BADGE_WARNING_SEVERITIES]),
        },
      }),
      this.simplifications.count({
        where: {
          user_id: userId,
          acknowledged_at: IsNull(),
          ended_at: IsNull(),
        },
      }),
    ]);

    return {
      notificationsUnreadCount,
      unacknowledgedJournalWarningCount,
      activeSimplificationWarningCount,
    };
  }
}

function journalWarningBadgeCount(counts: NavBadgeCountParts): number {
  // A simplification is usually created from a warning event, so collapse both
  // sources into one visible attention count instead of double-counting it.
  return Math.max(
    counts.unacknowledgedJournalWarningCount,
    counts.activeSimplificationWarningCount,
  );
}
