import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SkinJournalController } from './skin-journal.controller';
import { SkinJournalService } from './skin-journal.service';
import { todayInTimeZone } from './skin-journal.utils';
import { UserRestrictionEnforcementService } from '../users/user-restriction-enforcement.service';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';

const mockSkinJournalService = () => ({
  getToday: jest.fn(),
  listPhotos: jest.fn(),
  listPhotoDates: jest.fn(),
  listPhotoFilters: jest.fn(),
  listInsights: jest.fn(),
  getAnalysisQueueOperations: jest.fn(),
  upsertEntryForResolvedDate: jest.fn(),
  reinterpretAnalysis: jest.fn(),
  recordAnalysisFeedback: jest.fn(),
});

const mockRestrictionEnforcement = () => ({
  assertAllAllowed: jest.fn(),
});

const mockPlatformRestrictions = () => ({
  assertAllAllowed: jest.fn(),
});

describe('SkinJournalController', () => {
  let controller: SkinJournalController;
  let service: ReturnType<typeof mockSkinJournalService>;
  let restrictions: ReturnType<typeof mockRestrictionEnforcement>;
  let platformRestrictions: ReturnType<typeof mockPlatformRestrictions>;

  beforeEach(() => {
    service = mockSkinJournalService();
    restrictions = mockRestrictionEnforcement();
    platformRestrictions = mockPlatformRestrictions();
    controller = new SkinJournalController(
      service as unknown as SkinJournalService,
      restrictions as unknown as UserRestrictionEnforcementService,
      platformRestrictions as unknown as PlatformGlobalRestrictionsService,
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
      }),
    );
  });

  it('maps angle-specific multipart uploads into a front-required photo set', async () => {
    service.upsertEntryForResolvedDate.mockResolvedValue({ id: 'entry-1' });
    const front = {
      buffer: Buffer.from('front'),
      mimetype: 'image/jpeg',
      size: 10,
      originalname: 'front.jpg',
    };
    const left = {
      buffer: Buffer.from('left'),
      mimetype: 'image/png',
      size: 10,
      originalname: 'left.png',
    };
    const right = {
      buffer: Buffer.from('right'),
      mimetype: 'image/webp',
      size: 10,
      originalname: 'right.webp',
    };

    await controller.upsertToday(
      'user-1',
      'Europe/Stockholm',
      undefined,
      {
        photo_head_on: [front],
        photo_left_profile: [left],
        photo_right_profile: [right],
      },
      { skip_check_in: true, photo_processing_consent: true },
    );

    expect(service.upsertEntryForResolvedDate).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: {
          head_on: { buffer: front.buffer, contentType: 'image/jpeg' },
          left_profile: { buffer: left.buffer, contentType: 'image/png' },
          right_profile: { buffer: right.buffer, contentType: 'image/webp' },
        },
      }),
    );
  });

  it('maps the legacy single-photo multipart field as the front angle', async () => {
    service.upsertEntryForResolvedDate.mockResolvedValue({ id: 'entry-1' });
    const legacyFront = {
      buffer: Buffer.from('legacy-front'),
      mimetype: 'image/jpeg',
      size: 10,
      originalname: 'legacy-front.jpg',
    };
    await controller.upsertToday(
      'user-1',
      'Europe/Stockholm',
      undefined,
      {
        photo: [legacyFront],
      },
      { skip_check_in: true, photo_processing_consent: true },
    );

    expect(service.upsertEntryForResolvedDate).toHaveBeenCalledWith(
      expect.objectContaining({
        photos: {
          head_on: { buffer: legacyFront.buffer, contentType: 'image/jpeg' },
        },
      }),
    );
  });

  it('rejects duplicate legacy and named front photo uploads', async () => {
    service.upsertEntryForResolvedDate.mockResolvedValue({ id: 'entry-1' });
    const legacyFront = {
      buffer: Buffer.from('legacy-front'),
      mimetype: 'image/jpeg',
      size: 10,
      originalname: 'legacy-front.jpg',
    };
    const namedFront = {
      buffer: Buffer.from('named-front'),
      mimetype: 'image/jpeg',
      size: 10,
      originalname: 'named-front.jpg',
    };

    await expect(
      controller.upsertToday(
        'user-1',
        'Europe/Stockholm',
        undefined,
        {
          photo: [legacyFront],
          photo_head_on: [namedFront],
        },
        { skip_check_in: true, photo_processing_consent: true },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(service.upsertEntryForResolvedDate).not.toHaveBeenCalled();
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

  it('guards multipart journal uploads before file parsing can run', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SkinJournalController.prototype.upsertToday,
    ) as readonly unknown[] | undefined;

    expect(guards?.map((guard) => readGuardName(guard))).toContain(
      'SkinJournalPhotoUploadRestrictionGuard',
    );
  });

  it('passes the private operations token to the queue operations endpoint', async () => {
    service.getAnalysisQueueOperations.mockResolvedValue({ alerts: [] });

    await controller.analysisQueueOperations('ops-token');

    expect(service.getAnalysisQueueOperations).toHaveBeenCalledWith(
      'ops-token',
    );
  });

  it('passes analysis reinterpret requests to the service', async () => {
    service.reinterpretAnalysis.mockResolvedValue({ id: 'entry-1' });

    await controller.reinterpretAnalysis('user-1', 'entry-1');

    expect(service.reinterpretAnalysis).toHaveBeenCalledWith(
      'user-1',
      'entry-1',
    );
  });

  it('passes analysis helpfulness feedback to the service', async () => {
    service.recordAnalysisFeedback.mockResolvedValue({ vote: 'helpful' });

    await controller.recordAnalysisFeedback('user-1', 'entry-1', {
      vote: 'helpful',
    });

    expect(service.recordAnalysisFeedback).toHaveBeenCalledWith(
      'user-1',
      'entry-1',
      { vote: 'helpful' },
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

function readGuardName(guard: unknown): string {
  if (typeof guard !== 'function') {
    return '';
  }

  return guard.name;
}
