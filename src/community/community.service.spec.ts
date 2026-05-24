import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  DataSource,
  DeleteResult,
  Repository,
  UpdateResult,
} from 'typeorm';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { SkinProfileSexAtBirth } from '../skin-profile/dto/skin-profile.constants';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import {
  DataProvenance,
  ProductCategory,
  ShelfStatus,
} from '../shelf/shelf.types';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserConsentType } from '../users/user-consent.constants';
import { CommunityAiModerationService } from './community-ai-moderation.service';
import { CommunitySafetyService } from './community-safety.service';
import { CommunityService } from './community.service';
import {
  CommunityContentType,
  CommunityDisclosureType,
  CommunityGoalResult,
  CommunityGoalTimeframe,
  CommunityModerationStatus,
  CommunityOutcomeFollowedPart,
  CommunityOutcomeIrritationLevel,
  CommunityOutcomeSignal,
  CommunityOutcomeTrialDuration,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
} from './community.types';
import { CommunityHelpfulnessVoteEntity } from './entities/community-helpfulness-vote.entity';
import { CommunityModerationDecision } from './entities/community-moderation-decision.entity';
import { CommunityOutcomeSignalVote } from './entities/community-outcome-signal-vote.entity';
import { CommunityProfile } from './entities/community-profile.entity';
import { CommunityReport } from './entities/community-report.entity';
import { CommunityReviewContextProduct } from './entities/community-review-context-product.entity';
import { CommunityReview } from './entities/community-review.entity';
import { CommunityRoutineAdaptation } from './entities/community-routine-adaptation.entity';
import { CommunityRoutineStep } from './entities/community-routine-step.entity';
import { CommunityRoutine } from './entities/community-routine.entity';
import { CommunitySafetyScanResult } from './entities/community-safety-scan-result.entity';
import {
  COMMUNITY_SETTINGS_ID,
  CommunitySettings,
} from './entities/community-settings.entity';
import { CommunityWarning } from './entities/community-warning.entity';

type MockRepository<T extends object> = {
  count: jest.Mock<Promise<number>, [unknown?]>;
  create: jest.Mock<T, [Partial<T>]>;
  delete: jest.Mock<Promise<DeleteResult>, [unknown]>;
  find: jest.Mock<Promise<T[]>, [unknown?]>;
  findOne: jest.Mock<Promise<T | null>, [unknown?]>;
  save: jest.Mock<Promise<T>, [T]>;
  update: jest.Mock<Promise<UpdateResult>, [unknown, Partial<T>]>;
};

type DataSourceMock = DataSource & {
  query: jest.Mock<
    Promise<Array<{ count: number | string }>>,
    [string, unknown[]]
  >;
  transaction: jest.Mock<
    Promise<unknown>,
    [(manager: Pick<DataSource['manager'], 'getRepository'>) => Promise<unknown>]
  >;
};

type CommunityRepositories = {
  profiles: Repository<CommunityProfile> & MockRepository<CommunityProfile>;
  routines: Repository<CommunityRoutine> & MockRepository<CommunityRoutine>;
  routineSteps: Repository<CommunityRoutineStep> &
    MockRepository<CommunityRoutineStep>;
  reviews: Repository<CommunityReview> & MockRepository<CommunityReview>;
  reviewContext: Repository<CommunityReviewContextProduct> &
    MockRepository<CommunityReviewContextProduct>;
  reports: Repository<CommunityReport> & MockRepository<CommunityReport>;
  decisions: Repository<CommunityModerationDecision> &
    MockRepository<CommunityModerationDecision>;
  votes: Repository<CommunityHelpfulnessVoteEntity> &
    MockRepository<CommunityHelpfulnessVoteEntity>;
  outcomeVotes: Repository<CommunityOutcomeSignalVote> &
    MockRepository<CommunityOutcomeSignalVote>;
  adaptations: Repository<CommunityRoutineAdaptation> &
    MockRepository<CommunityRoutineAdaptation>;
  safetyScans: Repository<CommunitySafetyScanResult> &
    MockRepository<CommunitySafetyScanResult>;
  communitySettings: Repository<CommunitySettings> &
    MockRepository<CommunitySettings>;
  warnings: Repository<CommunityWarning> & MockRepository<CommunityWarning>;
  auditLogs: Repository<AdminAuditLog> & MockRepository<AdminAuditLog>;
  notifications: Repository<InAppNotification> &
    MockRepository<InAppNotification>;
  skinProfiles: Repository<SkinProfile> & MockRepository<SkinProfile>;
  inventory: Repository<InventoryProduct> & MockRepository<InventoryProduct>;
  users: Repository<User> & MockRepository<User>;
  consents: Repository<UserConsent> & MockRepository<UserConsent>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function repositoryMock<T extends object>(): Repository<T> & MockRepository<T> {
  const mock: MockRepository<T> = {
    count: jest.fn<Promise<number>, [unknown?]>().mockResolvedValue(0),
    create: jest
      .fn<T, [Partial<T>]>()
      .mockImplementation((value) => value as T),
    delete: jest
      .fn<Promise<DeleteResult>, [unknown]>()
      .mockResolvedValue({ affected: 1, raw: [] }),
    find: jest.fn<Promise<T[]>, [unknown?]>().mockResolvedValue([]),
    findOne: jest.fn<Promise<T | null>, [unknown?]>().mockResolvedValue(null),
    save: jest.fn<Promise<T>, [T]>().mockImplementation(async (value) => value),
    update: jest
      .fn<Promise<UpdateResult>, [unknown, Partial<T>]>()
      .mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] }),
  };

  return mock as unknown as Repository<T> & MockRepository<T>;
}

