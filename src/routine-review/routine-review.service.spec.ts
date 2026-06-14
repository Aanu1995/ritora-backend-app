import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApplicationItemStatus } from '../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import type {
  AnalysisObservations,
  ReactionReportPayload,
} from '../skin-journal/skin-journal.constants';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import type { User } from '../users/entities/user.entity';
import { RoutineReviewService } from './routine-review.service';

const repo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
});

type MockRepo = ReturnType<typeof repo>;

describe('RoutineReviewService', () => {
  let service: RoutineReviewService;
  let entries: MockRepo;
  let applications: MockRepo;
  let inventoryProducts: MockRepo;
  let skinProfiles: MockRepo;
  let simplifications: MockRepo;

  const user = { id: 'user-1', time_zone: 'UTC' } as User;
  const now = new Date('2026-06-13T10:00:00.000Z');

  beforeEach(async () => {
    entries = repo();
    applications = repo();
    inventoryProducts = repo();
    skinProfiles = repo();
    simplifications = repo();

    entries.find.mockResolvedValue([]);
    applications.find.mockResolvedValue([]);
    inventoryProducts.find.mockResolvedValue([]);
    skinProfiles.findOne.mockResolvedValue(null);
    simplifications.findOne.mockResolvedValue(null);

    const module = await Test.createTestingModule({
      providers: [
        RoutineReviewService,
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        { provide: getRepositoryToken(ApplicationLog), useValue: applications },
        {
          provide: getRepositoryToken(InventoryProduct),
          useValue: inventoryProducts,
        },
        { provide: getRepositoryToken(SkinProfile), useValue: skinProfiles },
        {
          provide: getRepositoryToken(RoutineSimplificationEvent),
          useValue: simplifications,
        },
      ],
    }).compile();

    service = module.get(RoutineReviewService);
  });

  it('returns seek help when recent journal analysis has a safety follow-up flag', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        analysis_observations: observations({
          should_flag_for_doctor: true,
          safety_flags: {
            urgent_review_recommended: false,
            doctor_follow_up_recommended: true,
            reasons: [],
          },
        }),
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('seek_professional_help');
    expect(result.riskLevel).toBe('urgent');
    expect(result.reasonCode).toBe('safety_follow_up');
    expect(result.signals.map((signal) => signal.code)).toContain(
      'doctor_follow_up_flag',
    );
  });

  it('returns recover when a reaction or barrier signal is visible', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        has_reaction_signal: true,
        analysis_observations: observations({
          reaction_signals: {
            reaction_detected: true,
            reaction_severity: 'moderate',
            indicators: ['redness'],
            confidence: 0.82,
          },
          barrier_signs: {
            barrier_compromise: true,
            indicators: ['dryness'],
          },
        }),
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('recover');
    expect(result.reasonCode).toBe('reaction_or_barrier');
    expect(result.actions.map((action) => action.code)).toEqual(
      expect.arrayContaining(['keep_routine_simple', 'pause_strong_actives']),
    );
  });

  it('returns recover when the user reports symptoms even without a photo reaction signal', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        reaction_report: reactionReport({
          symptoms: ['burning', 'stinging'],
          severity: 'moderate',
        }),
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('recover');
    expect(result.reasonCode).toBe('reaction_or_barrier');
    expect(result.evidence.userReactionReportCount).toBe(1);
    expect(result.signals.map((signal) => signal.code)).toContain(
      'user_reported_reaction',
    );
  });

  it('does not count malformed reaction reports without symptoms', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        reaction_report: reactionReport({
          symptoms: [],
          severity: 'mild',
        }),
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.evidence.userReactionReportCount).toBe(0);
    expect(result.signals.map((signal) => signal.code)).not.toContain(
      'user_reported_reaction',
    );
  });

  it('returns seek help when the user reports red-flag symptoms', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        reaction_report: reactionReport({
          symptoms: ['swelling'],
          severity: 'severe',
          red_flags: ['eye_or_lip_swelling'],
        }),
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('seek_professional_help');
    expect(result.riskLevel).toBe('urgent');
    expect(result.reasonCode).toBe('safety_follow_up');
    expect(result.evidence.userReactionRedFlagCount).toBe(1);
    expect(result.signals.map((signal) => signal.code)).toContain(
      'reaction_red_flags',
    );
  });

  it('returns pause when a recent routine change overlaps with worse check-ins', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        ratings: { breakouts: 4, redness: 2 },
        recent_change: { kind: 'started_new_product' },
      }),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('pause');
    expect(result.reasonCode).toBe('new_product_reaction');
    expect(result.evidence.recentNewProductCount).toBe(1);
    expect(result.evidence.highBreakoutEntryCount).toBe(1);
  });

  it('returns reduce when active-heavy logs overlap with discomfort', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', { ratings: { irritation: 4 } }),
    ]);
    applications.find.mockResolvedValue([
      activeLog('2026-06-11'),
      activeLog('2026-06-12'),
      activeLog('2026-06-13'),
    ]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('reduce');
    expect(result.reasonCode).toBe('active_overuse');
    expect(result.evidence.activeUseDayCount).toBe(3);
  });

  it('returns review SPF for pigment goals with rare sunscreen use', async () => {
    skinProfiles.findOne.mockResolvedValue({
      primary_goal: 'dark_marks',
      current_concerns: ['uneven_tone'],
      skin_behavior: { sunscreen_habit: 'rarely' },
    });

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('review_spf');
    expect(result.reasonCode).toBe('spf_gap');
    expect(result.evidence.lowSpfWithPigmentGoal).toBe(true);
  });

  it('returns continue when recent history is stable', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-12', { ratings: { redness: 2, breakouts: 1 } }),
      entry('2026-06-13', { ratings: { redness: 1, breakouts: 2 } }),
    ]);
    applications.find.mockResolvedValue([gentleLog('2026-06-12')]);

    const result = await service.getCurrentReview(user, 'UTC', now);

    expect(result.decision).toBe('continue');
    expect(result.reasonCode).toBe('stable_week');
    expect(result.signals.map((signal) => signal.code)).toContain(
      'calm_recent_entries',
    );
  });

  it('returns Swedish user-facing copy for Swedish users', async () => {
    entries.find.mockResolvedValue([
      entry('2026-06-13', {
        reaction_report: reactionReport({
          symptoms: ['burning'],
          severity: 'moderate',
        }),
      }),
    ]);

    const result = await service.getCurrentReview(
      { ...user, preferred_language: 'sv' } as User,
      'UTC',
      now,
    );

    expect(result.decision).toBe('recover');
    expect(result.title).toBe('Återhämta');
    expect(result.actions[0]?.label).toBe('Håll rutinen enkel');
    expect(result.signals.map((signal) => signal.label)).toContain(
      'Symtom du rapporterade',
    );
  });
});

