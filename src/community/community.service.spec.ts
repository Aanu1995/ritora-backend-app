import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  DataSource,
  DeleteResult,
  Repository,
  SelectQueryBuilder,
  UpdateResult,
} from 'typeorm';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from '../admin/entities/admin-account.entity';
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
import { decodeCursor, encodeCursor } from '../common/utils/cursor-pagination';
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
  CommunityReviewRoutineContextUsage,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
  CommunitySafetySeverity,
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
  createQueryBuilder: jest.Mock<SelectQueryBuilder<T>, [string?]>;
  delete: jest.Mock<Promise<DeleteResult>, [unknown]>;
  find: jest.Mock<Promise<T[]>, [unknown?]>;
  findOne: jest.Mock<Promise<T | null>, [unknown?]>;
  save: jest.Mock<Promise<T>, [T]>;
  update: jest.Mock<Promise<UpdateResult>, [unknown, Partial<T>]>;
};

type DataSourceQueryRow = {
  content_kind?: string;
  count?: number | string;
  id?: string;
  match_score?: number | string;
  updated_at?: Date | string;
};

type DataSourceMock = DataSource & {
  query: jest.Mock<Promise<DataSourceQueryRow[]>, [string, unknown[]]>;
  transaction: jest.Mock<
    Promise<unknown>,
    [
      (
        manager: Pick<DataSource['manager'], 'getRepository'>,
      ) => Promise<unknown>,
    ]
  >;
};

