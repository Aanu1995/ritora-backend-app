import { SkinJournalController } from './skin-journal.controller';
import { SkinJournalService } from './skin-journal.service';
import { todayInTimeZone } from './skin-journal.utils';

const mockSkinJournalService = () => ({
  getToday: jest.fn(),
  upsertEntryForResolvedDate: jest.fn(),
});

describe('SkinJournalController', () => {
  let controller: SkinJournalController;
  let service: ReturnType<typeof mockSkinJournalService>;

  beforeEach(() => {
    service = mockSkinJournalService();
    controller = new SkinJournalController(
      service as unknown as SkinJournalService,
    );
  });

  it('uses the persisted user timezone for today reads when a browser header is also present', async () => {
    service.getToday.mockResolvedValue({ date: '2026-04-29', entry: null });

    await controller.getToday('user-1', 'Europe/Stockholm', 'Pacific/Honolulu');

    expect(service.getToday).toHaveBeenCalledWith('user-1', 'Europe/Stockholm');
  });

  it('uses the persisted user timezone for today uploads when a browser header is also present', async () => {
    service.upsertEntryForResolvedDate.mockResolvedValue({ id: 'entry-1' });

    await controller.upsertToday(
      'user-1',
      'Europe/Stockholm',
      'Pacific/Honolulu',
      undefined,
      {},
    );

    expect(service.upsertEntryForResolvedDate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        targetDate: todayInTimeZone('Europe/Stockholm'),
        timeZone: 'Europe/Stockholm',
        photo: null,
      }),
    );
  });

  it('falls back to a browser timezone header only when the user has no saved timezone', async () => {
    service.upsertEntryForResolvedDate.mockResolvedValue({ id: 'entry-1' });

    await controller.upsertToday(
      'user-1',
      null,
      'Europe/Stockholm',
      undefined,
      {},
    );

    expect(service.upsertEntryForResolvedDate).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDate: todayInTimeZone('Europe/Stockholm'),
        timeZone: 'Europe/Stockholm',
      }),
    );
  });
});