function entry(
  entryDate: string,
  overrides: Partial<SkinJournalEntry> = {},
): SkinJournalEntry {
  return {
    id: `entry-${entryDate}`,
    user_id: 'user-1',
    entry_date: entryDate,
    time_zone: 'UTC',
    ratings: null,
    recent_change: null,
    reaction_report: null,
    analysis_observations: null,
    has_reaction_signal: false,
    ...overrides,
  } as SkinJournalEntry;
}

function activeLog(targetDate: string): ApplicationLog {
  return applicationLog(targetDate, ProductCategory.Treatment, 'Retinol');
}

function gentleLog(targetDate: string): ApplicationLog {
  return applicationLog(targetDate, ProductCategory.Cleanser, 'Cleanser');
}

function reactionReport(
  overrides: Partial<ReactionReportPayload> = {},
): ReactionReportPayload {
  return {
    symptoms: ['burning'],
    severity: 'mild',
    onset: 'today',
    locations: [],
    red_flags: [],
    suspected_trigger: null,
    note: null,
    ...overrides,
  };
}

function applicationLog(
  targetDate: string,
  category: ProductCategory,
  stepLabel: string,
): ApplicationLog {
  return {
    id: `log-${targetDate}`,
    user_id: 'user-1',
    target_date: targetDate,
    items: [
      {
        status: ApplicationItemStatus.Applied,
        step_label: stepLabel,
        product: {
          id: `product-${targetDate}`,
          status: ShelfStatus.Active,
          category,
          name: stepLabel,
          brand: 'Test',
          identity: {
            category,
            name: stepLabel,
            description: null,
            benefits: [],
            inciIngredients: [],
          },
          guidance: { cautions: [] },
        },
      },
    ],
  } as unknown as ApplicationLog;
}

function observations(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  const base: AnalysisObservations = {
    schema_version: '1.3',
    model_version: 'test',
    image_quality: {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      issues: [],
    },
    detected_concerns: [],
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0.2,
    },
    barrier_signs: {
      barrier_compromise: false,
      indicators: [],
    },
    overall_assessment: 'Stable test entry.',
    should_flag_for_doctor: false,
  };

  return {
    ...base,
    ...overrides,
    image_quality: {
      ...base.image_quality,
      ...overrides.image_quality,
    },
    reaction_signals: {
      ...base.reaction_signals,
      ...overrides.reaction_signals,
    },
    barrier_signs: {
      ...base.barrier_signs,
      ...overrides.barrier_signs,
    },
  };
}
