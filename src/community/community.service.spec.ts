import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { SkinProfileSexAtBirth } from '../skin-profile/dto/skin-profile.constants';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserConsentType } from '../users/user-consent.constants';
import { CommunityAiModerationService } from './community-ai-moderation.service';
import { CommunitySafetyService } from './community-safety.service';
import { CommunityService } from './community.service';
import { CommunityHelpfulnessVoteEntity } from './entities/community-helpfulness-vote.entity';
import { CommunityModerationDecision } from './entities/community-moderation-decision.entity';
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
  find: jest.Mock<Promise<T[]>, [unknown?]>;
  findOne: jest.Mock<Promise<T | null>, [unknown?]>;
  save: jest.Mock<Promise<T>, [T]>;
};

type DataSourceMock = DataSource & {
  query: jest.Mock<
    Promise<Array<{ count: number | string }>>,
    [string, unknown[]]
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
    find: jest.fn<Promise<T[]>, [unknown?]>().mockResolvedValue([]),
    findOne: jest.fn<Promise<T | null>, [unknown?]>().mockResolvedValue(null),
    save: jest.fn<Promise<T>, [T]>().mockImplementation(async (value) => value),
  };

  return mock as unknown as Repository<T> & MockRepository<T>;
}

function createService() {
  const dataSource = {
    query: jest
      .fn<Promise<Array<{ count: number | string }>>, [string, unknown[]]>()
      .mockResolvedValue([{ count: 0 }]),
  } as DataSourceMock;
  const repositories: CommunityRepositories = {
    profiles: repositoryMock<CommunityProfile>(),
    routines: repositoryMock<CommunityRoutine>(),
    routineSteps: repositoryMock<CommunityRoutineStep>(),
    reviews: repositoryMock<CommunityReview>(),
    reviewContext: repositoryMock<CommunityReviewContextProduct>(),
    reports: repositoryMock<CommunityReport>(),
    decisions: repositoryMock<CommunityModerationDecision>(),
    votes: repositoryMock<CommunityHelpfulnessVoteEntity>(),
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

  const service = new CommunityService(
    dataSource,
    {} as CommunitySafetyService,
    {} as CommunityAiModerationService,
    repositories.profiles,
    repositories.routines,
    repositories.routineSteps,
    repositories.reviews,
    repositories.reviewContext,
    repositories.reports,
    repositories.decisions,
    repositories.votes,
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

  return { dataSource, repositories, service };
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