function createService() {
  const repositories: CommunityRepositories = {
    profiles: repositoryMock<CommunityProfile>(),
    routines: repositoryMock<CommunityRoutine>(),
    routineSteps: repositoryMock<CommunityRoutineStep>(),
    reviews: repositoryMock<CommunityReview>(),
    reviewContext: repositoryMock<CommunityReviewContextProduct>(),
    reports: repositoryMock<CommunityReport>(),
    decisions: repositoryMock<CommunityModerationDecision>(),
    votes: repositoryMock<CommunityHelpfulnessVoteEntity>(),
    outcomeVotes: repositoryMock<CommunityOutcomeSignalVote>(),
    adaptations: repositoryMock<CommunityRoutineAdaptation>(),
    safetyScans: repositoryMock<CommunitySafetyScanResult>(),
    communitySettings: repositoryMock<CommunitySettings>(),
    warnings: repositoryMock<CommunityWarning>(),
    auditLogs: repositoryMock<AdminAuditLog>(),
    notifications: repositoryMock<InAppNotification>(),
    skinProfiles: repositoryMock<SkinProfile>(),
    inventory: repositoryMock<InventoryProduct>(),
    users: repositoryMock<User>(),
    consents: repositoryMock<UserConsent>(),
  };
  const transactionManager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === CommunityRoutine) return repositories.routines;
      if (entity === CommunityRoutineStep) return repositories.routineSteps;
      if (entity === CommunityReview) return repositories.reviews;
      if (entity === CommunityReviewContextProduct)
        return repositories.reviewContext;
      if (entity === CommunityModerationDecision) return repositories.decisions;
      if (entity === CommunitySafetyScanResult) return repositories.safetyScans;
      throw new Error('Unexpected transaction repository');
    }),
  };
  const dataSource = {
    query: jest
      .fn<Promise<Array<{ count: number | string }>>, [string, unknown[]]>()
      .mockResolvedValue([{ count: 0 }]),
    transaction: jest.fn(async (operation) =>
      operation(transactionManager as Pick<DataSource['manager'], 'getRepository'>),
    ),
  } as DataSourceMock;
  const safety = {
    resolveStatus: jest.fn(),
    scanRoutine: jest.fn().mockReturnValue([]),
    scanText: jest.fn().mockReturnValue([]),
  } as unknown as CommunitySafetyService;
  const aiModeration = {
    triage: jest.fn().mockResolvedValue({
      automation: { action: 'publish', handledBy: 'ai', reason: 'low risk' },
      status: CommunityModerationStatus.Published,
    }),
  } as unknown as CommunityAiModerationService;

  const service = new CommunityService(
    dataSource,
    safety,
    aiModeration,
    repositories.profiles,
    repositories.routines,
    repositories.routineSteps,
    repositories.reviews,
    repositories.reviewContext,
    repositories.reports,
    repositories.decisions,
    repositories.votes,
    repositories.outcomeVotes,
    repositories.adaptations,
    repositories.safetyScans,
    repositories.communitySettings,
    repositories.warnings,
    repositories.auditLogs,
    repositories.notifications,
    repositories.skinProfiles,
    repositories.inventory,
    repositories.users,
    repositories.consents,
  );

  return { aiModeration, dataSource, repositories, safety, service };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: 'user_community_1',
    email: 'member@example.com',
    canonical_email: 'member@example.com',
    password_hash: null,
    google_subject: null,
    apple_subject: null,
    first_name: 'Ritora',
    last_name: 'Member',
    email_verified: true,
    email_verification_token_hash: null,
    email_verification_expires: null,
    password_reset_token_hash: null,
    password_reset_expires: null,
    account_deletion_requested_at: null,
    account_deletion_scheduled_for: null,
    account_deletion_cancel_token_hash: null,
    account_deletion_cancel_token_consumed_at: null,
    account_deletion_confirm_token_hash: null,
    account_deletion_confirm_expires: null,
    account_restricted_at: null,
    account_restriction_reason: null,
    account_restricted_by_admin_id: null,
    account_restriction_capabilities: null,
    account_restriction_expires_at: null,
    account_restriction_internal_note: null,
    account_restriction_user_message: null,
    preferred_language: 'en',
    time_zone: 'Europe/Stockholm',
    date_of_birth: '1990-01-01',
    sex_at_birth: SkinProfileSexAtBirth.Female,
    created_at: daysAgo(10),
    updated_at: new Date(),
    consents: [],
    data_access_logs: [],
    generateId: jest.fn(),
    ...overrides,
  };
}

