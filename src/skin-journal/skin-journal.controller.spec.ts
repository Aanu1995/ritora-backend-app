import { SkinJournalController } from './skin-journal.controller';
import { SkinJournalService } from './skin-journal.service';
import { todayInTimeZone } from './skin-journal.utils';

const mockSkinJournalService = () => ({
  getToday: jest.fn(),
  listPhotos: jest.fn(),
  listPhotoDates: jest.fn(),
  listPhotoFilters: jest.fn(),
  listInsights: jest.fn(),
  getAnalysisQueueOperations: jest.fn(),
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

  it('passes photo-date filters to the service', async () => {
    service.listPhotoDates.mockResolvedValue({ dates: [], months: [] });

    await controller.listPhotoDates('user-1', '2025-01-01', '2026-04-30');

    expect(service.listPhotoDates).toHaveBeenCalledWith('user-1', {
      from: '2025-01-01',
      to: '2026-04-30',
    });
  });

  it('passes server-side photo filters to the service', async () => {
    service.listPhotos.mockResolvedValue({ items: [], nextCursor: null });

    await controller.listPhotos(
      'user-1',
      '2025-01-01',
      '2026-04-30',
      'concern:acne',
      '12',
      'cursor-1',
    );

    expect(service.listPhotos).toHaveBeenCalledWith('user-1', {
      from: '2025-01-01',
      to: '2026-04-30',
      filter: 'concern:acne',
      limit: 12,
      cursor: 'cursor-1',
    });
  });

  it('passes photo filter facet requests to the service', async () => {
    service.listPhotoFilters.mockResolvedValue({ filters: [] });

    await controller.listPhotoFilters('user-1', '2025-01-01', '2026-04-30');

    expect(service.listPhotoFilters).toHaveBeenCalledWith('user-1', {
      from: '2025-01-01',
      to: '2026-04-30',
    });
  });

  it('passes the private operations token to the queue operations endpoint', async () => {
    service.getAnalysisQueueOperations.mockResolvedValue({ alerts: [] });

    await controller.analysisQueueOperations('ops-token');

    expect(service.getAnalysisQueueOperations).toHaveBeenCalledWith(
      'ops-token',
    );
  });

  it('keeps insight listing read-only and passes window and locale filters', async () => {
    service.listInsights.mockResolvedValue({ insights: [], meta: {} });

    await controller.listInsights('user-1', 'month', 'sv');

    expect(service.listInsights).toHaveBeenCalledWith('user-1', {
      window: 'month',
      locale: 'sv',
    });
  });
});
