import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEvent } from '../skin-journal/entities/skin-journal-event.entity';
import { SKIN_JOURNAL_BADGE_WARNING_SEVERITIES } from './app-badges.constants';
import { AppBadgesService } from './app-badges.service';

const repo = () => ({
  count: jest.fn().mockResolvedValue(0),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('AppBadgesService', () => {
  let service: AppBadgesService;
  let notifications: ReturnType<typeof repo>;
  let journalEvents: ReturnType<typeof repo>;
  let simplifications: ReturnType<typeof repo>;

  beforeEach(async () => {
    notifications = repo();
    journalEvents = repo();
    simplifications = repo();

    const module = await Test.createTestingModule({
      providers: [
        AppBadgesService,
        {
          provide: getRepositoryToken(InAppNotification),
          useValue: notifications,
        },
        {
          provide: getRepositoryToken(SkinJournalEvent),
          useValue: journalEvents,
        },
        {
          provide: getRepositoryToken(RoutineSimplificationEvent),
          useValue: simplifications,
        },
      ],
    }).compile();

    service = module.get(AppBadgesService);
  });

  it('returns nav badge counts using count-only indexed lookups', async () => {
    notifications.count.mockResolvedValueOnce(7);
    journalEvents.count.mockResolvedValueOnce(2);
    simplifications.count.mockResolvedValueOnce(1);

    const result = await service.getNavBadges('user-1');

    expect(notifications.count).toHaveBeenCalledWith({
      where: { user_id: 'user-1', read_at: expect.any(Object) },
    });
    expect(journalEvents.count).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        acknowledged_at: expect.any(Object),
        severity: expect.objectContaining({
          _value: [...SKIN_JOURNAL_BADGE_WARNING_SEVERITIES],
        }),
      },
    });
    expect(simplifications.count).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        acknowledged_at: expect.any(Object),
        ended_at: expect.any(Object),
      },
    });
    expect(result).toEqual({
      notifications_unread_count: 7,
      skin_journal_warning_count: 2,
    });
    expect(notifications.find).not.toHaveBeenCalled();
    expect(journalEvents.find).not.toHaveBeenCalled();
    expect(simplifications.find).not.toHaveBeenCalled();
  });

  it('shows one journal warning when only an active simplification needs attention', async () => {
    notifications.count.mockResolvedValueOnce(0);
    journalEvents.count.mockResolvedValueOnce(0);
    simplifications.count.mockResolvedValueOnce(1);

    await expect(service.getNavBadges('user-1')).resolves.toEqual({
      notifications_unread_count: 0,
      skin_journal_warning_count: 1,
    });
  });
});
