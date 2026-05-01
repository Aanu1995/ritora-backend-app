import { SkinJournalService } from '../skin-journal.service';
import { SkinJournalInsightSchedulerService } from './skin-journal-insight-scheduler.service';

describe('SkinJournalInsightSchedulerService', () => {
  it('evaluates only users with dirty insight state', async () => {
    const getRawMany = jest
      .fn()
      .mockResolvedValue([{ user_id: 'user-1' }, { user_id: 'user-2' }]);
    const states = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany,
      })),
    };
    const journal = {
      generateInsightsIfNeeded: jest.fn().mockResolvedValue(true),
    };
    const scheduler = new SkinJournalInsightSchedulerService(
      states as never,
      journal as unknown as SkinJournalService,
    );

    const queued = await scheduler.runScheduledInsightSweep();

    expect(queued).toBe(2);
    expect(journal.generateInsightsIfNeeded).toHaveBeenCalledWith('user-1');
    expect(journal.generateInsightsIfNeeded).toHaveBeenCalledWith('user-2');
    expect(states.createQueryBuilder).toHaveBeenCalledWith('state');
  });
});