function completeSkinProfile(user: User): SkinProfile {
  return {
    id: 'skin_profile_1',
    user_id: user.id,
    skin_type: 'combination',
    skin_tone: 'medium',
    ethnicity: 'black',
    current_concerns: ['acne'],
    country_code: 'SE',
    city: 'Stockholm',
    fitzpatrick_phototype: 'V',
    sensitivity_level: 'moderate',
    hydration_level: 'dehydrated',
    primary_goal: 'clearer_skin',
    pregnancy_status: null,
    under_dermatologist_care: null,
    allow_smart_picks: true,
    budget_tier: 'mid',
    safety_context: {},
    reaction_history: {},
    concern_details: {
      per_concern: [{ concern: 'acne', severity: 'moderate' }],
    },
    skin_behavior: {
      pih_tendency: 'often',
      melasma_tendency: 'sometimes',
      keloid_tendency: 'never',
      sunscreen_habit: 'every_day',
      sunscreen_tolerance: 'fine',
    },
    active_tolerances: {},
    routine_preferences: {
      pace: 'cautious',
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'mineral',
      sunscreen_finish: 'matte',
    },
    lifestyle_context: {
      water_hardness: 'soft',
      water_sensitivity: 'none',
    },
    shopping_preferences: {},
    hormonal_context: {},
    created_at: new Date(),
    updated_at: new Date(),
    user,
    generateId: jest.fn(),
  };
}

function consentFixture(userId: string): UserConsent {
  return {
    id: 'community_consent_1',
    user_id: userId,
    consent_type: UserConsentType.CommunityGuidelines,
    consent_version: '1.0.0',
    granted: true,
    granted_at: new Date(),
    revoked_at: null,
    ip_address: null,
    created_at: new Date(),
    user: userFixture({ id: userId }),
    generateId: jest.fn(),
  };
}