type CommunityRepositories = {
  adminAccounts: Repository<AdminAccount> & MockRepository<AdminAccount>;
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
    createQueryBuilder: jest
      .fn<SelectQueryBuilder<T>, [string?]>()
      .mockImplementation(() => {
        throw new Error('Unexpected query builder usage');
      }),
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
    adminAccounts: repositoryMock<AdminAccount>(),
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
      if (entity === CommunityOutcomeSignalVote)
        return repositories.outcomeVotes;
      if (entity === CommunityModerationDecision) return repositories.decisions;
      if (entity === CommunitySafetyScanResult) return repositories.safetyScans;
      throw new Error('Unexpected transaction repository');
    }),
  };
  const dataSource = {
    query: jest
      .fn<Promise<DataSourceQueryRow[]>, [string, unknown[]]>()
      .mockResolvedValue([{ count: 0 }]),
    transaction: jest.fn(async (operation) =>
      operation(
        transactionManager as Pick<DataSource['manager'], 'getRepository'>,
      ),
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
    repositories.adminAccounts,
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

function communityReviewFixture(
  overrides: Partial<CommunityReview> = {},
): CommunityReview {
  const now = new Date('2026-05-20T10:00:00.000Z');
  return {
    id: 'review_1',
    author_user_id: 'review_author',
    community_profile_id: 'community_profile_1',
    product_id: 'product_1',
    product_brand: 'Ritora',
    product_name: 'Barrier Cream',
    product_category: ProductCategory.Moisturizer,
    disclosure_type: CommunityDisclosureType.Ordinary,
    usage_duration: '8-weeks',
    frequency: 'daily',
    routine_context_usage: CommunityReviewRoutineContextUsage.UsedAlone,
    routine_slot: CommunityReviewRoutineSlot.PM,
    skin_response: CommunityReviewSkinResponse.Improved,
    overall_rating: 5,
    effectiveness_rating: 4,
    irritation_rating: 1,
    texture_rating: null,
    value_rating: null,
    outcomes: ['barrier-support'],
    repurchase: 'yes',
    body: 'This helped my barrier.',
    moderation_status: CommunityModerationStatus.Published,
    assigned_admin_id: null,
    safe_facets: {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: 'moderate',
      skinToneRange: 'medium',
      climateBucket: 'temperate',
      routinePace: 'cautious',
      goalTags: ['clearer_skin'],
    },
    safety_flags: [],
    helpful_count: 0,
    not_helpful_count: 0,
    outcome_signal_counts: {},
    withdrawn_at: null,
    withdrawn_by_user_id: null,
    created_at: now,
    updated_at: now,
    generateId: jest.fn(),
    ...overrides,
  };
}

function communityRoutineFixture(
  overrides: Partial<CommunityRoutine> = {},
): CommunityRoutine {
  const now = new Date('2026-05-20T10:00:00.000Z');
  return {
    id: 'routine_1',
    author_user_id: 'routine_author',
    community_profile_id: 'community_profile_1',
    title: 'Barrier reset playbook',
    summary: 'Simple routine that helped.',
    concern_tags: ['acne'],
    goal_tags: ['clearer_skin'],
    goal_result: CommunityGoalResult.MostlyImproved,
    timeframe: CommunityGoalTimeframe.EightWeeks,
    avoid_tags: ['late-night-food'],
    habit_tags: ['consistent-sleep'],
    did_not_work_tags: ['daily-acids'],
    warning_tags: ['patch-test-first'],
    disclosure_type: CommunityDisclosureType.Ordinary,
    moderation_status: CommunityModerationStatus.Published,
    assigned_admin_id: null,
    safe_facets: {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: 'moderate',
      skinToneRange: 'medium',
      climateBucket: 'temperate',
      routinePace: 'cautious',
      goalTags: ['clearer_skin'],
    },
    safety_flags: [],
    helpful_count: 0,
    not_helpful_count: 0,
    outcome_signal_counts: {},
    withdrawn_at: null,
    withdrawn_by_user_id: null,
    created_at: now,
    updated_at: now,
    generateId: jest.fn(),
    ...overrides,
  };
}

function communityOutcomeVoteFixture({
  contentId,
  contentType,
  createdAt,
  id,
  signal,
}: {
  contentId: string;
  contentType: CommunityContentType;
  createdAt: Date;
  id: string;
  signal: CommunityOutcomeSignal;
}): CommunityOutcomeSignalVote {
  return {
    id,
    user_id: `${id}_user`,
    content_type: contentType,
    content_id: contentId,
    signal,
    context: {
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
      routineSlot: CommunityReviewRoutineSlot.PM,
      usedWithProducts: [],
    },
    safe_facets: {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: 'moderate',
      skinToneRange: 'medium',
      climateBucket: null,
      routinePace: 'cautious',
      goalTags: ['clearer_skin'],
    },
    note: `${id} note`,
    note_moderation_status: CommunityModerationStatus.Published,
    note_safety_flags: [],
    note_moderation_reason: 'AI moderation publish: low risk',
    withdrawn_at: null,
    withdrawn_by_user_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    generateId: jest.fn(),
  };
}

type QueryBuilderMock<T extends object> = {
  where: jest.Mock<QueryBuilderMock<T>, [string, Record<string, unknown>?]>;
  andWhere: jest.Mock<QueryBuilderMock<T>, [unknown, Record<string, unknown>?]>;
  orderBy: jest.Mock<QueryBuilderMock<T>, [string, 'ASC' | 'DESC']>;
  addOrderBy: jest.Mock<QueryBuilderMock<T>, [string, 'ASC' | 'DESC']>;
  take: jest.Mock<QueryBuilderMock<T>, [number]>;
  getMany: jest.Mock<Promise<T[]>, []>;
};

function queryBuilderMock<T extends object>(rows: T[]): QueryBuilderMock<T> {
  const builder = {} as QueryBuilderMock<T>;
  builder.where = jest
    .fn<QueryBuilderMock<T>, [string, Record<string, unknown>?]>()
    .mockReturnValue(builder);
  builder.andWhere = jest
    .fn<QueryBuilderMock<T>, [unknown, Record<string, unknown>?]>()
    .mockReturnValue(builder);
  builder.orderBy = jest
    .fn<QueryBuilderMock<T>, [string, 'ASC' | 'DESC']>()
    .mockReturnValue(builder);
  builder.addOrderBy = jest
    .fn<QueryBuilderMock<T>, [string, 'ASC' | 'DESC']>()
    .mockReturnValue(builder);
  builder.take = jest
    .fn<QueryBuilderMock<T>, [number]>()
    .mockReturnValue(builder);
  builder.getMany = jest.fn<Promise<T[]>, []>().mockResolvedValue(rows);
  return builder;
}

function submissionCursorRow(
  contentKind: CommunityContentType | 'result',
  id: string,
  updatedAt: Date,
): DataSourceQueryRow {
  return {
    content_kind: contentKind,
    id,
    updated_at: updatedAt,
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

function adminAccountFixture(
  overrides: Partial<AdminAccount> = {},
): AdminAccount {
  return {
    id: 'admin_1',
    email: 'ops@example.com',
    canonical_email: 'ops@example.com',
    name: 'Ops Admin',
    role: AdminAccountRole.Admin,
    status: AdminAccountStatus.Active,
    password_hash: null,
    invitation_token_hash: null,
    invitation_expires_at: null,
    password_reset_token_hash: null,
    password_reset_expires: null,
    mfa_totp_secret: null,
    mfa_pending_totp_secret: null,
    mfa_pending_expires_at: null,
    mfa_enabled_at: null,
    mfa_last_used_time_step: null,
    mfa_recovery_code_hashes: null,
    created_by_admin_id: null,
    created_by_admin: null,
    accepted_at: new Date(),
    last_login_at: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    sessions: [],
    generateId: jest.fn(),
    ...overrides,
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
  it('returns a human-readable admin label for community settings updates', async () => {
    const { repositories, service } = createService();
    repositories.communitySettings.findOne.mockResolvedValue(
      settingsFixture(7),
    );
    repositories.adminAccounts.findOne.mockResolvedValue(adminAccountFixture());

    const result = await service.getCommunitySettings();

    expect(result).toMatchObject({
      minimumAccountAgeDays: 7,
      updatedByAdminId: 'admin_1',
      updatedByAdminLabel: 'Ops Admin (ops@example.com)',
    });
  });

  it('does not expose a raw admin id as the visible community settings label', async () => {
    const { repositories, service } = createService();
    repositories.communitySettings.findOne.mockResolvedValue(
      settingsFixture(7),
    );
    repositories.adminAccounts.findOne.mockResolvedValue(null);

    const result = await service.getCommunitySettings();

    expect(result.updatedByAdminId).toBe('admin_1');
    expect(result.updatedByAdminLabel).toBe('Former admin');
  });

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
        routineContextUsage: CommunityReviewRoutineContextUsage.WithProducts,
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

  it('accepts standalone reviews without companion products', async () => {
    const { aiModeration, repositories, service } = createService();
    const user = userFixture();
    repositories.users.findOne.mockResolvedValue(user);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );
    repositories.inventory.count.mockResolvedValue(1);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));
    repositories.communitySettings.findOne.mockResolvedValue(
      settingsFixture(1),
    );

    await service.createReview(user.id, {
      productBrand: 'Ritora',
      productName: 'Barrier Cream',
      productCategory: ProductCategory.Moisturizer,
      disclosureType: CommunityDisclosureType.Ordinary,
      usageDuration: '8-weeks',
      frequency: 'daily',
      routineContextUsage: CommunityReviewRoutineContextUsage.UsedAlone,
      routineSlot: CommunityReviewRoutineSlot.PM,
      skinResponse: CommunityReviewSkinResponse.Improved,
      overallRating: 5,
      effectivenessRating: 4,
      irritationRating: 1,
      outcomes: ['barrier-support'],
      repurchase: 'yes',
      routineContext: [],
      body: 'It helped even without layering other products in the same routine.',
    });

    const savedReview = repositories.reviews.save.mock.calls[0]?.[0];
    expect(savedReview).toEqual(
      expect.objectContaining({
        routine_context_usage: CommunityReviewRoutineContextUsage.UsedAlone,
      }),
    );
    const moderationInput = (aiModeration.triage as jest.Mock).mock.calls[0][0];
    expect(moderationInput.text).toContain('Routine context usage: used_alone');
  });

  it('passes labeled review context to AI moderation', async () => {
    const { aiModeration, repositories, service } = createService();
    const user = userFixture();
    const moisturizer = inventoryProductFixture({
      id: 'product_moisturizer',
      brand: 'Ritora Eval',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
    });
    const cleanser = inventoryProductFixture({
      id: 'product_cleanser',
      brand: 'Ritora Eval',
      name: 'Soft Cleanser',
      category: ProductCategory.Cleanser,
    });
    repositories.users.findOne.mockResolvedValue(user);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );
    repositories.inventory.count.mockResolvedValue(2);
    repositories.inventory.find.mockResolvedValue([moisturizer, cleanser]);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));
    repositories.communitySettings.findOne.mockResolvedValue(
      settingsFixture(1),
    );

    await service.createReview(user.id, {
      productId: moisturizer.id,
      productBrand: 'Ignored Brand',
      productName: 'Ignored Name',
      productCategory: ProductCategory.Moisturizer,
      disclosureType: CommunityDisclosureType.Ordinary,
      usageDuration: '4-weeks',
      frequency: 'daily',
      routineContextUsage: CommunityReviewRoutineContextUsage.WithProducts,
      routineSlot: CommunityReviewRoutineSlot.PM,
      skinResponse: CommunityReviewSkinResponse.Improved,
      overallRating: 5,
      effectivenessRating: 4,
      irritationRating: 1,
      outcomes: ['barrier'],
      repurchase: 'yes',
      routineContext: [
        {
          category: ProductCategory.Cleanser,
          productId: cleanser.id,
        },
      ],
      body: 'I bought this myself and it felt comfortable in a simple routine.',
    });

    const moderationInput = (aiModeration.triage as jest.Mock).mock.calls[0][0];
    expect(moderationInput.text).toContain(
      'Reviewed product: Ritora Eval | Barrier Cream | moisturizer',
    );
    expect(moderationInput.text).toContain(
      'Routine context: Ritora Eval | Soft Cleanser | cleanser',
    );
    expect(moderationInput.text).toContain(
      'Review body: I bought this myself and it felt comfortable in a simple routine.',
    );
    expect(moderationInput.text).not.toContain(
      'Ritora Eval Barrier Cream improved barrier cleanser',
    );
  });

  it('infers paired context on returned-review edits from older clients', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const pendingReview = {
      id: 'review_pending_context_only',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      product_id: null,
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: ProductCategory.Moisturizer,
      disclosure_type: CommunityDisclosureType.Ordinary,
      usage_duration: '8-weeks',
      frequency: 'daily',
      routine_context_usage: null,
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
        sensitivityLevel: 'moderate',
        skinToneRange: 'medium',
        climateBucket: 'temperate',
        routinePace: 'cautious',
        goalTags: ['clearer_skin'],
      },
      safety_flags: [],
      helpful_count: 0,
      not_helpful_count: 0,
      outcome_signal_counts: {},
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as CommunityReview;
    repositories.reviews.findOne.mockResolvedValue(pendingReview);
    repositories.users.findOne.mockResolvedValue(user);
    repositories.inventory.count.mockResolvedValue(1);
    repositories.consents.findOne.mockResolvedValue(consentFixture(user.id));
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    await service.updateReview(user.id, pendingReview.id, {
      routineContext: [
        {
          category: ProductCategory.Cleanser,
          productName: 'Milky Cleanser',
        },
      ],
    });

    expect(repositories.reviews.save).toHaveBeenCalledWith(
      expect.objectContaining({
        routine_context_usage: CommunityReviewRoutineContextUsage.WithProducts,
      }),
    );
  });
});