function settingsFixture(minimumAccountAgeDays: number): CommunitySettings {
  return {
    id: COMMUNITY_SETTINGS_ID,
    minimum_account_age_days: minimumAccountAgeDays,
    updated_by_admin_id: 'admin_1',
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function inventoryProductFixture(
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
  return {
    id: 'product_1',
    user_id: 'user_community_1',
    brand: 'Ritora',
    name: 'Barrier Cream',
    category: ProductCategory.Moisturizer,
    barcode: null,
    status: ShelfStatus.Active,
    provenance: DataProvenance.PhotoLookup,
    brand_search: 'ritora',
    name_search: 'barrier cream',
    search_document: 'ritora barrier cream moisturizer',
    opened_at: null,
    expires_at: null,
    period_after_opening_months: null,
    effective_expires_at: null,
    identity: {
      brand: 'Ritora',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      barcode: null,
      imageUrls: [],
      sizeMl: 50,
      description: null,
      benefits: [],
      suitedFor: [],
      inciIngredients: [],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'Ritora',
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    user_fields: {
      openedAt: null,
      expiresAt: null,
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
    created_at: new Date(),
    updated_at: new Date(),
    user: userFixture(),
    generateId: jest.fn(),
    ...overrides,
  };
}

describe('CommunityService posting eligibility', () => {
  it('returns every blocking reason for a new incomplete account', async () => {
    const { repositories, service } = createService();
    const user = userFixture({
      created_at: new Date(Date.now() - DAY_MS / 2),
      date_of_birth: null,
      email_verified: false,
      sex_at_birth: null,
    });
    repositories.users.findOne.mockResolvedValue(user);
    repositories.inventory.count.mockResolvedValue(0);

    const result = await service.getPostingEligibility(user.id);

    expect(result).toMatchObject({
      eligible: false,
      minimumAccountAgeDays: 3,
      accountAgeDays: 0,
      hasAcceptedGuidelines: false,
      hasCompletedSkinProfile: false,
      hasShelfProduct: false,
      emailVerified: false,
    });
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      'email_unverified',
      'skin_profile_required',
      'shelf_product_required',
      'community_guidelines_required',
      'account_too_new',
    ]);
  });

  it('allows posting when the account satisfies all launch requirements', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture({ created_at: daysAgo(10) });
    repositories.users.findOne.mockResolvedValue(user);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );
    repositories.inventory.count.mockResolvedValue(2);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));
    repositories.communitySettings.findOne.mockResolvedValue(
      settingsFixture(7),
    );
    dataSource.query.mockResolvedValue([{ count: '0' }]);

    const result = await service.getPostingEligibility(user.id);

    expect(result).toMatchObject({
      eligible: true,
      minimumAccountAgeDays: 7,
      hasAcceptedGuidelines: true,
      hasCompletedSkinProfile: true,
      hasShelfProduct: true,
      emailVerified: true,
      reasons: [],
    });
  });

  it('records guideline consent once and recomputes eligibility', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const savedConsent = consentFixture(user.id);
    repositories.users.findOne.mockResolvedValue(user);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );
    repositories.inventory.count.mockResolvedValue(1);
    repositories.consents.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(savedConsent);

    const result = await service.acceptCommunityGuidelines(
      user.id,
      '127.0.0.1',
    );

    expect(repositories.consents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        consent_type: UserConsentType.CommunityGuidelines,
        consent_version: '1.0.0',
        granted: true,
        ip_address: '127.0.0.1',
        revoked_at: null,
        user_id: user.id,
      }),
    );
    expect(repositories.consents.save).toHaveBeenCalledTimes(1);
    expect(result.eligible).toBe(true);
    expect(result.hasAcceptedGuidelines).toBe(true);
  });

  it('throws when eligibility is requested for an unknown user', async () => {
    const { service } = createService();

    await expect(service.getPostingEligibility('missing_user')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('CommunityService review evidence', () => {
  it('rejects reviews that only provide a generic context category', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    repositories.users.findOne.mockResolvedValue(user);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );
    repositories.inventory.count.mockResolvedValue(1);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));

    await expect(
      service.createReview(user.id, {
        productBrand: 'Ritora',
        productName: 'Barrier Cream',
        productCategory: 'moisturizer',
        disclosureType: CommunityDisclosureType.Ordinary,
        usageDuration: '8-weeks',
        frequency: 'daily',
        routineSlot: CommunityReviewRoutineSlot.PM,
        skinResponse: CommunityReviewSkinResponse.Improved,
        overallRating: 5,
        effectivenessRating: 4,
        irritationRating: 1,
        outcomes: ['barrier-support'],
        repurchase: 'yes',
        routineContext: [{ category: 'cleanser' }],
        body: 'It helped only when the rest of my routine stayed simple.',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CommunityService content integrity policy', () => {
  it('returns structured editable snapshots for author submissions', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const now = new Date();
    const routine = {
      id: 'routine_needs_edit',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      title: 'Barrier reset playbook',
      summary: 'Kept the routine simple while my skin calmed down.',
      concern_tags: ['acne'],
      goal_tags: ['acne'],
      goal_result: CommunityGoalResult.MostlyImproved,
      timeframe: CommunityGoalTimeframe.EightWeeks,
      avoid_tags: ['late-night-food'],
      habit_tags: ['consistent-sleep'],
      did_not_work_tags: ['daily-acids'],
      warning_tags: ['patch-test-first'],
      disclosure_type: CommunityDisclosureType.Ordinary,
      moderation_status: CommunityModerationStatus.NeedsEdit,
      assigned_admin_id: null,
      safety_flags: [],
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: now,
      updated_at: now,
    } as unknown as CommunityRoutine;
    const review = {
      id: 'review_pending',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      product_id: 'product_review_1',
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: 'moisturizer',
      disclosure_type: CommunityDisclosureType.Ordinary,
      usage_duration: '8-weeks',
      frequency: 'daily',
      routine_slot: CommunityReviewRoutineSlot.PM,
      skin_response: CommunityReviewSkinResponse.Improved,
      overall_rating: 5,
      effectiveness_rating: 4,
      irritation_rating: 1,
      texture_rating: null,
      value_rating: null,
      outcomes: ['less stinging'],
      repurchase: 'yes',
      body: 'It worked best with a gentle cleanser.',
      moderation_status: CommunityModerationStatus.PendingReview,
      assigned_admin_id: null,
      safety_flags: [],
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: now,
      updated_at: now,
    } as unknown as CommunityReview;
    const step = {
      id: 'step_1',
      routine_id: routine.id,
      product_id: 'product_step_1',
      product_brand: 'Ritora',
      product_name: 'Milky Cleanser',
      category: 'cleanser',
      step_order: 1,
      slot: 'pm',
      frequency: 'daily',
      notes: 'Used before moisturizer.',
    } as CommunityRoutineStep;
    const contextProduct = {
      id: 'context_1',
      review_id: review.id,
      product_id: 'product_context_1',
      product_brand: 'Ritora',
      product_name: 'Milky Cleanser',
      category: 'cleanser',
    } as CommunityReviewContextProduct;

    repositories.routines.find.mockResolvedValue([routine]);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.routineSteps.find.mockResolvedValue([step]);
    repositories.reviewContext.find.mockResolvedValue([contextProduct]);

    const result = await service.listMySubmissions(user.id);
    const routineItem = result.items.find((item) => item.id === routine.id);
    const reviewItem = result.items.find((item) => item.id === review.id);

    expect(routineItem).toMatchObject({
      editableRoutine: {
        title: routine.title,
        summary: routine.summary,
        disclosureType: routine.disclosure_type,
        concernTags: routine.concern_tags,
        goalTags: routine.goal_tags,
        goalResult: routine.goal_result,
        timeframe: routine.timeframe,
        avoidTags: routine.avoid_tags,
        habitTags: routine.habit_tags,
        didNotWorkTags: routine.did_not_work_tags,
        warningTags: routine.warning_tags,
        steps: [
          {
            productId: step.product_id,
            productBrand: step.product_brand,
            productName: step.product_name,
            category: step.category,
            slot: step.slot,
            frequency: step.frequency,
            notes: step.notes,
          },
        ],
      },
    });
    expect(reviewItem).toMatchObject({
      editableReview: {
        productId: review.product_id,
        productBrand: review.product_brand,
        productName: review.product_name,
        productCategory: review.product_category,
        disclosureType: review.disclosure_type,
        usageDuration: review.usage_duration,
        frequency: review.frequency,
        routineSlot: review.routine_slot,
        skinResponse: review.skin_response,
        overallRating: review.overall_rating,
        effectivenessRating: review.effectiveness_rating,
        irritationRating: review.irritation_rating,
        textureRating: review.texture_rating,
        valueRating: review.value_rating,
        outcomes: review.outcomes,
        repurchase: review.repurchase,
        routineContext: [
          {
            productId: contextProduct.product_id,
            productBrand: contextProduct.product_brand,
            productName: contextProduct.product_name,
            category: contextProduct.category,
          },
        ],
        body: review.body,
      },
    });
  });

  it('allows pending review edits but rejects edits after publication', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const pendingReview = {
      id: 'review_pending',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      product_id: null,
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: 'moisturizer',
      disclosure_type: CommunityDisclosureType.Ordinary,
      usage_duration: '8-weeks',
      frequency: 'daily',
      routine_slot: CommunityReviewRoutineSlot.PM,
      skin_response: CommunityReviewSkinResponse.Improved,
      overall_rating: 5,
      effectiveness_rating: 4,
      irritation_rating: 1,
      texture_rating: null,
      value_rating: null,
      outcomes: ['barrier-support'],
      repurchase: 'yes',
      body: 'Original careful wording.',
      moderation_status: CommunityModerationStatus.PendingReview,
      assigned_admin_id: null,
      safe_facets: {
        skinType: 'combination',
        concernTags: ['acne'],
        sensitivityLevel: null,
        skinToneRange: 'medium',
        climateBucket: null,
        routinePace: 'cautious',
        goalTags: ['acne'],
      },
      safety_flags: [],
      helpful_count: 0,
      not_helpful_count: 0,
      outcome_signal_counts: {},
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: new Date(),
      generateId: jest.fn(),
      updated_at: new Date(),
    } as CommunityReview;

    repositories.reviews.findOne.mockResolvedValueOnce(pendingReview);
    repositories.users.findOne.mockResolvedValue(user);
    repositories.inventory.count.mockResolvedValue(1);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    await expect(
      service.updateReview(user.id, pendingReview.id, {
        body: 'Safer wording before publication.',
      }),
    ).resolves.toMatchObject({
      id: pendingReview.id,
      body: 'Safer wording before publication.',
    });

    repositories.reviews.findOne.mockResolvedValueOnce({
      ...pendingReview,
      id: 'review_published',
      helpful_count: 3,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 2,
      },
    } as CommunityReview);

    await expect(
      service.updateReview(user.id, 'review_published', {
        body: 'Changed after people rated it.',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('withdraws owned content without hard-deleting audit history', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const routine = {
      id: 'routine_published',
      author_user_id: user.id,
      moderation_status: CommunityModerationStatus.Published,
      assigned_admin_id: 'admin_1',
      disclosure_type: CommunityDisclosureType.Ordinary,
      safety_flags: [],
      helpful_count: 4,
      not_helpful_count: 1,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 3,
      },
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as CommunityRoutine;

    repositories.routines.findOne.mockResolvedValueOnce(routine);

    await expect(
      service.withdrawContent(user.id, routine.id),
    ).resolves.toEqual({ deleted: true });

    expect(routine.moderation_status).toBe(CommunityModerationStatus.Hidden);
    expect(routine.assigned_admin_id).toBeNull();
    expect(routine.withdrawn_at).toBeInstanceOf(Date);
    expect(routine.withdrawn_by_user_id).toBe(user.id);
    expect(repositories.routines.save).toHaveBeenCalledWith(routine);
    expect(repositories.decisions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_admin_id: null,
        content_id: routine.id,
        content_type: CommunityContentType.Routine,
        from_status: CommunityModerationStatus.Published,
        to_status: CommunityModerationStatus.Hidden,
      }),
    );
    expect(repositories.routines.delete).not.toHaveBeenCalled();
  });

  it('does not expose withdrawn content to the author as readable content', async () => {
    const { repositories, service } = createService();
    const user = userFixture();

    repositories.routines.findOne.mockResolvedValueOnce({
      id: 'routine_withdrawn',
      author_user_id: user.id,
      moderation_status: CommunityModerationStatus.Hidden,
      withdrawn_at: new Date(),
    } as unknown as CommunityRoutine);

    await expect(
      service.getRoutine(user.id, 'routine_withdrawn'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('CommunityService product evidence aggregation', () => {
  it('aggregates reviews, playbooks and similar-user confirmations for a shelf product', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const viewerProfile = completeSkinProfile(user);
    const similarFacets = {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: null,
      skinToneRange: 'medium',
      climateBucket: null,
      routinePace: 'cautious',
      goalTags: ['acne'],
    };
    const differentFacets = {
      skinType: 'dry',
      concernTags: ['dryness'],
      sensitivityLevel: null,
      skinToneRange: 'fair',
      climateBucket: null,
      routinePace: 'minimal',
      goalTags: ['dryness'],
    };
    const review = {
      id: 'review_1',
      product_id: 'product_1',
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: 'moisturizer',
      overall_rating: 5,
      effectiveness_rating: 4,
      irritation_rating: 1,
      skin_response: CommunityReviewSkinResponse.Improved,
      outcomes: ['barrier-support'],
      disclosure_type: CommunityDisclosureType.Ordinary,
      safe_facets: similarFacets,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 2,
      },
      moderation_status: CommunityModerationStatus.Published,
      created_at: new Date(),
      updated_at: new Date(),
    } as CommunityReview;
    const routine = {
      id: 'routine_1',
      title: 'Barrier repair without actives',
      disclosure_type: CommunityDisclosureType.Ordinary,
      concern_tags: ['barrier'],
      goal_tags: ['barrier-repair'],
      goal_result: 'mostly_improved',
      timeframe: '8-weeks',
      avoid_tags: ['over-exfoliation'],
      habit_tags: ['consistent-sleep'],
      did_not_work_tags: ['daily-acids'],
      warning_tags: ['patch-test-first'],
      safe_facets: similarFacets,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedWithChanges]: 1,
        [CommunityOutcomeSignal.DidNotWork]: 1,
      },
      created_at: new Date(),
      updated_at: new Date(),
    } as CommunityRoutine;
    const routineStep = {
      id: 'step_1',
      routine_id: routine.id,
      product_id: 'product_1',
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      category: 'moisturizer',
      step_order: 1,
      slot: 'pm',
      frequency: 'daily',
      notes: null,
    } as CommunityRoutineStep;
    const similarVote = {
      id: 'vote_1',
      user_id: 'similar_user',
      content_type: CommunityContentType.Routine,
      content_id: routine.id,
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      context: {
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.None,
      },
      safe_facets: similarFacets,
      created_at: new Date(),
      updated_at: new Date(),
      generateId: jest.fn(),
    } as CommunityOutcomeSignalVote;
    const differentVote = {
      ...similarVote,
      id: 'vote_2',
      user_id: 'different_user',
      signal: CommunityOutcomeSignal.DidNotWork,
      safe_facets: differentFacets,
    } as CommunityOutcomeSignalVote;

    repositories.inventory.findOne.mockResolvedValue(
      inventoryProductFixture({ id: 'product_1', user_id: user.id }),
    );
    repositories.skinProfiles.findOne.mockResolvedValue(viewerProfile);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.routineSteps.find.mockResolvedValue([routineStep]);
    repositories.routines.find.mockResolvedValue([routine]);
    repositories.outcomeVotes.find.mockResolvedValue([similarVote, differentVote]);

    const result = await service.getProductEvidence(user.id, 'product_1');

    expect(result).toMatchObject({
      productId: 'product_1',
      reviewCount: 1,
      playbookCount: 1,
      similarAuthorEvidenceCount: 2,
      similarOutcomeConfirmationCount: 1,
      averageOverallRating: 5,
      averageEffectivenessRating: 4,
      averageIrritationRating: 1,
    });
    expect(result.outcomeSignalCounts.worked_for_me_too).toBe(2);
    expect(result.outcomeSignalCounts.worked_with_changes).toBe(1);
    expect(result.outcomeSignalCounts.did_not_work).toBe(1);
    expect(result.similarOutcomeSignalCounts.worked_for_me_too).toBe(1);
    expect(result.topGoals).toEqual([
      { value: 'barrier-repair', count: 1 },
    ]);
    expect(result.topAvoids).toEqual([
      { value: 'over-exfoliation', count: 1 },
    ]);
  });

  it('stores privacy-safe viewer context when confirming an outcome', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const routine = {
      id: 'routine_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
    } as CommunityRoutine;

    repositories.routines.findOne.mockResolvedValue(routine);
    repositories.skinProfiles.findOne.mockResolvedValue(completeSkinProfile(user));

    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { signal: CommunityOutcomeSignal.WorkedForMeToo, count: '1' },
      ]),
    };
    repositories.outcomeVotes.createQueryBuilder = jest
      .fn()
      .mockReturnValue(outcomeQueryBuilder);

    const result = await service.signalRoutineOutcome(user.id, routine.id, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"context"'),
      expect.arrayContaining([
        user.id,
        CommunityContentType.Routine,
        routine.id,
        CommunityOutcomeSignal.WorkedForMeToo,
        expect.objectContaining({
          sameGoal: true,
          trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
          followedParts: [CommunityOutcomeFollowedPart.Products],
          irritationLevel: CommunityOutcomeIrritationLevel.None,
        }),
        expect.objectContaining({
          skinType: 'combination',
          concernTags: ['acne'],
        }),
      ]),
    );
    expect(result.outcomeSignalCounts.worked_for_me_too).toBe(1);
  });
});