describe('CommunityService content integrity policy', () => {
  it('marks author-owned published reviews as unavailable for outcome confirmation', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const now = new Date();
    const review = {
      id: 'review_owned',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      product_id: 'product_review_1',
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: 'moisturizer',
      disclosure_type: CommunityDisclosureType.Ordinary,
      usage_duration: '8-weeks',
      frequency: 'daily',
      routine_context_usage: CommunityReviewRoutineContextUsage.UsedAlone,
      routine_slot: CommunityReviewRoutineSlot.PM,
      skin_response: CommunityReviewSkinResponse.Improved,
      overall_rating: 5,
      effectiveness_rating: 4,
      irritation_rating: 1,
      texture_rating: null,
      value_rating: null,
      outcomes: ['barrier-support'],
      repurchase: 'yes',
      body: 'This was my review.',
      moderation_status: CommunityModerationStatus.Published,
      assigned_admin_id: null,
      safe_facets: {
        skinType: 'combination',
        concernTags: ['acne'],
        sensitivityLevel: 'moderate',
        skinToneRange: 'medium',
        climateBucket: 'temperate',
        routinePace: 'cautious',
        goalTags: ['clearer_skin'],
      },
      safety_flags: [],
      helpful_count: 0,
      not_helpful_count: 0,
      outcome_signal_counts: {},
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: now,
      updated_at: now,
    } as unknown as CommunityReview;

    repositories.reviews.find.mockResolvedValue([review]);
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listReviews(user.id);

    expect(result.items[0]).toMatchObject({
      id: review.id,
      canSignalOutcome: false,
      canReportContent: false,
    });
  });

  it('returns paginated published reviews with a next cursor', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const rows = [
      communityReviewFixture({
        id: 'review_3',
        updated_at: new Date('2026-05-20T12:00:00.000Z'),
      }),
      communityReviewFixture({
        id: 'review_2',
        updated_at: new Date('2026-05-20T11:00:00.000Z'),
      }),
      communityReviewFixture({
        id: 'review_1',
        updated_at: new Date('2026-05-20T10:00:00.000Z'),
      }),
    ];

    repositories.reviews.find.mockResolvedValue(rows);
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listReviews(user.id, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.id)).toEqual([
      'review_3',
      'review_2',
    ]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(repositories.reviews.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { updated_at: 'DESC', id: 'DESC' },
        take: 3,
        where: expect.objectContaining({
          moderation_status: CommunityModerationStatus.Published,
        }),
      }),
    );
  });

  it('uses a cursor query for subsequent published playbook pages', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const cursorRoutine = communityRoutineFixture({
      id: 'routine_3',
      updated_at: new Date('2026-05-20T12:00:00.000Z'),
    });
    const cursor = encodeCursor({
      fingerprint: `community:routine:v1:${user.id}:2`,
      tuple: [cursorRoutine.updated_at.toISOString(), cursorRoutine.id],
    });
    const builder = queryBuilderMock([
      communityRoutineFixture({
        id: 'routine_2',
        updated_at: new Date('2026-05-20T11:00:00.000Z'),
      }),
    ]);

    repositories.routines.createQueryBuilder.mockReturnValue(
      builder as unknown as SelectQueryBuilder<CommunityRoutine>,
    );
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listRoutines(user.id, { cursor, limit: 2 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'routine_2' });
    expect(result.nextCursor).toBeNull();
    expect(repositories.routines.createQueryBuilder).toHaveBeenCalledWith(
      'routine',
    );
    expect(builder.where).toHaveBeenCalledWith(
      'routine.moderation_status = :status',
      { status: CommunityModerationStatus.Published },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.withdrawn_at IS NULL',
    );
    expect(builder.orderBy).toHaveBeenCalledWith('routine.updated_at', 'DESC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('routine.id', 'DESC');
    expect(builder.take).toHaveBeenCalledWith(3);
  });

  it('queries published playbooks with server-side search and filters', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const builder = queryBuilderMock([
      communityRoutineFixture({
        id: 'routine_filtered',
        goal_tags: ['barrier-repair'],
      }),
    ]);

    repositories.routines.createQueryBuilder.mockReturnValue(
      builder as unknown as SelectQueryBuilder<CommunityRoutine>,
    );
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listRoutines(user.id, {
      avoidTag: 'over-exfoliation',
      concern: 'acne',
      disclosureType: CommunityDisclosureType.Ordinary,
      goal: 'barrier-repair',
      habitTag: 'daily-sunscreen',
      limit: 2,
      productRole: 'moisturizer',
      result: CommunityGoalResult.MostlyImproved,
      search: 'barrier',
      sensitivity: 'moderate',
      skinType: 'combination',
      timeframe: CommunityGoalTimeframe.EightWeeks,
      warningTag: 'patch-test-first',
    });

    expect(result.items).toHaveLength(1);
    expect(repositories.routines.find).not.toHaveBeenCalled();
    expect(repositories.routines.createQueryBuilder).toHaveBeenCalledWith(
      'routine',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "routine.safe_facets ->> 'skinType' = :skinType",
      { skinType: 'combination' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "routine.safe_facets ->> 'sensitivityLevel' = :sensitivity",
      { sensitivity: 'moderate' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('routine.goal_tags ? :goal', {
      goal: 'barrier-repair',
    });
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.goal_result = :goalResult',
      { goalResult: CommunityGoalResult.MostlyImproved },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.timeframe = :timeframe',
      { timeframe: CommunityGoalTimeframe.EightWeeks },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('community_routine_steps'),
      { productRole: 'moisturizer' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.avoid_tags ? :avoidTag',
      { avoidTag: 'over-exfoliation' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.habit_tags ? :habitTag',
      { habitTag: 'daily-sunscreen' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'routine.warning_tags ? :warningTag',
      { warningTag: 'patch-test-first' },
    );
  });

  it('queries published reviews with server-side search and filters', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const builder = queryBuilderMock([
      communityReviewFixture({
        id: 'review_filtered',
        product_category: 'treatment',
      }),
    ]);

    repositories.reviews.createQueryBuilder.mockReturnValue(
      builder as unknown as SelectQueryBuilder<CommunityReview>,
    );
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listReviews(user.id, {
      concern: 'acne',
      contextProductCategory: 'moisturizer',
      disclosureType: CommunityDisclosureType.Ordinary,
      limit: 2,
      minRating: 4,
      productCategory: 'treatment',
      resultSignal: CommunityOutcomeSignal.WorkedForMeToo,
      routineContextUsage: CommunityReviewRoutineContextUsage.WithProducts,
      routineSlot: CommunityReviewRoutineSlot.PM,
      search: 'azelaic',
      sensitivity: 'moderate',
      skinResponse: CommunityReviewSkinResponse.Improved,
      skinType: 'combination',
      usageDuration: '8-weeks',
    });

    expect(result.items).toHaveLength(1);
    expect(repositories.reviews.find).not.toHaveBeenCalled();
    expect(repositories.reviews.createQueryBuilder).toHaveBeenCalledWith(
      'review',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "review.safe_facets ->> 'skinType' = :skinType",
      { skinType: 'combination' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      "review.safe_facets ->> 'sensitivityLevel' = :sensitivity",
      { sensitivity: 'moderate' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.product_category = :productCategory',
      { productCategory: 'treatment' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.routine_context_usage = :routineContextUsage',
      { routineContextUsage: CommunityReviewRoutineContextUsage.WithProducts },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.routine_slot = :routineSlot',
      { routineSlot: CommunityReviewRoutineSlot.PM },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('community_review_context_products'),
      { contextProductCategory: 'moisturizer' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.skin_response = :skinResponse',
      { skinResponse: CommunityReviewSkinResponse.Improved },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.usage_duration = :usageDuration',
      { usageDuration: '8-weeks' },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      'review.overall_rating >= :minRating',
      { minRating: 4 },
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      `COALESCE((review.outcome_signal_counts ->> :resultSignal)::int, 0) > 0`,
      { resultSignal: CommunityOutcomeSignal.WorkedForMeToo },
    );
  });

  it('applies a review context-product filter even when it is the only filter', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const builder = queryBuilderMock([
      communityReviewFixture({ id: 'review_context_only' }),
    ]);

    repositories.reviews.createQueryBuilder.mockReturnValue(
      builder as unknown as SelectQueryBuilder<CommunityReview>,
    );
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.listReviews(user.id, {
      contextProductCategory: 'cleanser',
      limit: 2,
    });

    expect(result.items).toHaveLength(1);
    expect(repositories.reviews.find).not.toHaveBeenCalled();
    expect(repositories.reviews.createQueryBuilder).toHaveBeenCalledWith(
      'review',
    );
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('community_review_context_products'),
      { contextProductCategory: 'cleanser' },
    );
  });

  it('returns a cursor-paginated people-like-me feed ranked by similarity', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture();
    const routine = communityRoutineFixture({
      id: 'routine_best_match',
      updated_at: new Date('2026-05-20T11:00:00.000Z'),
    });
    const review = communityReviewFixture({
      id: 'review_second_match',
      updated_at: new Date('2026-05-20T12:00:00.000Z'),
    });

    dataSource.query.mockResolvedValue([
      {
        content_kind: CommunityContentType.Routine,
        id: routine.id,
        match_score: '96',
        updated_at: routine.updated_at,
      },
      {
        content_kind: CommunityContentType.Review,
        id: review.id,
        match_score: '88',
        updated_at: review.updated_at,
      },
    ]);
    repositories.routines.find.mockResolvedValue([routine]);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.routineSteps.find.mockResolvedValue([]);
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.getPeopleLikeMe(user.id, { limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: routine.id,
      type: CommunityContentType.Routine,
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('community_routines'),
      expect.arrayContaining([
        CommunityModerationStatus.Published,
        CommunityDisclosureType.Ordinary,
        CommunityDisclosureType.Sponsored,
        CommunityDisclosureType.Affiliate,
        CommunityDisclosureType.BrandRep,
      ]),
    );
  });

  it('uses a scored cursor for subsequent people-like-me pages', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture();
    const cursor = encodeCursor({
      fingerprint: `community:people-like-me:v1:${user.id}:2`,
      tuple: [
        92,
        '2026-05-20T12:00:00.000Z',
        CommunityContentType.Routine,
        'routine_cursor',
      ],
    });

    dataSource.query.mockResolvedValue([]);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const result = await service.getPeopleLikeMe(user.id, {
      cursor,
      limit: 2,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"match_score" <'),
      expect.arrayContaining([
        92,
        new Date('2026-05-20T12:00:00.000Z'),
        CommunityContentType.Routine,
        'routine_cursor',
      ]),
    );
  });

  it('returns structured editable snapshots for author submissions', async () => {
    const { dataSource, repositories, service } = createService();
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
      id: 'review_needs_edit',
      author_user_id: user.id,
      community_profile_id: 'community_profile_1',
      product_id: 'product_review_1',
      product_brand: 'Ritora',
      product_name: 'Barrier Cream',
      product_category: 'moisturizer',
      disclosure_type: CommunityDisclosureType.Ordinary,
      usage_duration: '8-weeks',
      frequency: 'daily',
      routine_context_usage: CommunityReviewRoutineContextUsage.WithProducts,
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
      moderation_status: CommunityModerationStatus.NeedsEdit,
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
    const routineScan = {
      id: 'scan_1',
      content_type: CommunityContentType.Routine,
      content_id: routine.id,
      result: {
        flags: [],
        status: CommunityModerationStatus.NeedsEdit,
        scannedTextLength: 120,
        scannerVersion: 'deterministic-v1+ai-triage-v1',
        automation: {
          action: 'request_edit',
          handledBy: 'automation',
          reason: 'Remove treatment claims before resubmitting.',
          critical: false,
          confidence: 0.9,
          provider: 'openai',
          model: 'gpt-5.4-mini',
          fallbackReason: null,
          durationMs: 1200,
        },
      },
      created_at: now,
    } as unknown as CommunitySafetyScanResult;
    const reviewDecision = {
      id: 'decision_1',
      content_type: CommunityContentType.Review,
      content_id: review.id,
      actor_admin_id: null,
      from_status: CommunityModerationStatus.Draft,
      to_status: CommunityModerationStatus.NeedsEdit,
      reason:
        'AI moderation request_edit: Add sunscreen context and clarify the hyperpigmentation claim wording.',
      created_at: now,
    } as CommunityModerationDecision;

    dataSource.query.mockResolvedValue([
      submissionCursorRow(CommunityContentType.Routine, routine.id, now),
      submissionCursorRow(CommunityContentType.Review, review.id, now),
    ]);
    repositories.routines.find.mockResolvedValue([routine]);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.routineSteps.find.mockResolvedValue([step]);
    repositories.reviewContext.find.mockResolvedValue([contextProduct]);
    repositories.safetyScans.find.mockResolvedValue([routineScan]);
    repositories.decisions.find.mockResolvedValue([reviewDecision]);

    const result = await service.listMySubmissions(user.id);
    const routineItem = result.items.find((item) => item.id === routine.id);
    const reviewItem = result.items.find((item) => item.id === review.id);

    expect(routineItem).toMatchObject({
      moderationGuidance: {
        reason: 'Remove treatment claims before resubmitting.',
        source: 'ai',
        createdAt: now.toISOString(),
      },
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
      moderationGuidance: {
        reason:
          'Add sunscreen context and clarify the hyperpigmentation claim wording.',
        source: 'ai',
        createdAt: now.toISOString(),
      },
      editableReview: {
        productId: review.product_id,
        productBrand: review.product_brand,
        productName: review.product_name,
        productCategory: review.product_category,
        disclosureType: review.disclosure_type,
        usageDuration: review.usage_duration,
        frequency: review.frequency,
        routineContextUsage: review.routine_context_usage,
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

  it('lists own review result notes as withdrawable submissions', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture();
    const review = {
      id: 'review_1',
      author_user_id: 'review_author',
      product_brand: 'The Ordinary',
      product_name: 'Azelaic Acid Suspension 10%',
      moderation_status: CommunityModerationStatus.PendingReview,
      withdrawn_at: null,
    } as CommunityReview;
    const vote = {
      id: 'vote_1',
      user_id: user.id,
      content_type: CommunityContentType.Review,
      content_id: review.id,
      signal: CommunityOutcomeSignal.WorkedWithChanges,
      context: {
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.Mild,
        routineSlot: CommunityReviewRoutineSlot.PM,
        usedWithProducts: [
          {
            category: ProductCategory.Moisturizer,
            productBrand: 'Vanicream',
            productName: 'Daily Facial Moisturizer',
          },
        ],
      },
      safe_facets: {
        skinType: null,
        concernTags: [],
        sensitivityLevel: null,
        skinToneRange: null,
        climateBucket: null,
        routinePace: null,
        goalTags: [],
      },
      note: 'Buffering with moisturizer made this easier to keep using.',
      note_moderation_status: CommunityModerationStatus.PendingReview,
      note_safety_flags: [],
      note_moderation_reason: 'AI moderation admin_review: context check',
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: new Date('2026-05-01T10:00:00.000Z'),
      updated_at: new Date('2026-05-01T10:00:00.000Z'),
      generateId: jest.fn(),
    } as unknown as CommunityOutcomeSignalVote;

    dataSource.query.mockResolvedValue([
      submissionCursorRow('result', vote.id, vote.updated_at),
    ]);
    repositories.routines.find.mockResolvedValue([]);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.outcomeVotes.find.mockResolvedValue([vote]);

    const result = await service.listMySubmissions(user.id);

    const parentReviewCall = repositories.reviews.find.mock.calls.at(-1)?.[0];
    const parentReviewWhere = parentReviewCall as
      | { where?: Record<string, unknown> }
      | undefined;
    expect(parentReviewCall).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: expect.any(Object),
          withdrawn_at: expect.any(Object),
        }),
      }),
    );
    expect(parentReviewWhere?.where).not.toHaveProperty('moderation_status');
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: vote.id,
        type: 'result',
        title: 'The Ordinary Azelaic Acid Suspension 10%',
        editableText: vote.note,
        status: CommunityModerationStatus.PendingReview,
        disclosureType: CommunityDisclosureType.Ordinary,
        safetyFlags: [],
        moderationGuidance: {
          reason: 'context check',
          source: 'ai',
          createdAt: vote.updated_at.toISOString(),
        },
        parentContent: {
          id: review.id,
          title: 'The Ordinary Azelaic Acid Suspension 10%',
          type: CommunityContentType.Review,
          status: CommunityModerationStatus.PendingReview,
        },
        authorUserId: user.id,
      }),
    );
  });

  it('does not use outcome signal values as submission titles when a parent is unavailable', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture();
    const vote = {
      id: 'vote_without_parent',
      user_id: user.id,
      content_type: CommunityContentType.Review,
      content_id: 'review_under_cleanup',
      signal: CommunityOutcomeSignal.DidNotWork,
      context: {
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.Mild,
        routineSlot: CommunityReviewRoutineSlot.PM,
        usedWithProducts: [],
      },
      safe_facets: {
        skinType: null,
        concernTags: [],
        sensitivityLevel: null,
        skinToneRange: null,
        climateBucket: null,
        routinePace: null,
        goalTags: [],
      },
      note: 'I had a different result.',
      note_moderation_status: CommunityModerationStatus.Published,
      note_safety_flags: [],
      note_moderation_reason: null,
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: new Date('2026-05-01T10:00:00.000Z'),
      updated_at: new Date('2026-05-01T10:00:00.000Z'),
      generateId: jest.fn(),
    } as unknown as CommunityOutcomeSignalVote;

    dataSource.query.mockResolvedValue([
      submissionCursorRow('result', vote.id, vote.updated_at),
    ]);
    repositories.routines.find.mockResolvedValue([]);
    repositories.reviews.find.mockResolvedValue([]);
    repositories.outcomeVotes.find.mockResolvedValue([vote]);

    const result = await service.listMySubmissions(user.id);

    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: vote.id,
        type: 'result',
        title: '',
        resultSignal: CommunityOutcomeSignal.DidNotWork,
      }),
    );
  });

  it('returns author submissions as cursor pages across content types', async () => {
    const { dataSource, repositories, service } = createService();
    const user = userFixture();
    const review = communityReviewFixture({
      id: 'review_newest_submission',
      author_user_id: user.id,
      updated_at: new Date('2026-05-20T12:00:00.000Z'),
    });
    const routine = communityRoutineFixture({
      id: 'routine_next_submission',
      author_user_id: user.id,
      updated_at: new Date('2026-05-20T11:00:00.000Z'),
    });

    dataSource.query.mockResolvedValue([
      submissionCursorRow(
        CommunityContentType.Review,
        review.id,
        review.updated_at,
      ),
      submissionCursorRow(
        CommunityContentType.Routine,
        routine.id,
        routine.updated_at,
      ),
    ]);
    repositories.routines.find.mockResolvedValue([routine]);
    repositories.reviews.find.mockResolvedValue([review]);
    repositories.reviewContext.find.mockResolvedValue([]);
    repositories.routineSteps.find.mockResolvedValue([]);

    const result = await service.listMySubmissions(user.id, { limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: review.id,
      type: CommunityContentType.Review,
    });
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('community_outcome_signal_votes'),
      expect.arrayContaining([
        user.id,
        CommunityContentType.Routine,
        CommunityContentType.Review,
        'result',
      ]),
    );
  });

  it('uses the combined submission cursor on later author pages', async () => {
    const { dataSource, service } = createService();
    const user = userFixture();
    const cursor = encodeCursor({
      fingerprint: `community:submission:v1:${user.id}:2`,
      tuple: [
        '2026-05-20T12:00:00.000Z',
        CommunityContentType.Review,
        'review_cursor',
      ],
    });

    dataSource.query.mockResolvedValue([]);

    const result = await service.listMySubmissions(user.id, {
      cursor,
      limit: 2,
    });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"updated_at" <'),
      expect.arrayContaining([
        new Date('2026-05-20T12:00:00.000Z'),
        CommunityContentType.Review,
        'review_cursor',
      ]),
    );
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
      routine_context_usage: CommunityReviewRoutineContextUsage.UsedAlone,
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

    await expect(service.withdrawContent(user.id, routine.id)).resolves.toEqual(
      { deleted: true },
    );

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

  it('withdraws own result note and removes it from published evidence counts', async () => {
    const { repositories, service } = createService();
    const user = userFixture();
    const vote = {
      id: 'vote_1',
      user_id: user.id,
      content_type: CommunityContentType.Review,
      content_id: 'review_1',
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      context: {
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.None,
        routineSlot: CommunityReviewRoutineSlot.PM,
        usedWithProducts: [],
      },
      safe_facets: {
        skinType: null,
        concernTags: [],
        sensitivityLevel: null,
        skinToneRange: null,
        climateBucket: null,
        routinePace: null,
        goalTags: [],
      },
      note: 'This worked for me too.',
      note_moderation_status: CommunityModerationStatus.Published,
      note_safety_flags: [],
      note_moderation_reason: null,
      withdrawn_at: null,
      withdrawn_by_user_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      generateId: jest.fn(),
    } as unknown as CommunityOutcomeSignalVote;
    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    repositories.routines.findOne.mockResolvedValue(null);
    repositories.reviews.findOne.mockResolvedValue(null);
    repositories.outcomeVotes.findOne.mockResolvedValue(vote);
    repositories.outcomeVotes.createQueryBuilder = jest
      .fn()
      .mockReturnValue(outcomeQueryBuilder);

    await expect(service.withdrawContent(user.id, vote.id)).resolves.toEqual({
      deleted: true,
    });

    expect(vote.note_moderation_status).toBe(CommunityModerationStatus.Hidden);
    expect(vote.withdrawn_at).toBeInstanceOf(Date);
    expect(vote.withdrawn_by_user_id).toBe(user.id);
    expect(repositories.outcomeVotes.save).toHaveBeenCalledWith(vote);
    expect(outcomeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vote.note_moderation_status = :status',
      { status: CommunityModerationStatus.Published },
    );
    expect(outcomeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vote.withdrawn_at IS NULL',
    );
    expect(repositories.reviews.update).toHaveBeenCalledWith(vote.content_id, {
      outcome_signal_counts: expect.objectContaining({
        [CommunityOutcomeSignal.WorkedForMeToo]: 0,
      }),
    });
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
        routineSlot: null,
        usedWithProducts: [],
      },
      safe_facets: similarFacets,
      note: null,
      note_moderation_status: CommunityModerationStatus.Published,
      note_safety_flags: [],
      note_moderation_reason: null,
      withdrawn_at: null,
      withdrawn_by_user_id: null,
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
    repositories.outcomeVotes.find.mockResolvedValue([
      similarVote,
      differentVote,
    ]);

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
    expect(result.topGoals).toEqual([{ value: 'barrier-repair', count: 1 }]);
    expect(result.topAvoids).toEqual([{ value: 'over-exfoliation', count: 1 }]);
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
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(user),
    );

    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
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

  it('allows a non-author to confirm a published review outcome', async () => {
    const { dataSource, repositories, service } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityReview;

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { signal: CommunityOutcomeSignal.WorkedForMeToo, count: '1' },
        ]),
    };
    repositories.outcomeVotes.createQueryBuilder = jest
      .fn()
      .mockReturnValue(outcomeQueryBuilder);

    const result = await service.signalReviewOutcome(viewer.id, review.id, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"community_outcome_signal_votes"'),
      expect.arrayContaining([
        viewer.id,
        CommunityContentType.Review,
        review.id,
        CommunityOutcomeSignal.WorkedForMeToo,
      ]),
    );
    expect(result.outcomeSignalCounts.worked_for_me_too).toBe(1);
  });

  it('stores moderated result notes and shelf product context for review confirmations', async () => {
    const { aiModeration, dataSource, repositories, service, safety } =
      createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityReview;
    const companion = inventoryProductFixture({
      id: 'product_cleanser',
      brand: 'Ritora',
      name: 'Milky Cleanser',
      category: ProductCategory.Cleanser,
      identity: {
        ...inventoryProductFixture().identity,
        brand: 'Ritora',
        category: ProductCategory.Cleanser,
        name: 'Milky Cleanser',
      },
    });

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.inventory.find.mockResolvedValue([companion]);
    repositories.outcomeVotes.createQueryBuilder = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { signal: CommunityOutcomeSignal.WorkedForMeToo, count: '1' },
        ]),
    });

    const result = await service.signalReviewOutcome(viewer.id, review.id, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
      routineSlot: CommunityReviewRoutineSlot.PM,
      usedWithProducts: [
        { category: ProductCategory.Cleanser, productId: companion.id },
      ],
      note: 'It worked best when I used it after a gentle cleanser.',
    });

    expect(safety.scanText).toHaveBeenCalledWith(
      'It worked best when I used it after a gentle cleanser.',
    );
    expect(aiModeration.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: CommunityContentType.Review,
        disclosureType: CommunityDisclosureType.Ordinary,
        text: expect.stringContaining('Community result note'),
      }),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"note_moderation_status"'),
      expect.arrayContaining([
        CommunityOutcomeSignal.WorkedForMeToo,
        expect.objectContaining({
          routineSlot: CommunityReviewRoutineSlot.PM,
          usedWithProducts: [
            {
              category: ProductCategory.Cleanser,
              productBrand: 'Ritora',
              productName: 'Milky Cleanser',
            },
          ],
        }),
        'It worked best when I used it after a gentle cleanser.',
        CommunityModerationStatus.Published,
        [],
        'AI moderation publish: low risk',
      ]),
    );
    expect(result.noteModerationStatus).toBe(
      CommunityModerationStatus.Published,
    );
  });

  it('stores moderated result notes and selected product context for playbook confirmations', async () => {
    const { aiModeration, dataSource, repositories, service, safety } =
      createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const routine = {
      id: 'routine_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityRoutine;
    const cleanser = inventoryProductFixture({
      id: 'product_cleanser',
      brand: 'Ritora',
      name: 'Milky Cleanser',
      category: ProductCategory.Cleanser,
      identity: {
        ...inventoryProductFixture().identity,
        brand: 'Ritora',
        category: ProductCategory.Cleanser,
        name: 'Milky Cleanser',
      },
    });
    const moisturizer = inventoryProductFixture({
      id: 'product_moisturizer',
      brand: 'Ritora',
      name: 'Barrier Cream',
      category: ProductCategory.Moisturizer,
      identity: {
        ...inventoryProductFixture().identity,
        brand: 'Ritora',
        category: ProductCategory.Moisturizer,
        name: 'Barrier Cream',
      },
    });

    repositories.routines.findOne.mockResolvedValue(routine);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.inventory.find.mockResolvedValue([cleanser, moisturizer]);
    repositories.outcomeVotes.createQueryBuilder = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([
          { signal: CommunityOutcomeSignal.WorkedWithChanges, count: '1' },
        ]),
    });

    const result = await service.signalRoutineOutcome(viewer.id, routine.id, {
      signal: CommunityOutcomeSignal.WorkedWithChanges,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [
        CommunityOutcomeFollowedPart.Products,
        CommunityOutcomeFollowedPart.Habits,
      ],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
      routineSlot: CommunityReviewRoutineSlot.PM,
      usedWithProducts: [
        { category: ProductCategory.Cleanser, productId: cleanser.id },
        {
          category: ProductCategory.Moisturizer,
          productId: moisturizer.id,
        },
      ],
      note: 'I kept the gentle cleanse and moved the moisturizer to evenings.',
    });

    expect(safety.scanText).toHaveBeenCalledWith(
      'I kept the gentle cleanse and moved the moisturizer to evenings.',
    );
    expect(safety.scanRoutine).toHaveBeenCalledWith([
      expect.objectContaining({
        productName: 'Milky Cleanser',
        category: ProductCategory.Cleanser,
      }),
      expect.objectContaining({
        productName: 'Barrier Cream',
        category: ProductCategory.Moisturizer,
      }),
    ]);
    expect(aiModeration.triage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: CommunityContentType.Routine,
        disclosureType: CommunityDisclosureType.Ordinary,
        text: expect.stringContaining('Community result note'),
      }),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"note_moderation_status"'),
      expect.arrayContaining([
        CommunityOutcomeSignal.WorkedWithChanges,
        expect.objectContaining({
          routineSlot: CommunityReviewRoutineSlot.PM,
          usedWithProducts: [
            {
              category: ProductCategory.Cleanser,
              productBrand: 'Ritora',
              productName: 'Milky Cleanser',
            },
            {
              category: ProductCategory.Moisturizer,
              productBrand: 'Ritora',
              productName: 'Barrier Cream',
            },
          ],
        }),
        'I kept the gentle cleanse and moved the moisturizer to evenings.',
        CommunityModerationStatus.Published,
        [],
        'AI moderation publish: low risk',
      ]),
    );
    expect(result.noteModerationStatus).toBe(
      CommunityModerationStatus.Published,
    );
  });

  it('moderates reviewed-product pairings before exposing result context', async () => {
    const { dataSource, repositories, service, safety } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      product_brand: 'Ritora',
      product_name: 'Retinol Serum',
      product_category: ProductCategory.Treatment,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityReview;
    const companion = inventoryProductFixture({
      id: 'product_toner',
      brand: 'Ritora',
      name: 'AHA Toner',
      category: ProductCategory.Toner,
      identity: {
        ...inventoryProductFixture().identity,
        brand: 'Ritora',
        category: ProductCategory.Toner,
        name: 'AHA Toner',
      },
    });
    const pairingFlag = {
      code: 'retinoid_acid_conflict',
      severity: CommunitySafetySeverity.High,
      message:
        'This product context combines retinoid-style and acid-style actives.',
    };

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.inventory.find.mockResolvedValue([companion]);
    jest.mocked(safety.scanRoutine).mockReturnValue([pairingFlag]);
    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    repositories.outcomeVotes.createQueryBuilder = jest
      .fn()
      .mockReturnValue(outcomeQueryBuilder);

    const result = await service.signalReviewOutcome(viewer.id, review.id, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
      routineSlot: CommunityReviewRoutineSlot.PM,
      usedWithProducts: [
        { category: ProductCategory.Toner, productId: companion.id },
      ],
    });

    expect(safety.scanRoutine).toHaveBeenCalledWith([
      expect.objectContaining({
        productName: 'Retinol Serum',
        category: ProductCategory.Treatment,
      }),
      expect.objectContaining({
        productName: 'AHA Toner',
        category: ProductCategory.Toner,
      }),
    ]);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"note_moderation_status"'),
      expect.arrayContaining([
        null,
        CommunityModerationStatus.PendingReview,
        [pairingFlag],
      ]),
    );
    expect(result.noteModerationStatus).toBe(
      CommunityModerationStatus.PendingReview,
    );
    expect(result.outcomeSignalCounts.worked_for_me_too).toBe(0);
    expect(outcomeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vote.note_moderation_status = :status',
      { status: CommunityModerationStatus.Published },
    );
  });

  it('rejects clearly abusive or spammy result notes with deterministic guardrails', async () => {
    const { dataSource, repositories, service, safety } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityReview;

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    jest.mocked(safety.scanText).mockReturnValue([
      {
        code: 'possible_spam_or_moderation_manipulation',
        severity: CommunitySafetySeverity.Medium,
        message: 'This note may be spam.',
      },
    ]);
    const outcomeQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    repositories.outcomeVotes.createQueryBuilder = jest
      .fn()
      .mockReturnValue(outcomeQueryBuilder);

    const result = await service.signalReviewOutcome(viewer.id, review.id, {
      signal: CommunityOutcomeSignal.WorkedForMeToo,
      sameGoal: true,
      trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
      followedParts: [CommunityOutcomeFollowedPart.Products],
      irritationLevel: CommunityOutcomeIrritationLevel.None,
      note: 'DM me on telegram for a miracle discount.',
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"note_moderation_status"'),
      expect.arrayContaining([CommunityModerationStatus.Rejected]),
    );
    expect(result.noteModerationStatus).toBe(
      CommunityModerationStatus.Rejected,
    );
    expect(result.outcomeSignalCounts.worked_for_me_too).toBe(0);
    expect(outcomeQueryBuilder.andWhere).toHaveBeenCalledWith(
      'vote.note_moderation_status = :status',
      { status: CommunityModerationStatus.Published },
    );
  });

  it('lists filtered review result notes without exposing notes that still need moderation', async () => {
    const { repositories, service } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 1,
        [CommunityOutcomeSignal.DidNotWork]: 1,
      },
      withdrawn_at: null,
    } as CommunityReview;
    const similarFacets = {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: 'moderate',
      skinToneRange: 'medium',
      climateBucket: null,
      routinePace: 'cautious',
      goalTags: ['clearer_skin'],
    };

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.outcomeVotes.find.mockResolvedValue([
      {
        id: 'vote_1',
        user_id: 'other_1',
        content_type: CommunityContentType.Review,
        content_id: review.id,
        signal: CommunityOutcomeSignal.WorkedForMeToo,
        context: {
          sameGoal: true,
          trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
          followedParts: [CommunityOutcomeFollowedPart.Products],
          irritationLevel: CommunityOutcomeIrritationLevel.None,
          routineSlot: CommunityReviewRoutineSlot.PM,
          usedWithProducts: [
            {
              category: ProductCategory.Cleanser,
              productBrand: 'Ritora',
              productName: 'Milky Cleanser',
            },
          ],
        },
        safe_facets: similarFacets,
        note: 'The cleanser pairing made it less drying.',
        note_moderation_status: CommunityModerationStatus.Published,
        note_safety_flags: [],
        note_moderation_reason: 'AI moderation publish: low risk',
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        created_at: new Date('2026-05-01T10:00:00.000Z'),
        updated_at: new Date('2026-05-01T10:00:00.000Z'),
        generateId: jest.fn(),
      },
      {
        id: 'vote_2',
        user_id: 'other_2',
        content_type: CommunityContentType.Review,
        content_id: review.id,
        signal: CommunityOutcomeSignal.WorkedForMeToo,
        context: {
          sameGoal: false,
          trialDuration: CommunityOutcomeTrialDuration.FourWeeks,
          followedParts: [CommunityOutcomeFollowedPart.Products],
          irritationLevel: CommunityOutcomeIrritationLevel.Mild,
          routineSlot: null,
          usedWithProducts: [
            {
              category: ProductCategory.Treatment,
              productBrand: 'Ritora',
              productName: 'AHA Toner',
            },
          ],
        },
        safe_facets: similarFacets,
        note: 'This note is still under review.',
        note_moderation_status: CommunityModerationStatus.PendingReview,
        note_safety_flags: [],
        note_moderation_reason: 'AI moderation admin_review: privacy risk',
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        created_at: new Date('2026-05-02T10:00:00.000Z'),
        updated_at: new Date('2026-05-02T10:00:00.000Z'),
        generateId: jest.fn(),
      },
      {
        id: 'vote_3',
        user_id: 'other_3',
        content_type: CommunityContentType.Review,
        content_id: review.id,
        signal: CommunityOutcomeSignal.DidNotWork,
        context: {
          sameGoal: true,
          trialDuration: CommunityOutcomeTrialDuration.TwoWeeks,
          followedParts: [CommunityOutcomeFollowedPart.Products],
          irritationLevel: CommunityOutcomeIrritationLevel.Moderate,
          routineSlot: null,
          usedWithProducts: [],
        },
        safe_facets: similarFacets,
        note: 'Filtered out.',
        note_moderation_status: CommunityModerationStatus.Published,
        note_safety_flags: [],
        note_moderation_reason: 'AI moderation publish: low risk',
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        created_at: new Date('2026-05-03T10:00:00.000Z'),
        updated_at: new Date('2026-05-03T10:00:00.000Z'),
        generateId: jest.fn(),
      },
    ]);

    const result = await service.listReviewResults(
      viewer.id,
      review.id,
      CommunityOutcomeSignal.WorkedForMeToo,
    );

    expect(repositories.outcomeVotes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          note_moderation_status: CommunityModerationStatus.Published,
        }),
      }),
    );
    expect(result.counts.worked_for_me_too).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'vote_1',
      note: 'The cleanser pairing made it less drying.',
      noteModerationStatus: CommunityModerationStatus.Published,
      similarToViewer: true,
      usedWithProducts: [
        {
          category: ProductCategory.Cleanser,
          productBrand: 'Ritora',
          productName: 'Milky Cleanser',
        },
      ],
    });
    expect(result.items.find((item) => item.id === 'vote_2')).toBeUndefined();
  });

  it('returns review result notes as cursor pages', async () => {
    const { repositories, service } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 3,
      },
      withdrawn_at: null,
    } as CommunityReview;

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.outcomeVotes.find.mockResolvedValue([
      communityOutcomeVoteFixture({
        id: 'vote_3',
        contentId: review.id,
        contentType: CommunityContentType.Review,
        createdAt: new Date('2026-05-03T10:00:00.000Z'),
        signal: CommunityOutcomeSignal.WorkedForMeToo,
      }),
      communityOutcomeVoteFixture({
        id: 'vote_2',
        contentId: review.id,
        contentType: CommunityContentType.Review,
        createdAt: new Date('2026-05-02T10:00:00.000Z'),
        signal: CommunityOutcomeSignal.WorkedForMeToo,
      }),
      communityOutcomeVoteFixture({
        id: 'vote_1',
        contentId: review.id,
        contentType: CommunityContentType.Review,
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        signal: CommunityOutcomeSignal.WorkedForMeToo,
      }),
    ]);

    const result = await service.listReviewResults(viewer.id, review.id, {
      limit: 2,
      signal: CommunityOutcomeSignal.WorkedForMeToo,
    });

    expect(repositories.outcomeVotes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { created_at: 'DESC', id: 'DESC' },
        take: 3,
      }),
    );
    expect(result.items.map((item) => item.id)).toEqual(['vote_3', 'vote_2']);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(decodeCursor(result.nextCursor as string).tuple).toEqual([
      '2026-05-02T10:00:00.000Z',
      'vote_2',
    ]);
  });

  it('uses the result cursor on later review result pages', async () => {
    const { repositories, service } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const review = communityReviewFixture({
      id: 'review_1',
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedForMeToo]: 3,
      },
    });
    const cursor = encodeCursor({
      fingerprint: [
        'community',
        'results',
        'v1',
        viewer.id,
        CommunityContentType.Review,
        review.id,
        2,
        CommunityOutcomeSignal.WorkedForMeToo,
      ].join(':'),
      tuple: ['2026-05-02T10:00:00.000Z', 'vote_2'],
    });

    repositories.reviews.findOne.mockResolvedValue(review);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.outcomeVotes.find.mockResolvedValue([
      communityOutcomeVoteFixture({
        id: 'vote_1',
        contentId: review.id,
        contentType: CommunityContentType.Review,
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        signal: CommunityOutcomeSignal.WorkedForMeToo,
      }),
    ]);

    const result = await service.listReviewResults(viewer.id, review.id, {
      cursor,
      limit: 2,
      signal: CommunityOutcomeSignal.WorkedForMeToo,
    });

    expect(repositories.outcomeVotes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: expect.arrayContaining([
          expect.objectContaining({
            content_id: review.id,
            content_type: CommunityContentType.Review,
            note_moderation_status: CommunityModerationStatus.Published,
            signal: CommunityOutcomeSignal.WorkedForMeToo,
          }),
        ]),
      }),
    );
    expect(result.items.map((item) => item.id)).toEqual(['vote_1']);
    expect(result.nextCursor).toBeNull();
  });

  it('lists filtered playbook result notes without exposing notes that still need moderation', async () => {
    const { repositories, service } = createService();
    const viewer = userFixture({ id: 'viewer_1' });
    const author = userFixture({ id: 'author_1' });
    const routine = {
      id: 'routine_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {
        [CommunityOutcomeSignal.WorkedWithChanges]: 1,
        [CommunityOutcomeSignal.DidNotWork]: 1,
      },
      withdrawn_at: null,
    } as CommunityRoutine;
    const similarFacets = {
      skinType: 'combination',
      concernTags: ['acne'],
      sensitivityLevel: 'moderate',
      skinToneRange: 'medium',
      climateBucket: null,
      routinePace: 'cautious',
      goalTags: ['clearer_skin'],
    };

    repositories.routines.findOne.mockResolvedValue(routine);
    repositories.skinProfiles.findOne.mockResolvedValue(
      completeSkinProfile(viewer),
    );
    repositories.outcomeVotes.find.mockResolvedValue([
      {
        id: 'vote_1',
        user_id: 'other_1',
        content_type: CommunityContentType.Routine,
        content_id: routine.id,
        signal: CommunityOutcomeSignal.WorkedWithChanges,
        context: {
          sameGoal: true,
          trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
          followedParts: [
            CommunityOutcomeFollowedPart.Products,
            CommunityOutcomeFollowedPart.Habits,
          ],
          irritationLevel: CommunityOutcomeIrritationLevel.None,
          routineSlot: CommunityReviewRoutineSlot.PM,
          usedWithProducts: [
            {
              category: ProductCategory.Cleanser,
              productBrand: 'Ritora',
              productName: 'Milky Cleanser',
            },
          ],
        },
        safe_facets: similarFacets,
        note: 'I followed the cleanser step and sleep habit, but used my own moisturizer.',
        note_moderation_status: CommunityModerationStatus.Published,
        note_safety_flags: [],
        note_moderation_reason: 'AI moderation publish: low risk',
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        created_at: new Date('2026-05-01T10:00:00.000Z'),
        updated_at: new Date('2026-05-01T10:00:00.000Z'),
        generateId: jest.fn(),
      },
      {
        id: 'vote_2',
        user_id: 'other_2',
        content_type: CommunityContentType.Routine,
        content_id: routine.id,
        signal: CommunityOutcomeSignal.WorkedWithChanges,
        context: {
          sameGoal: false,
          trialDuration: CommunityOutcomeTrialDuration.FourWeeks,
          followedParts: [CommunityOutcomeFollowedPart.Partial],
          irritationLevel: CommunityOutcomeIrritationLevel.Mild,
          routineSlot: null,
          usedWithProducts: [],
        },
        safe_facets: similarFacets,
        note: 'This note is still under review.',
        note_moderation_status: CommunityModerationStatus.PendingReview,
        note_safety_flags: [],
        note_moderation_reason: 'AI moderation admin_review: privacy risk',
        withdrawn_at: null,
        withdrawn_by_user_id: null,
        created_at: new Date('2026-05-02T10:00:00.000Z'),
        updated_at: new Date('2026-05-02T10:00:00.000Z'),
        generateId: jest.fn(),
      },
    ]);

    const result = await service.listRoutineResults(
      viewer.id,
      routine.id,
      CommunityOutcomeSignal.WorkedWithChanges,
    );

    expect(repositories.outcomeVotes.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          content_type: CommunityContentType.Routine,
          note_moderation_status: CommunityModerationStatus.Published,
        }),
      }),
    );
    expect(result.counts.worked_with_changes).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'vote_1',
      note: 'I followed the cleanser step and sleep habit, but used my own moisturizer.',
      noteModerationStatus: CommunityModerationStatus.Published,
      similarToViewer: true,
      usedWithProducts: [
        {
          category: ProductCategory.Cleanser,
          productBrand: 'Ritora',
          productName: 'Milky Cleanser',
        },
      ],
    });
    expect(result.items.find((item) => item.id === 'vote_2')).toBeUndefined();
  });

  it('rejects review outcome confirmation by the review author', async () => {
    const { dataSource, repositories, service } = createService();
    const author = userFixture({ id: 'author_1' });
    const review = {
      id: 'review_1',
      author_user_id: author.id,
      moderation_status: CommunityModerationStatus.Published,
      outcome_signal_counts: {},
      withdrawn_at: null,
    } as CommunityReview;

    repositories.reviews.findOne.mockResolvedValue(review);

    await expect(
      service.signalReviewOutcome(author.id, review.id, {
        signal: CommunityOutcomeSignal.WorkedForMeToo,
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.None,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
