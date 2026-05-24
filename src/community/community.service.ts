import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, In, IsNull, MoreThan, Repository } from 'typeorm';
import { ulid } from 'ulid';
import {
  AdminAuditAction,
  AdminAuditLog,
} from '../admin/entities/admin-audit-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { hasCompletedEssentialSkinProfile } from '../skin-profile/skin-profile-completion';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserConsentType } from '../users/user-consent.constants';
import {
  type AdminCommunityAssignDto,
  type AdminCommunityModerationDto,
  type AdminCommunityModerationQueryDto,
  type AdminCommunityReportStatusDto,
  type AdminCommunitySettingsDto,
  type AdminCommunityWarningDto,
  type CommunityHelpfulnessDto,
  type CommunityOutcomeSignalDto,
  type CreateCommunityReportDto,
  type CreateCommunityReviewDto,
  type CreateCommunityRoutineDto,
  type EditCommunityReviewDto,
  type EditCommunityRoutineDto,
} from './dto/community.dto';
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
  DEFAULT_COMMUNITY_MIN_ACCOUNT_AGE_DAYS,
  CommunitySettings,
} from './entities/community-settings.entity';
import { CommunityWarning } from './entities/community-warning.entity';
import { CommunityAiModerationService } from './community-ai-moderation.service';
import { CommunitySafetyService } from './community-safety.service';
import {
  CommunityAdaptationChangeType,
  CommunityContentType,
  CommunityDisclosureType,
  CommunityHelpfulnessVote,
  CommunityModerationStatus,
  CommunityOutcomeFollowedPart,
  CommunityOutcomeIrritationLevel,
  CommunityOutcomeSignal,
  type CommunityOutcomeSignalContext,
  CommunityOutcomeTrialDuration,
  CommunityReportStatus,
  CommunityReportReason,
  CommunitySafetySeverity,
  type CommunityAdaptationChange,
  type CommunityModerationAutomationSnapshot,
  type CommunityRoutineContextProductPublic,
  type CommunityRoutineStepSnapshot,
  type CommunityRoutineStepPublic,
  type CommunitySafeProfileFacets,
  type CommunitySafetyFlag,
} from './community.types';
import {
  buildCommunitySafeFacets,
  normalizeCommunityTags,
} from './community-privacy';

const DEFAULT_LIMIT = 30;

function cleanText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const cleaned = (value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeTags(values: string[] | null | undefined): string[] {
  return normalizeCommunityTags(values);
}

function publicProfileName(userId: string): string {
  return `Ritora member ${userId.slice(-4).toUpperCase()}`;
}

type AdminCommunityAuditContext = {
  ip?: string | null;
  sessionId: string;
  userAgent?: string | null;
};

const SEVERE_REPORT_REASONS = new Set<CommunityReportReason>([
  CommunityReportReason.UnsafeAdvice,
  CommunityReportReason.MedicalClaims,
  CommunityReportReason.PrivacyViolation,
  CommunityReportReason.MisleadingBeforeAfter,
]);

const REPORT_ESCALATION_THRESHOLD = 3;
const COMMUNITY_GUIDELINES_VERSION = '1.0.0';
const COMMUNITY_ABUSE_LOOKBACK_DAYS = 30;
const COMMUNITY_ABUSE_STATUS_THRESHOLD = 2;
const COMMUNITY_ABUSE_SEVERE_REPORT_THRESHOLD = 3;
const USER_EDITABLE_MODERATION_STATUSES = new Set<CommunityModerationStatus>([
  CommunityModerationStatus.Draft,
  CommunityModerationStatus.PendingReview,
  CommunityModerationStatus.NeedsEdit,
  CommunityModerationStatus.Rejected,
]);
const DAY_MS = 24 * 60 * 60 * 1000;

type CommunityPostingEligibilityReason = {
  code:
    | 'email_unverified'
    | 'skin_profile_required'
    | 'shelf_product_required'
    | 'community_guidelines_required'
    | 'account_too_new'
    | 'recent_moderation_abuse';
  message: string;
};

@Injectable()
export class CommunityService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly safety: CommunitySafetyService,
    private readonly aiModeration: CommunityAiModerationService,
    @InjectRepository(CommunityProfile)
    private readonly profiles: Repository<CommunityProfile>,
    @InjectRepository(CommunityRoutine)
    private readonly routines: Repository<CommunityRoutine>,
    @InjectRepository(CommunityRoutineStep)
    private readonly routineSteps: Repository<CommunityRoutineStep>,
    @InjectRepository(CommunityReview)
    private readonly reviews: Repository<CommunityReview>,
    @InjectRepository(CommunityReviewContextProduct)
    private readonly reviewContext: Repository<CommunityReviewContextProduct>,
    @InjectRepository(CommunityReport)
    private readonly reports: Repository<CommunityReport>,
    @InjectRepository(CommunityModerationDecision)
    private readonly decisions: Repository<CommunityModerationDecision>,
    @InjectRepository(CommunityHelpfulnessVoteEntity)
    private readonly votes: Repository<CommunityHelpfulnessVoteEntity>,
    @InjectRepository(CommunityOutcomeSignalVote)
    private readonly outcomeVotes: Repository<CommunityOutcomeSignalVote>,
    @InjectRepository(CommunityRoutineAdaptation)
    private readonly adaptations: Repository<CommunityRoutineAdaptation>,
    @InjectRepository(CommunitySafetyScanResult)
    private readonly safetyScans: Repository<CommunitySafetyScanResult>,
    @InjectRepository(CommunitySettings)
    private readonly communitySettings: Repository<CommunitySettings>,
    @InjectRepository(CommunityWarning)
    private readonly warnings: Repository<CommunityWarning>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogs: Repository<AdminAuditLog>,
    @InjectRepository(InAppNotification)
    private readonly notifications: Repository<InAppNotification>,
    @InjectRepository(SkinProfile)
    private readonly skinProfiles: Repository<SkinProfile>,
    @InjectRepository(InventoryProduct)
    private readonly inventory: Repository<InventoryProduct>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(UserConsent)
    private readonly consents: Repository<UserConsent>,
  ) {}

  async getHome(userId: string) {
    const facets = await this.getSafeFacets(userId);
    const [routines, reviews, warnings, postingEligibility] = await Promise.all(
      [
        this.listRoutines(userId),
        this.listReviews(userId),
        this.listWarnings(),
        this.getPostingEligibility(userId),
      ],
    );

    return {
      profileFacets: facets,
      postingEligibility,
      routines: routines.items.slice(0, 6),
      reviews: reviews.items.slice(0, 6),
      warnings: warnings.slice(0, 4),
      patterns: this.buildPatterns(facets, routines.items, reviews.items),
    };
  }

  async getPostingEligibility(userId: string) {
    const [
      user,
      profile,
      shelfProductCount,
      guidelinesConsent,
      recentAbuse,
      settings,
    ] = await Promise.all([
      this.users.findOne({ where: { id: userId } }),
      this.skinProfiles.findOne({
        where: { user_id: userId },
        relations: ['user'],
      }),
      this.inventory.count({ where: { user_id: userId } }),
      this.findActiveConsent(userId, UserConsentType.CommunityGuidelines),
      this.hasRecentModerationAbuse(userId),
      this.getCommunitySettings(),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const now = Date.now();
    const ageMs = now - user.created_at.getTime();
    const minimumAccountAgeDays = settings.minimumAccountAgeDays;
    const minimumAgeMs = minimumAccountAgeDays * DAY_MS;
    const eligibleAt = new Date(user.created_at.getTime() + minimumAgeMs);
    const reasons: CommunityPostingEligibilityReason[] = [];

    if (!user.email_verified) {
      reasons.push({
        code: 'email_unverified',
        message: 'Verify your email before posting to Community.',
      });
    }
    const hasCompletedSkinProfile = hasCompletedEssentialSkinProfile(profile);

    if (!hasCompletedSkinProfile) {
      reasons.push({
        code: 'skin_profile_required',
        message: 'Complete your skin profile before posting to Community.',
      });
    }
    if (shelfProductCount < 1) {
      reasons.push({
        code: 'shelf_product_required',
        message: 'Add at least one shelf product before posting to Community.',
      });
    }
    if (!guidelinesConsent) {
      reasons.push({
        code: 'community_guidelines_required',
        message:
          'Accept the Community guidelines and disclosure rules before posting.',
      });
    }
    if (ageMs < minimumAgeMs) {
      reasons.push({
        code: 'account_too_new',
        message: `Community posting unlocks ${minimumAccountAgeDays} days after account creation.`,
      });
    }
    if (recentAbuse) {
      reasons.push({
        code: 'recent_moderation_abuse',
        message:
          'Recent moderation history prevents Community posting for now.',
      });
    }

    return {
      eligible: reasons.length === 0,
      minimumAccountAgeDays,
      accountAgeDays: Math.max(0, Math.floor(ageMs / DAY_MS)),
      eligibleAt: eligibleAt.toISOString(),
      hasAcceptedGuidelines: Boolean(guidelinesConsent),
      hasCompletedSkinProfile,
      hasShelfProduct: shelfProductCount > 0,
      emailVerified: user.email_verified,
      reasons,
    };
  }

  async acceptCommunityGuidelines(userId: string, ip?: string | null) {
    const existing = await this.findActiveConsent(
      userId,
      UserConsentType.CommunityGuidelines,
    );
    if (existing) return this.getPostingEligibility(userId);

    await this.consents.save(
      this.consents.create({
        user_id: userId,
        consent_type: UserConsentType.CommunityGuidelines,
        consent_version: COMMUNITY_GUIDELINES_VERSION,
        granted: true,
        granted_at: new Date(),
        revoked_at: null,
        ip_address: ip ?? null,
      }),
    );
    return this.getPostingEligibility(userId);
  }

  async getPeopleLikeMe(userId: string) {
    const [facets, routines, reviews] = await Promise.all([
      this.getSafeFacets(userId),
      this.listRoutines(userId),
      this.listReviews(userId),
    ]);
    return {
      profileFacets: facets,
      items: [...routines.items, ...reviews.items]
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, DEFAULT_LIMIT),
    };
  }

  async listRoutines(userId: string) {
    const facets = await this.getSafeFacets(userId);
    const rows = await this.routines.find({
      where: { moderation_status: CommunityModerationStatus.Published },
      order: { updated_at: 'DESC' },
      take: DEFAULT_LIMIT,
    });
    const stepsByRoutine = await this.loadSteps(rows.map((row) => row.id));
    return {
      items: rows.map((routine) =>
        this.toRoutineResponse(
          routine,
          stepsByRoutine.get(routine.id) ?? [],
          facets,
        ),
      ),
    };
  }

  async getRoutine(userId: string, id: string) {
    const routine = await this.routines.findOne({ where: { id } });
    if (
      !routine ||
      !this.canRead(routine, userId)
    ) {
      throw new NotFoundException('Community routine not found');
    }
    const facets = await this.getSafeFacets(userId);
    const steps = await this.routineSteps.find({
      where: { routine_id: id },
      order: { step_order: 'ASC' },
    });
    return this.toRoutineResponse(routine, steps, facets);
  }

  async getProductEvidence(userId: string, productId: string) {
    const [product, viewer] = await Promise.all([
      this.inventory.findOne({ where: { id: productId, user_id: userId } }),
      this.getSafeFacets(userId),
    ]);
    if (!product) {
      throw new NotFoundException('Shelf product not found');
    }

    const [reviewRows, matchingSteps] = await Promise.all([
      this.reviews.find({
        where: [
          {
            product_id: product.id,
            moderation_status: CommunityModerationStatus.Published,
          },
          {
            product_brand: ILike(product.brand),
            product_name: ILike(product.name),
            product_category: product.category,
            moderation_status: CommunityModerationStatus.Published,
          },
        ],
        order: { updated_at: 'DESC' },
        take: DEFAULT_LIMIT,
      }),
      this.routineSteps.find({
        where: [
          { product_id: product.id },
          {
            product_brand: ILike(product.brand),
            product_name: ILike(product.name),
            category: product.category,
          },
        ],
      }),
    ]);
    const reviews = Array.from(
      new Map(reviewRows.map((review) => [review.id, review])).values(),
    );
    const routineIds = Array.from(
      new Set(matchingSteps.map((step) => step.routine_id)),
    );
    const routines =
      routineIds.length > 0
        ? await this.routines.find({
            where: {
              id: In(routineIds),
              moderation_status: CommunityModerationStatus.Published,
            },
            take: DEFAULT_LIMIT,
          })
        : [];
    const contentVoteWhere = [
      ...(routines.length > 0
        ? [
            {
              content_type: CommunityContentType.Routine,
              content_id: In(routines.map((routine) => routine.id)),
            },
          ]
        : []),
      ...(reviews.length > 0
        ? [
            {
              content_type: CommunityContentType.Review,
              content_id: In(reviews.map((review) => review.id)),
            },
          ]
        : []),
    ];
    const outcomeVotes =
      contentVoteWhere.length > 0
        ? await this.outcomeVotes.find({ where: contentVoteWhere })
        : [];
    const outcomeSignalCounts = this.defaultOutcomeSignalCounts({});
    for (const routine of routines) {
      this.addOutcomeSignalCounts(
        outcomeSignalCounts,
        routine.outcome_signal_counts,
      );
    }
    for (const review of reviews) {
      this.addOutcomeSignalCounts(
        outcomeSignalCounts,
        review.outcome_signal_counts,
      );
    }
    const similarOutcomeSignalCounts = this.defaultOutcomeSignalCounts({});
    for (const vote of outcomeVotes) {
      if (this.isSimilarFacets(viewer, vote.safe_facets)) {
        similarOutcomeSignalCounts[vote.signal] += 1;
      }
    }

    return {
      productId: product.id,
      productBrand: product.brand,
      productName: product.name,
      reviewCount: reviews.length,
      playbookCount: routines.length,
      similarAuthorEvidenceCount: [
        ...reviews.map((review) => review.safe_facets),
        ...routines.map((routine) => routine.safe_facets),
      ].filter((facets) => this.isSimilarFacets(viewer, facets)).length,
      similarOutcomeConfirmationCount: Object.values(
        similarOutcomeSignalCounts,
      ).reduce((sum, count) => sum + count, 0),
      averageOverallRating: this.averageRating(
        reviews.map((review) => review.overall_rating),
      ),
      averageEffectivenessRating: this.averageRating(
        reviews.map((review) => review.effectiveness_rating),
      ),
      averageIrritationRating: this.averageRating(
        reviews.map((review) => review.irritation_rating),
      ),
      outcomeSignalCounts,
      similarOutcomeSignalCounts,
      topGoals: this.topCounts(routines.flatMap((routine) => routine.goal_tags)),
      topAvoids: this.topCounts(
        routines.flatMap((routine) => routine.avoid_tags ?? []),
      ),
      topOutcomes: this.topCounts(reviews.flatMap((review) => review.outcomes)),
    };
  }

  async createRoutine(userId: string, dto: CreateCommunityRoutineDto) {
    await this.assertCanPostCommunityContent(userId);
    await this.assertActionLimit({
      label: 'routine publishes',
      repository: this.routines,
      userColumn: 'author_user_id',
      userId,
      maxPerDay: 5,
    });
    if (dto.steps.length === 0) {
      throw new BadRequestException('Routine requires at least one step');
    }
    const [profile, products] = await Promise.all([
      this.ensureCommunityProfile(userId),
      this.loadOwnedProductMap(
        userId,
        dto.steps.map((step) => step.productId).filter(Boolean) as string[],
      ),
    ]);
    const stepSnapshots = dto.steps.map(
      (step, index): CommunityRoutineStepSnapshot => {
        const product = step.productId ? products.get(step.productId) : null;
        if (step.productId && !product) {
          throw new BadRequestException(
            'Routine step product must be on your shelf',
          );
        }
        if (!step.productId && !cleanText(step.productName, 255)) {
          throw new BadRequestException(
            'Goal playbook steps require product names or shelf products',
          );
        }
        return {
          stepOrder: index + 1,
          slot: step.slot,
          productId: product?.id ?? null,
          productBrand: product?.brand ?? cleanText(step.productBrand, 255),
          productName: product?.name ?? cleanText(step.productName, 255),
          category: product?.category ?? step.category,
          frequency: cleanText(step.frequency, 80),
          notes: cleanText(step.notes, 500),
        };
      },
    );
    const scannedText = [
      dto.title,
      dto.summary ?? '',
      dto.goalResult ?? '',
      dto.timeframe,
      ...dto.goalTags,
      ...normalizeTags(dto.avoidTags),
      ...normalizeTags(dto.habitTags),
      ...normalizeTags(dto.didNotWorkTags),
      ...normalizeTags(dto.warningTags),
      ...dto.steps.flatMap((step) => [
        step.productBrand ?? '',
        step.productName ?? '',
        step.notes ?? '',
      ]),
    ].join(' ');
    const flags = [
      ...this.safety.scanText(scannedText),
      ...this.safety.scanRoutine(stepSnapshots),
    ];
    this.safety.resolveStatus({
      disclosureType: dto.disclosureType,
      flags,
    });
    const moderation = await this.aiModeration.triage({
      contentType: CommunityContentType.Routine,
      disclosureType: dto.disclosureType,
      flags,
      text: scannedText,
    });
    const status = moderation.status;

    const created = await this.dataSource.transaction(async (manager) => {
      const routine = await manager.getRepository(CommunityRoutine).save(
        manager.getRepository(CommunityRoutine).create({
          author_user_id: userId,
          community_profile_id: profile.id,
          title: cleanText(dto.title, 120) ?? 'Shared routine',
          summary: cleanText(dto.summary, 500),
          concern_tags: normalizeTags(dto.concernTags),
          goal_tags: normalizeTags(dto.goalTags),
          goal_result: dto.goalResult ?? null,
          timeframe: dto.timeframe,
          avoid_tags: normalizeTags(dto.avoidTags),
          habit_tags: normalizeTags(dto.habitTags),
          did_not_work_tags: normalizeTags(dto.didNotWorkTags),
          warning_tags: normalizeTags(dto.warningTags),
          disclosure_type: dto.disclosureType,
          moderation_status: status,
          safe_facets: profile.safe_facets,
          safety_flags: flags,
        }),
      );
      await manager.getRepository(CommunityRoutineStep).save(
        stepSnapshots.map((step) =>
          manager.getRepository(CommunityRoutineStep).create({
            routine_id: routine.id,
            step_order: step.stepOrder,
            slot: step.slot,
            product_id: step.productId,
            product_brand: step.productBrand,
            product_name: step.productName,
            category: step.category,
            frequency: step.frequency,
            notes: step.notes,
          }),
        ),
      );
      await this.recordDecision(manager, {
        contentType: CommunityContentType.Routine,
        contentId: routine.id,
        actorAdminId: null,
        from: CommunityModerationStatus.Draft,
        to: status,
        reason: this.automationDecisionReason(moderation.automation),
      });
      await this.recordSafetyScan(manager, {
        contentType: CommunityContentType.Routine,
        contentId: routine.id,
        flags,
        status,
        scannedTextLength: scannedText.length,
        automation: moderation.automation,
      });
      return routine;
    });

    if (created.moderation_status === CommunityModerationStatus.NeedsEdit) {
      await this.notifyModerationOutcome(
        created,
        CommunityContentType.Routine,
        created.moderation_status,
      );
    }
    return this.getRoutine(userId, created.id);
  }

  async updateRoutine(
    userId: string,
    routineId: string,
    dto: EditCommunityRoutineDto,
  ) {
    await this.assertCanPostCommunityContent(userId);
    const routine = await this.routines.findOne({
      where: { id: routineId, author_user_id: userId },
    });
    if (!routine) throw new NotFoundException('Community routine not found');
    if (!USER_EDITABLE_MODERATION_STATUSES.has(routine.moderation_status)) {
      throw new BadRequestException(
        'Only draft, pending, or returned routines can be edited',
      );
    }

    routine.title = cleanText(dto.title, 120) ?? routine.title;
    routine.summary =
      dto.summary === undefined ? routine.summary : cleanText(dto.summary, 500);
    routine.disclosure_type = dto.disclosureType ?? routine.disclosure_type;
    routine.concern_tags =
      dto.concernTags === undefined
        ? routine.concern_tags
        : normalizeTags(dto.concernTags);
    routine.goal_tags =
      dto.goalTags === undefined ? routine.goal_tags : normalizeTags(dto.goalTags);
    routine.goal_result =
      dto.goalResult === undefined ? routine.goal_result : dto.goalResult;
    routine.timeframe =
      dto.timeframe === undefined ? routine.timeframe : dto.timeframe;
    routine.avoid_tags =
      dto.avoidTags === undefined ? routine.avoid_tags : normalizeTags(dto.avoidTags);
    routine.habit_tags =
      dto.habitTags === undefined ? routine.habit_tags : normalizeTags(dto.habitTags);
    routine.did_not_work_tags =
      dto.didNotWorkTags === undefined
        ? routine.did_not_work_tags
        : normalizeTags(dto.didNotWorkTags);
    routine.warning_tags =
      dto.warningTags === undefined
        ? routine.warning_tags
        : normalizeTags(dto.warningTags);

    const existingSteps = await this.routineSteps.find({
      where: { routine_id: routineId },
      order: { step_order: 'ASC' },
    });
    const stepSnapshots =
      dto.steps === undefined
        ? existingSteps.map((step) => ({
            stepOrder: step.step_order,
            slot: step.slot,
            productId: step.product_id,
            productBrand: step.product_brand,
            productName: step.product_name,
            category: step.category,
            frequency: step.frequency,
            notes: step.notes,
          }))
        : await this.buildRoutineStepSnapshots(userId, dto.steps);
    const scannedText = [
      routine.title,
      routine.summary ?? '',
      routine.goal_result ?? '',
      routine.timeframe ?? '',
      ...routine.goal_tags,
      ...routine.avoid_tags,
      ...routine.habit_tags,
      ...routine.did_not_work_tags,
      ...routine.warning_tags,
      ...stepSnapshots.flatMap((step) => [
        step.productBrand ?? '',
        step.productName ?? '',
        step.notes ?? '',
      ]),
    ].join(' ');
    const flags = [
      ...this.safety.scanText(scannedText),
      ...this.safety.scanRoutine(stepSnapshots),
    ];
    const from = routine.moderation_status;
    this.safety.resolveStatus({
      disclosureType: routine.disclosure_type,
      flags,
    });
    const moderation = await this.aiModeration.triage({
      contentType: CommunityContentType.Routine,
      disclosureType: routine.disclosure_type,
      flags,
      text: scannedText,
    });
    const status = moderation.status;
    routine.safety_flags = flags;
    routine.moderation_status = status;
    routine.assigned_admin_id =
      moderation.automation.handledBy === 'admin'
        ? routine.assigned_admin_id
        : null;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(CommunityRoutine).save(routine);
      if (dto.steps !== undefined) {
        await manager
          .getRepository(CommunityRoutineStep)
          .delete({ routine_id: routine.id });
        await manager.getRepository(CommunityRoutineStep).save(
          stepSnapshots.map((step) =>
            manager.getRepository(CommunityRoutineStep).create({
              routine_id: routine.id,
              step_order: step.stepOrder,
              slot: step.slot,
              product_id: step.productId,
              product_brand: step.productBrand,
              product_name: step.productName,
              category: step.category,
              frequency: step.frequency,
              notes: step.notes,
            }),
          ),
        );
      }
      await this.recordDecision(manager, {
        contentType: CommunityContentType.Routine,
        contentId: routine.id,
        actorAdminId: null,
        from,
        to: status,
        reason: `User edited routine. ${this.automationDecisionReason(moderation.automation)}`,
      });
      await this.recordSafetyScan(manager, {
        contentType: CommunityContentType.Routine,
        contentId: routine.id,
        flags,
        status,
        scannedTextLength: scannedText.length,
        automation: moderation.automation,
      });
    });
    await this.notifyModerationOutcome(
      routine,
      CommunityContentType.Routine,
      status,
    );
    return this.getRoutine(userId, routineId);
  }

  async listReviews(userId: string) {
    const facets = await this.getSafeFacets(userId);
    const rows = await this.reviews.find({
      where: { moderation_status: CommunityModerationStatus.Published },
      order: { updated_at: 'DESC' },
      take: DEFAULT_LIMIT,
    });
    const contextByReview = await this.loadReviewContext(
      rows.map((row) => row.id),
    );
    return {
      items: rows.map((review) =>
        this.toReviewResponse(
          review,
          contextByReview.get(review.id) ?? [],
          facets,
        ),
      ),
    };
  }

  async createReview(userId: string, dto: CreateCommunityReviewDto) {
    await this.assertCanPostCommunityContent(userId);
    await this.assertActionLimit({
      label: 'reviews',
      repository: this.reviews,
      userColumn: 'author_user_id',
      userId,
      maxPerDay: 10,
    });
    if (dto.outcomes.length === 0 || dto.routineContext.length === 0) {
      throw new BadRequestException(
        'Review requires outcomes and routine context',
      );
    }
    if (
      dto.routineContext.some(
        (item) => !item.productId && !cleanText(item.productName, 255),
      )
    ) {
      throw new BadRequestException(
        'Review routine context requires product names or shelf products',
      );
    }
    const profile = await this.ensureCommunityProfile(userId);
    const productIds = [
      ...(dto.productId ? [dto.productId] : []),
      ...dto.routineContext.map((item) => item.productId).filter(Boolean),
    ] as string[];
    const products = await this.loadOwnedProductMap(userId, productIds);
    if (dto.productId && !products.has(dto.productId)) {
      throw new BadRequestException('Reviewed product must be on your shelf');
    }
    const reviewedProduct = dto.productId ? products.get(dto.productId) : null;
    const contextText = dto.routineContext
      .map((item) => [item.productBrand, item.productName, item.category].filter(Boolean).join(' '))
      .join(' ');
    const scannedText = [
      dto.productBrand,
      dto.productName,
      dto.skinResponse,
      dto.outcomes.join(' '),
      contextText,
      dto.body ?? '',
    ].join(' ');
    const flags = this.safety.scanText(scannedText);
    this.safety.resolveStatus({
      disclosureType: dto.disclosureType,
      flags,
    });
    const moderation = await this.aiModeration.triage({
      contentType: CommunityContentType.Review,
      disclosureType: dto.disclosureType,
      flags,
      text: scannedText,
    });
    const status = moderation.status;

    const created = await this.dataSource.transaction(async (manager) => {
      const review = await manager.getRepository(CommunityReview).save(
        manager.getRepository(CommunityReview).create({
          author_user_id: userId,
          community_profile_id: profile.id,
          product_id: reviewedProduct?.id ?? dto.productId ?? null,
          product_brand:
            reviewedProduct?.brand ??
            cleanText(dto.productBrand, 255) ??
            'Unknown brand',
          product_name:
            reviewedProduct?.name ??
            cleanText(dto.productName, 255) ??
            'Unknown product',
          product_category: reviewedProduct?.category ?? dto.productCategory,
          disclosure_type: dto.disclosureType,
          usage_duration: cleanText(dto.usageDuration, 30) ?? 'unspecified',
          frequency: cleanText(dto.frequency, 50) ?? 'unspecified',
          routine_slot: dto.routineSlot,
          skin_response: dto.skinResponse,
          overall_rating: dto.overallRating,
          effectiveness_rating: dto.effectivenessRating,
          irritation_rating: dto.irritationRating,
          texture_rating: dto.textureRating ?? null,
          value_rating: dto.valueRating ?? null,
          outcomes: normalizeTags(dto.outcomes),
          repurchase: cleanText(dto.repurchase, 30) ?? 'unsure',
          body: cleanText(dto.body, 1200),
          moderation_status: status,
          safe_facets: profile.safe_facets,
          safety_flags: flags,
        }),
      );
      await manager.getRepository(CommunityReviewContextProduct).save(
        dto.routineContext.map((item) => {
          const product = item.productId ? products.get(item.productId) : null;
          if (item.productId && !product) {
            throw new BadRequestException(
              'Routine context products must be on your shelf',
            );
          }
          return manager.getRepository(CommunityReviewContextProduct).create({
            review_id: review.id,
            product_id: product?.id ?? null,
            product_brand: product?.brand ?? cleanText(item.productBrand, 255),
            product_name: product?.name ?? cleanText(item.productName, 255),
            category: product?.category ?? item.category,
          });
        }),
      );
      await this.recordDecision(manager, {
        contentType: CommunityContentType.Review,
        contentId: review.id,
        actorAdminId: null,
        from: CommunityModerationStatus.Draft,
        to: status,
        reason: this.automationDecisionReason(moderation.automation),
      });
      await this.recordSafetyScan(manager, {
        contentType: CommunityContentType.Review,
        contentId: review.id,
        flags,
        status,
        scannedTextLength: scannedText.length,
        automation: moderation.automation,
      });
      return review;
    });

    if (created.moderation_status === CommunityModerationStatus.NeedsEdit) {
      await this.notifyModerationOutcome(
        created,
        CommunityContentType.Review,
        created.moderation_status,
      );
    }
    return {
      item: created,
      moderationStatus: created.moderation_status,
      safetyFlags: created.safety_flags,
    };
  }

  async updateReview(
    userId: string,
    reviewId: string,
    dto: EditCommunityReviewDto,
  ) {
    await this.assertCanPostCommunityContent(userId);
    const review = await this.reviews.findOne({
      where: { id: reviewId, author_user_id: userId },
    });
    if (!review) throw new NotFoundException('Community review not found');
    if (!USER_EDITABLE_MODERATION_STATUSES.has(review.moderation_status)) {
      throw new BadRequestException(
        'Only draft, pending, or returned reviews can be edited',
      );
    }

    const productIds = [
      ...(dto.productId ? [dto.productId] : []),
      ...(dto.routineContext ?? [])
        .map((item) => item.productId)
        .filter(Boolean),
    ] as string[];
    const products = await this.loadOwnedProductMap(userId, productIds);
    if (dto.productId && !products.has(dto.productId)) {
      throw new BadRequestException('Reviewed product must be on your shelf');
    }
    const reviewedProduct = dto.productId ? products.get(dto.productId) : null;
    if (dto.routineContext) {
      if (
        dto.routineContext.some(
          (item) => !item.productId && !cleanText(item.productName, 255),
        )
      ) {
        throw new BadRequestException(
          'Review routine context requires product names or shelf products',
        );
      }
      for (const item of dto.routineContext) {
        if (item.productId && !products.has(item.productId)) {
          throw new BadRequestException(
            'Routine context products must be on your shelf',
          );
        }
      }
    }

    review.product_id =
      dto.productId === undefined ? review.product_id : reviewedProduct?.id ?? null;
    review.product_brand =
      reviewedProduct?.brand ??
      (dto.productBrand === undefined
        ? review.product_brand
        : cleanText(dto.productBrand, 255) ?? review.product_brand);
    review.product_name =
      reviewedProduct?.name ??
      (dto.productName === undefined
        ? review.product_name
        : cleanText(dto.productName, 255) ?? review.product_name);
    review.product_category =
      reviewedProduct?.category ??
      (dto.productCategory === undefined
        ? review.product_category
        : dto.productCategory);
    review.disclosure_type = dto.disclosureType ?? review.disclosure_type;
    review.usage_duration =
      dto.usageDuration === undefined
        ? review.usage_duration
        : cleanText(dto.usageDuration, 30) ?? review.usage_duration;
    review.frequency =
      dto.frequency === undefined
        ? review.frequency
        : cleanText(dto.frequency, 50) ?? review.frequency;
    review.routine_slot = dto.routineSlot ?? review.routine_slot;
    review.skin_response = dto.skinResponse ?? review.skin_response;
    review.overall_rating = dto.overallRating ?? review.overall_rating;
    review.effectiveness_rating =
      dto.effectivenessRating ?? review.effectiveness_rating;
    review.irritation_rating = dto.irritationRating ?? review.irritation_rating;
    review.texture_rating =
      dto.textureRating === undefined ? review.texture_rating : dto.textureRating;
    review.value_rating =
      dto.valueRating === undefined ? review.value_rating : dto.valueRating;
    review.outcomes =
      dto.outcomes === undefined ? review.outcomes : normalizeTags(dto.outcomes);
    review.repurchase =
      dto.repurchase === undefined
        ? review.repurchase
        : cleanText(dto.repurchase, 30) ?? review.repurchase;
    review.body =
      dto.body === undefined ? review.body : cleanText(dto.body, 1200);
    const contextForScan = dto.routineContext
      ? dto.routineContext.map((item) => {
          const product = item.productId ? products.get(item.productId) : null;
          return [
            product?.brand ?? item.productBrand,
            product?.name ?? item.productName,
            product?.category ?? item.category,
          ]
            .filter(Boolean)
            .join(' ');
        })
      : await this.reviewContext.find({ where: { review_id: reviewId } });
    const scannedText = [
      review.product_brand,
      review.product_name,
      review.skin_response ?? '',
      review.outcomes.join(' '),
      ...contextForScan.map((item) =>
        typeof item === 'string'
          ? item
          : [item.product_brand, item.product_name, item.category]
              .filter(Boolean)
              .join(' '),
      ),
      review.body ?? '',
    ].join(' ');
    const flags = this.safety.scanText(scannedText);
    const from = review.moderation_status;
    this.safety.resolveStatus({
      disclosureType: review.disclosure_type,
      flags,
    });
    const moderation = await this.aiModeration.triage({
      contentType: CommunityContentType.Review,
      disclosureType: review.disclosure_type,
      flags,
      text: scannedText,
    });
    const status = moderation.status;
    review.safety_flags = flags;
    review.moderation_status = status;
    review.assigned_admin_id =
      moderation.automation.handledBy === 'admin'
        ? review.assigned_admin_id
        : null;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(CommunityReview).save(review);
      if (dto.routineContext !== undefined) {
        await manager
          .getRepository(CommunityReviewContextProduct)
          .delete({ review_id: review.id });
        await manager.getRepository(CommunityReviewContextProduct).save(
          dto.routineContext.map((item) => {
            const product = item.productId ? products.get(item.productId) : null;
            return manager
              .getRepository(CommunityReviewContextProduct)
              .create({
                review_id: review.id,
                product_id: product?.id ?? null,
                product_brand:
                  product?.brand ?? cleanText(item.productBrand, 255),
                product_name: product?.name ?? cleanText(item.productName, 255),
                category: product?.category ?? item.category,
              });
          }),
        );
      }
      await this.recordDecision(manager, {
        contentType: CommunityContentType.Review,
        contentId: review.id,
        actorAdminId: null,
        from,
        to: status,
        reason: `User edited review. ${this.automationDecisionReason(moderation.automation)}`,
      });
      await this.recordSafetyScan(manager, {
        contentType: CommunityContentType.Review,
        contentId: review.id,
        flags,
        status,
        scannedTextLength: scannedText.length,
        automation: moderation.automation,
      });
    });
    await this.notifyModerationOutcome(
      review,
      CommunityContentType.Review,
      status,
    );
    return this.toReviewResponse(
      review,
      await this.reviewContext.find({ where: { review_id: reviewId } }),
      await this.getSafeFacets(userId),
    );
  }

  async reportRoutine(
    userId: string,
    routineId: string,
    dto: CreateCommunityReportDto,
  ) {
    const routine = await this.routines.findOne({ where: { id: routineId } });
    if (!routine) {
      throw new NotFoundException('Community routine not found');
    }
    if (routine.author_user_id === userId) {
      throw new ForbiddenException('You cannot report your own content');
    }
    if (routine.moderation_status !== CommunityModerationStatus.Published) {
      const existingReport = await this.findActiveReport(
        userId,
        CommunityContentType.Routine,
        routineId,
      );
      if (existingReport) {
        return this.toReportResponse(existingReport);
      }
      throw new NotFoundException('Community routine not found');
    }
    return this.createReport(
      userId,
      CommunityContentType.Routine,
      routineId,
      dto,
    );
  }

  async reportReview(
    userId: string,
    reviewId: string,
    dto: CreateCommunityReportDto,
  ) {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) {
      throw new NotFoundException('Community review not found');
    }
    if (review.author_user_id === userId) {
      throw new ForbiddenException('You cannot report your own content');
    }
    if (review.moderation_status !== CommunityModerationStatus.Published) {
      const existingReport = await this.findActiveReport(
        userId,
        CommunityContentType.Review,
        reviewId,
      );
      if (existingReport) {
        return this.toReportResponse(existingReport);
      }
      throw new NotFoundException('Community review not found');
    }
    return this.createReport(
      userId,
      CommunityContentType.Review,
      reviewId,
      dto,
    );
  }

  async voteRoutine(
    userId: string,
    routineId: string,
    dto: CommunityHelpfulnessDto,
  ) {
    await this.assertActionLimit({
      label: 'helpfulness votes',
      repository: this.votes,
      userColumn: 'user_id',
      userId,
      maxPerDay: 120,
    });
    const routine = await this.routines.findOne({ where: { id: routineId } });
    if (
      !routine ||
      routine.moderation_status !== CommunityModerationStatus.Published
    ) {
      throw new NotFoundException('Community routine not found');
    }
    if (routine.author_user_id === userId) {
      throw new ForbiddenException('You cannot vote on your own content');
    }
    return this.vote(userId, CommunityContentType.Routine, routineId, dto.vote);
  }

  async voteReview(
    userId: string,
    reviewId: string,
    dto: CommunityHelpfulnessDto,
  ) {
    await this.assertActionLimit({
      label: 'helpfulness votes',
      repository: this.votes,
      userColumn: 'user_id',
      userId,
      maxPerDay: 120,
    });
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (
      !review ||
      review.moderation_status !== CommunityModerationStatus.Published
    ) {
      throw new NotFoundException('Community review not found');
    }
    if (review.author_user_id === userId) {
      throw new ForbiddenException('You cannot vote on your own content');
    }
    return this.vote(userId, CommunityContentType.Review, reviewId, dto.vote);
  }

  async signalRoutineOutcome(
    userId: string,
    routineId: string,
    dto: CommunityOutcomeSignalDto,
  ) {
    await this.assertActionLimit({
      label: 'community outcome signals',
      repository: this.outcomeVotes,
      userColumn: 'user_id',
      userId,
      maxPerDay: 120,
    });
    const routine = await this.routines.findOne({ where: { id: routineId } });
    if (
      !routine ||
      routine.moderation_status !== CommunityModerationStatus.Published
    ) {
      throw new NotFoundException('Community routine not found');
    }
    if (routine.author_user_id === userId) {
      throw new ForbiddenException('You cannot signal your own content');
    }
    return this.signalOutcome(
      userId,
      CommunityContentType.Routine,
      routineId,
      dto,
    );
  }

  async signalReviewOutcome(
    userId: string,
    reviewId: string,
    dto: CommunityOutcomeSignalDto,
  ) {
    await this.assertActionLimit({
      label: 'community outcome signals',
      repository: this.outcomeVotes,
      userColumn: 'user_id',
      userId,
      maxPerDay: 120,
    });
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (
      !review ||
      review.moderation_status !== CommunityModerationStatus.Published
    ) {
      throw new NotFoundException('Community review not found');
    }
    if (review.author_user_id === userId) {
      throw new ForbiddenException('You cannot signal your own content');
    }
    return this.signalOutcome(
      userId,
      CommunityContentType.Review,
      reviewId,
      dto,
    );
  }

  async adaptRoutine(userId: string, routineId: string) {
    const routine = await this.routines.findOne({ where: { id: routineId } });
    if (
      !routine ||
      !this.canRead(routine, userId)
    ) {
      throw new NotFoundException('Community routine not found');
    }
    const steps = await this.routineSteps.find({
      where: { routine_id: routineId },
      order: { step_order: 'ASC' },
    });
    const owned = await this.inventory.find({ where: { user_id: userId } });
    const profile = await this.skinProfiles.findOne({
      where: { user_id: userId },
    });
    const reactionTriggers = (profile?.reaction_history?.entries ?? [])
      .map((entry) => entry.trigger.trim().toLowerCase())
      .filter(Boolean);
    const routinePreferences = profile?.routine_preferences ?? {};
    const activeTolerances = profile?.active_tolerances ?? {};
    const usedTargetIds = new Set<string>();
    const changes: CommunityAdaptationChange[] = [];

    for (const step of steps) {
      const profileRemovalReason = this.stepRemovalReasonForProfile(
        step,
        profile,
        routinePreferences,
        activeTolerances,
      );
      if (profileRemovalReason) {
        changes.push({
          changeType: CommunityAdaptationChangeType.Removed,
          stepOrder: step.step_order,
          sourceProductName: step.product_name,
          sourceProductBrand: step.product_brand,
          targetProductId: null,
          targetProductName: null,
          targetProductBrand: null,
          category: step.category,
          reason: profileRemovalReason,
        });
        continue;
      }
      const exact = step.product_id
        ? owned.find((product) => product.id === step.product_id)
        : null;
      const similar = owned.find(
        (product) =>
          !usedTargetIds.has(product.id) &&
          this.productCompatibleForStep(product, step, routinePreferences) &&
          !this.productMatchesReactionTrigger(product, reactionTriggers) &&
          (!exact || product.id !== exact.id),
      );
      const unsafe = routine.safety_flags.some(
        (flag) => flag.severity === CommunitySafetySeverity.High,
      );
      if (unsafe && ['exfoliant', 'treatment'].includes(step.category)) {
        changes.push({
          changeType: CommunityAdaptationChangeType.Removed,
          stepOrder: step.step_order,
          sourceProductName: step.product_name,
          sourceProductBrand: step.product_brand,
          targetProductId: null,
          targetProductName: null,
          targetProductBrand: null,
          category: step.category,
          reason:
            'Removed because the shared routine has a high-risk active safety flag.',
        });
        continue;
      }

      const safeExact =
        exact &&
        this.productCompatibleForStep(exact, step, routinePreferences) &&
        !this.productMatchesReactionTrigger(exact, reactionTriggers)
          ? exact
          : null;
      const target = safeExact ?? similar ?? null;
      if (target) usedTargetIds.add(target.id);
      changes.push({
        changeType: safeExact
          ? CommunityAdaptationChangeType.Kept
          : target
            ? CommunityAdaptationChangeType.Swapped
            : CommunityAdaptationChangeType.Gap,
        stepOrder: step.step_order,
        sourceProductName: step.product_name,
        sourceProductBrand: step.product_brand,
        targetProductId: target?.id ?? null,
        targetProductName: target?.name ?? null,
        targetProductBrand: target?.brand ?? null,
        category: step.category,
        reason: safeExact
          ? 'Exact product found on your shelf.'
          : target
            ? this.adaptationSwapReason(step, target)
            : 'No safe owned product matched this step; treat it as an honest category gap.',
      });
    }

    const saved = await this.adaptations.save(
      this.adaptations.create({
        user_id: userId,
        routine_id: routineId,
        changes,
        saved: false,
      }),
    );
    return {
      id: saved.id,
      routineId,
      changes,
      summary: {
        kept: changes.filter(
          (item) => item.changeType === CommunityAdaptationChangeType.Kept,
        ).length,
        swapped: changes.filter(
          (item) => item.changeType === CommunityAdaptationChangeType.Swapped,
        ).length,
        removed: changes.filter(
          (item) => item.changeType === CommunityAdaptationChangeType.Removed,
        ).length,
        gaps: changes.filter(
          (item) => item.changeType === CommunityAdaptationChangeType.Gap,
        ).length,
      },
    };
  }

  async saveAdaptation(
    userId: string,
    routineId: string,
    adaptationId: string,
  ) {
    const adaptation = await this.adaptations.findOne({
      where: { id: adaptationId, user_id: userId, routine_id: routineId },
    });
    if (!adaptation)
      throw new NotFoundException('Community adaptation not found');
    adaptation.saved = true;
    await this.adaptations.save(adaptation);
    return { saved: true };
  }

  async listMySubmissions(userId: string) {
    const [routines, reviews] = await Promise.all([
      this.routines.find({
        where: { author_user_id: userId, withdrawn_at: IsNull() },
        order: { updated_at: 'DESC' },
        take: DEFAULT_LIMIT,
      }),
      this.reviews.find({
        where: { author_user_id: userId, withdrawn_at: IsNull() },
        order: { updated_at: 'DESC' },
        take: DEFAULT_LIMIT,
      }),
    ]);
    const [stepsByRoutine, contextByReview] = await Promise.all([
      this.loadSteps(routines.map((item) => item.id)),
      this.loadReviewContext(reviews.map((item) => item.id)),
    ]);
    return {
      items: [
        ...routines.map((item) =>
          this.toSubmissionItem(
            CommunityContentType.Routine,
            item,
            stepsByRoutine.get(item.id) ?? [],
          ),
        ),
        ...reviews.map((item) =>
          this.toSubmissionItem(
            CommunityContentType.Review,
            item,
            contextByReview.get(item.id) ?? [],
          ),
        ),
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async withdrawContent(userId: string, contentId: string) {
    const content = await this.findContent(contentId);
    if (content.item.author_user_id !== userId) {
      throw new NotFoundException('Community content not found');
    }
    if (content.item.withdrawn_at) {
      return { deleted: true };
    }

    const from = content.item.moderation_status;
    content.item.moderation_status = CommunityModerationStatus.Hidden;
    content.item.assigned_admin_id = null;
    content.item.withdrawn_at = new Date();
    content.item.withdrawn_by_user_id = userId;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(content.entity).save(content.item);
      await this.recordDecision(manager, {
        contentType: content.type,
        contentId,
        actorAdminId: null,
        from,
        to: CommunityModerationStatus.Hidden,
        reason:
          'User withdrew community content. Removed from public evidence and matching.',
      });
    });

    return { deleted: true };
  }

  async resubmitContent(userId: string, contentId: string) {
    await this.assertCanPostCommunityContent(userId);
    const content = await this.findContent(contentId);
    if (content.item.author_user_id !== userId) {
      throw new NotFoundException('Community content not found');
    }
    if (
      content.item.moderation_status !== CommunityModerationStatus.NeedsEdit &&
      content.item.moderation_status !== CommunityModerationStatus.Rejected
    ) {
      throw new BadRequestException(
        'Only content needing edits can be resubmitted',
      );
    }
    const scannedText =
      content.type === CommunityContentType.Routine
        ? (() => {
            const routine = content.item as CommunityRoutine;
            return [routine.title, routine.summary ?? ''].join(' ');
          })()
        : [
            (content.item as CommunityReview).product_brand,
            (content.item as CommunityReview).product_name,
            (content.item as CommunityReview).body ?? '',
          ].join(' ');
    const scannedFlags =
      content.type === CommunityContentType.Routine
        ? [
            ...this.safety.scanText(scannedText),
            ...this.safety.scanRoutine(
              (
                await this.routineSteps.find({
                  where: { routine_id: contentId },
                  order: { step_order: 'ASC' },
                })
              ).map((step) => ({
                stepOrder: step.step_order,
                slot: step.slot,
                productId: step.product_id,
                productBrand: step.product_brand,
                productName: step.product_name,
                category: step.category,
                frequency: step.frequency,
                notes: step.notes,
              })),
            ),
          ]
        : this.safety.scanText(scannedText);
    this.safety.resolveStatus({
      disclosureType: content.item.disclosure_type,
      flags: scannedFlags,
    });
    const moderation = await this.aiModeration.triage({
      contentType: content.type,
      disclosureType: content.item.disclosure_type,
      flags: scannedFlags,
      text: scannedText,
    });
    const status = moderation.status;
    const from = content.item.moderation_status;
    content.item.safety_flags = scannedFlags;
    content.item.moderation_status = status;
    content.item.assigned_admin_id =
      moderation.automation.handledBy === 'admin'
        ? content.item.assigned_admin_id
        : null;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(content.entity).save(content.item);
      await this.recordDecision(manager, {
        contentType: content.type,
        contentId,
        actorAdminId: null,
        from,
        to: status,
        reason: `User resubmitted content. ${this.automationDecisionReason(moderation.automation)}`,
      });
      await this.recordSafetyScan(manager, {
        contentType: content.type,
        contentId,
        flags: scannedFlags,
        status,
        scannedTextLength: scannedText.length,
        automation: moderation.automation,
      });
    });
    await this.notifyModerationOutcome(content.item, content.type, status);
    return this.toAdminContentItem(content.type, content.item);
  }

  listWarnings() {
    return this.warnings.find({
      where: { active: true },
      order: { updated_at: 'DESC' },
      take: DEFAULT_LIMIT,
    });
  }

  async listAdminModeration(query: AdminCommunityModerationQueryDto) {
    const statuses = query.status
      ? [query.status]
      : [
          CommunityModerationStatus.PendingReview,
          CommunityModerationStatus.Hidden,
        ];
    const [routines, reviews] = await Promise.all([
      !query.contentType || query.contentType === CommunityContentType.Routine
        ? this.queryAdminModerationRows(
            this.routines,
            CommunityContentType.Routine,
            statuses,
            query,
          )
        : [],
      !query.contentType || query.contentType === CommunityContentType.Review
        ? this.queryAdminModerationRows(
            this.reviews,
            CommunityContentType.Review,
            statuses,
            query,
          )
        : [],
    ]);
    const items = [
      ...routines.map((item) =>
        this.toAdminContentItem(CommunityContentType.Routine, item),
      ),
      ...reviews.map((item) =>
        this.toAdminContentItem(CommunityContentType.Review, item),
      ),
    ];
    return {
      items: items
        .filter((item) => this.matchesAdminModerationFilters(item, query))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    };
  }

  async listAdminReports() {
    const rows = await this.reports.find({
      where: { status: CommunityReportStatus.Open },
      order: { created_at: 'DESC' },
      take: DEFAULT_LIMIT,
    });
    return { reports: rows.map((report) => this.toReportResponse(report)) };
  }

  async getCommunitySettings() {
    const settings = await this.communitySettings.findOne({
      where: { id: COMMUNITY_SETTINGS_ID },
    });
    return this.toCommunitySettingsResponse(settings);
  }

  async updateCommunitySettings(
    adminId: string,
    dto: AdminCommunitySettingsDto,
    context?: AdminCommunityAuditContext,
  ) {
    const settings =
      (await this.communitySettings.findOne({
        where: { id: COMMUNITY_SETTINGS_ID },
      })) ??
      this.communitySettings.create({
        id: COMMUNITY_SETTINGS_ID,
        minimum_account_age_days: DEFAULT_COMMUNITY_MIN_ACCOUNT_AGE_DAYS,
      });
    const previousMinimumAccountAgeDays = settings.minimum_account_age_days;
    settings.minimum_account_age_days = dto.minimumAccountAgeDays;
    settings.updated_by_admin_id = adminId;
    const saved = await this.communitySettings.save(settings);

    await this.writeCommunityAuditLog({
      action: AdminAuditAction.CommunitySettingsUpdated,
      actorAdminId: adminId,
      contentId: COMMUNITY_SETTINGS_ID,
      contentType: 'settings',
      context,
      reason: cleanText(dto.reason, 500) ?? 'Community settings updated',
      targetUserId: null,
      metadata: {
        minimumAccountAgeDays: saved.minimum_account_age_days,
        previousMinimumAccountAgeDays,
      },
    });

    return this.toCommunitySettingsResponse(saved);
  }

  async updateAdminReportStatus(
    adminId: string,
    reportId: string,
    dto: AdminCommunityReportStatusDto,
    context?: AdminCommunityAuditContext,
  ) {
    const report = await this.reports.findOne({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Community report not found');
    report.status = dto.status;
    const saved = await this.reports.save(report);
    await this.decisions.save(
      this.decisions.create({
        content_type: report.content_type,
        content_id: report.content_id,
        actor_admin_id: adminId,
        from_status: CommunityModerationStatus.PendingReview,
        to_status: CommunityModerationStatus.PendingReview,
        reason: cleanText(dto.reason, 500) ?? `Report marked ${dto.status}`,
      }),
    );
    await this.writeCommunityAuditLog({
      action: AdminAuditAction.CommunityReportUpdated,
      actorAdminId: adminId,
      contentId: report.content_id,
      contentType: report.content_type,
      context,
      reason: cleanText(dto.reason, 500) ?? `Report marked ${dto.status}`,
      targetUserId: null,
    });
    return this.toReportResponse(saved);
  }

  async moderateContent(
    adminId: string,
    contentId: string,
    dto: AdminCommunityModerationDto,
    context?: AdminCommunityAuditContext,
  ) {
    const content = await this.findContent(contentId);
    const from = content.item.moderation_status;
    content.item.moderation_status = dto.status;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(content.entity).save(content.item);
      await this.recordDecision(manager, {
        contentType: content.type,
        contentId,
        actorAdminId: adminId,
        from,
        to: dto.status,
        reason: cleanText(dto.reason, 500) ?? 'Community moderation update',
      });
    });
    await this.writeCommunityAuditLog({
      action: AdminAuditAction.CommunityContentModerated,
      actorAdminId: adminId,
      contentId,
      contentType: content.type,
      context,
      reason: cleanText(dto.reason, 500) ?? 'Community moderation update',
      targetUserId: content.item.author_user_id,
    });
    await this.notifyModerationOutcome(content.item, content.type, dto.status);
    return this.toAdminContentItem(content.type, content.item);
  }

  async assignContent(
    adminId: string,
    contentId: string,
    dto: AdminCommunityAssignDto,
    context?: AdminCommunityAuditContext,
  ) {
    const content = await this.findContent(contentId);
    const assignedAdminId = dto.assignedAdminId ?? adminId;
    content.item.assigned_admin_id = assignedAdminId;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(content.entity).save(content.item);
      await this.recordDecision(manager, {
        contentType: content.type,
        contentId,
        actorAdminId: adminId,
        from: content.item.moderation_status,
        to: content.item.moderation_status,
        reason:
          cleanText(dto.reason, 500) ?? 'Community moderation item assigned',
      });
    });
    await this.writeCommunityAuditLog({
      action: AdminAuditAction.CommunityContentModerated,
      actorAdminId: adminId,
      contentId,
      contentType: content.type,
      context,
      reason:
        cleanText(dto.reason, 500) ?? 'Community moderation item assigned',
      targetUserId: content.item.author_user_id,
    });
    return this.toAdminContentItem(content.type, content.item);
  }

  async addAdminNote(
    adminId: string,
    contentId: string,
    note: string,
    context?: AdminCommunityAuditContext,
  ) {
    const content = await this.findContent(contentId);
    await this.decisions.save(
      this.decisions.create({
        content_type: content.type,
        content_id: contentId,
        actor_admin_id: adminId,
        from_status: content.item.moderation_status,
        to_status: content.item.moderation_status,
        reason: cleanText(note, 500) ?? 'Admin note',
      }),
    );
    await this.writeCommunityAuditLog({
      action: AdminAuditAction.CommunityContentModerated,
      actorAdminId: adminId,
      contentId,
      contentType: content.type,
      context,
      reason: cleanText(note, 500) ?? 'Admin note',
      targetUserId: content.item.author_user_id,
    });
    return { created: true };
  }

  async createWarning(
    dto: AdminCommunityWarningDto,
    adminId?: string,
    context?: AdminCommunityAuditContext,
  ) {
    const warning = await this.warnings.save(
      this.warnings.create({
        title: cleanText(dto.title, 160) ?? 'Community warning',
        body: cleanText(dto.body, 1000) ?? 'Community warning',
        severity: dto.severity,
        affected_facets: normalizeTags(dto.affectedFacets),
        active: dto.active ?? true,
      }),
    );
    if (adminId) {
      await this.writeCommunityAuditLog({
        action: AdminAuditAction.CommunityWarningUpdated,
        actorAdminId: adminId,
        contentId: warning.id,
        contentType: 'warning',
        context,
        reason: 'Community warning created',
        targetUserId: null,
      });
    }
    return warning;
  }

  async updateWarning(
    id: string,
    dto: AdminCommunityWarningDto,
    adminId?: string,
    context?: AdminCommunityAuditContext,
  ) {
    const warning = await this.warnings.findOne({ where: { id } });
    if (!warning) throw new NotFoundException('Community warning not found');
    warning.title = cleanText(dto.title, 160) ?? warning.title;
    warning.body = cleanText(dto.body, 1000) ?? warning.body;
    warning.severity = dto.severity;
    warning.affected_facets = normalizeTags(dto.affectedFacets);
    warning.active = dto.active ?? warning.active;
    const saved = await this.warnings.save(warning);
    if (adminId) {
      await this.writeCommunityAuditLog({
        action: AdminAuditAction.CommunityWarningUpdated,
        actorAdminId: adminId,
        contentId: saved.id,
        contentType: 'warning',
        context,
        reason: 'Community warning updated',
        targetUserId: null,
      });
    }
    return saved;
  }

  private async ensureCommunityProfile(
    userId: string,
  ): Promise<CommunityProfile> {
    const existing = await this.profiles.findOne({
      where: { user_id: userId },
    });
    const safe_facets = await this.getSafeFacets(userId);
    if (existing) {
      existing.safe_facets = safe_facets;
      return this.profiles.save(existing);
    }
    return this.profiles.save(
      this.profiles.create({
        user_id: userId,
        display_name: publicProfileName(userId),
        safe_facets,
      }),
    );
  }

  private async getSafeFacets(
    userId: string,
  ): Promise<CommunitySafeProfileFacets> {
    const profile = await this.skinProfiles.findOne({
      where: { user_id: userId },
    });
    return buildCommunitySafeFacets(profile);
  }

  private async assertCanPostCommunityContent(userId: string) {
    const eligibility = await this.getPostingEligibility(userId);
    if (!eligibility.eligible) {
      throw new ForbiddenException({
        message: 'Community posting is not available yet',
        reasons: eligibility.reasons,
        eligibleAt: eligibility.eligibleAt,
      });
    }
  }

  private findActiveConsent(userId: string, consentType: UserConsentType) {
    return this.consents.findOne({
      where: {
        user_id: userId,
        consent_type: consentType,
        consent_version: COMMUNITY_GUIDELINES_VERSION,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
  }

  private async hasRecentModerationAbuse(userId: string): Promise<boolean> {
    const since = new Date(
      Date.now() - COMMUNITY_ABUSE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const [statusCount, severeReportRows] = await Promise.all([
      Promise.all([
        this.routines.count({
          where: {
            author_user_id: userId,
            moderation_status: In([
              CommunityModerationStatus.Hidden,
              CommunityModerationStatus.Rejected,
            ]),
            updated_at: MoreThan(since),
          },
        }),
        this.reviews.count({
          where: {
            author_user_id: userId,
            moderation_status: In([
              CommunityModerationStatus.Hidden,
              CommunityModerationStatus.Rejected,
            ]),
            updated_at: MoreThan(since),
          },
        }),
      ]),
      this.dataSource.query<Array<{ count: number | string }>>(
        `
          SELECT COUNT(*)::int AS count
          FROM "community_reports" report
          LEFT JOIN "community_routines" routine
            ON report."content_type" = $1
           AND report."content_id" = routine."id"
          LEFT JOIN "community_reviews" review
            ON report."content_type" = $2
           AND report."content_id" = review."id"
          WHERE report."reason" = ANY($3::varchar[])
            AND report."created_at" > $4
            AND (
              routine."author_user_id" = $5
              OR review."author_user_id" = $5
            )
        `,
        [
          CommunityContentType.Routine,
          CommunityContentType.Review,
          [...SEVERE_REPORT_REASONS],
          since,
          userId,
        ],
      ),
    ]);
    if (statusCount[0] + statusCount[1] >= COMMUNITY_ABUSE_STATUS_THRESHOLD) {
      return true;
    }

    const severeReportCount = Number(severeReportRows[0]?.count ?? 0);
    return severeReportCount >= COMMUNITY_ABUSE_SEVERE_REPORT_THRESHOLD;
  }

  private resolveClimateBucket(values: string[] | undefined): string | null {
    const first = normalizeTags(values ?? [])[0];
    return first ?? null;
  }

  private async loadOwnedProductMap(userId: string, ids: string[]) {
    if (ids.length === 0) return new Map<string, InventoryProduct>();
    const rows = await this.inventory.find({
      where: { user_id: userId, id: In(ids) },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async buildRoutineStepSnapshots(
    userId: string,
    steps: CreateCommunityRoutineDto['steps'],
  ): Promise<CommunityRoutineStepSnapshot[]> {
    const products = await this.loadOwnedProductMap(
      userId,
      steps.map((step) => step.productId).filter(Boolean) as string[],
    );
    return steps.map((step, index): CommunityRoutineStepSnapshot => {
      const product = step.productId ? products.get(step.productId) : null;
      if (step.productId && !product) {
        throw new BadRequestException(
          'Routine step product must be on your shelf',
        );
      }
      if (!step.productId && !cleanText(step.productName, 255)) {
        throw new BadRequestException(
          'Goal playbook steps require product names or shelf products',
        );
      }
      return {
        stepOrder: index + 1,
        slot: step.slot,
        productId: product?.id ?? null,
        productBrand: product?.brand ?? cleanText(step.productBrand, 255),
        productName: product?.name ?? cleanText(step.productName, 255),
        category: product?.category ?? step.category,
        frequency: cleanText(step.frequency, 80),
        notes: cleanText(step.notes, 500),
      };
    });
  }

  private async loadSteps(ids: string[]) {
    if (ids.length === 0) return new Map<string, CommunityRoutineStep[]>();
    const rows = await this.routineSteps.find({
      where: { routine_id: In(ids) },
      order: { step_order: 'ASC' },
    });
    const map = new Map<string, CommunityRoutineStep[]>();
    for (const row of rows) {
      map.set(row.routine_id, [...(map.get(row.routine_id) ?? []), row]);
    }
    return map;
  }

  private async loadReviewContext(ids: string[]) {
    if (ids.length === 0)
      return new Map<string, CommunityReviewContextProduct[]>();
    const rows = await this.reviewContext.find({
      where: { review_id: In(ids) },
    });
    const map = new Map<string, CommunityReviewContextProduct[]>();
    for (const row of rows) {
      map.set(row.review_id, [...(map.get(row.review_id) ?? []), row]);
    }
    return map;
  }

  private matchScore(
    viewer: CommunitySafeProfileFacets,
    item: CommunitySafeProfileFacets,
    tags: string[],
    disclosureType: CommunityDisclosureType,
    evidenceBoost = 0,
  ) {
    let score = evidenceBoost;
    if (viewer.skinType && viewer.skinType === item.skinType) score += 25;
    if (
      viewer.sensitivityLevel &&
      viewer.sensitivityLevel === item.sensitivityLevel
    )
      score += 15;
    if (viewer.skinToneRange && viewer.skinToneRange === item.skinToneRange)
      score += 10;
    if (viewer.climateBucket && viewer.climateBucket === item.climateBucket)
      score += 10;
    if (viewer.routinePace && viewer.routinePace === item.routinePace)
      score += 10;
    const concernOverlap = tags.filter((tag) =>
      viewer.concernTags.includes(tag),
    ).length;
    score += Math.min(25, concernOverlap * 8);
    if (disclosureType === CommunityDisclosureType.Ordinary) score += 10;
    if (
      disclosureType === CommunityDisclosureType.Sponsored ||
      disclosureType === CommunityDisclosureType.Affiliate ||
      disclosureType === CommunityDisclosureType.BrandRep
    )
      score -= 30;
    return Math.max(0, Math.min(100, score));
  }

  private relevanceReasons(
    viewer: CommunitySafeProfileFacets,
    item: CommunitySafeProfileFacets,
    tags: string[],
  ) {
    const reasons: string[] = [];
    if (viewer.skinType && viewer.skinType === item.skinType)
      reasons.push('same skin type');
    if (
      viewer.sensitivityLevel &&
      viewer.sensitivityLevel === item.sensitivityLevel
    )
      reasons.push('sensitivity match');
    if (viewer.climateBucket && viewer.climateBucket === item.climateBucket)
      reasons.push('similar climate');
    if (tags.some((tag) => viewer.concernTags.includes(tag)))
      reasons.push('shared concerns');
    return reasons.length > 0 ? reasons : ['community evidence'];
  }

  private toRoutineResponse(
    routine: CommunityRoutine,
    steps: CommunityRoutineStep[],
    viewer: CommunitySafeProfileFacets,
  ) {
    const tags = [
      ...routine.concern_tags,
      ...routine.goal_tags,
      ...(routine.avoid_tags ?? []),
      ...(routine.habit_tags ?? []),
    ];
    return {
      id: routine.id,
      type: CommunityContentType.Routine,
      title: routine.title,
      summary: routine.summary,
      disclosureType: routine.disclosure_type,
      moderationStatus: routine.moderation_status,
      concernTags: routine.concern_tags,
      goalTags: routine.goal_tags,
      goalResult: routine.goal_result,
      timeframe: routine.timeframe,
      avoidTags: routine.avoid_tags ?? [],
      habitTags: routine.habit_tags ?? [],
      didNotWorkTags: routine.did_not_work_tags ?? [],
      warningTags: routine.warning_tags ?? [],
      safeFacets: routine.safe_facets,
      safetyFlags: routine.safety_flags,
      helpfulCount: routine.helpful_count,
      notHelpfulCount: routine.not_helpful_count,
      outcomeSignalCounts: this.defaultOutcomeSignalCounts(
        routine.outcome_signal_counts,
      ),
      matchScore: this.matchScore(
        viewer,
        routine.safe_facets,
        tags,
        routine.disclosure_type,
      ),
      relevanceReasons: this.relevanceReasons(
        viewer,
        routine.safe_facets,
        tags,
      ),
      steps: steps.map((step) => this.toRoutineStepPublic(step)),
      createdAt: routine.created_at.toISOString(),
      updatedAt: routine.updated_at.toISOString(),
    };
  }

  private toReviewResponse(
    review: CommunityReview,
    context: CommunityReviewContextProduct[],
    viewer: CommunitySafeProfileFacets,
  ) {
    return {
      id: review.id,
      type: CommunityContentType.Review,
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
      body: review.body,
      moderationStatus: review.moderation_status,
      safeFacets: review.safe_facets,
      safetyFlags: review.safety_flags,
      routineContext: context.map((item) => this.toReviewContextPublic(item)),
      helpfulCount: review.helpful_count,
      notHelpfulCount: review.not_helpful_count,
      outcomeSignalCounts: this.defaultOutcomeSignalCounts(
        review.outcome_signal_counts,
      ),
      matchScore: this.matchScore(
        viewer,
        review.safe_facets,
        review.outcomes,
        review.disclosure_type,
        this.reviewEvidenceBoost(review, context),
      ),
      relevanceReasons: [
        ...this.relevanceReasons(
          viewer,
          review.safe_facets,
          review.outcomes,
        ),
        ...this.reviewEvidenceReasons(review, context),
      ],
      createdAt: review.created_at.toISOString(),
      updatedAt: review.updated_at.toISOString(),
    };
  }

  private reviewEvidenceBoost(
    review: CommunityReview,
    context: CommunityReviewContextProduct[],
  ) {
    let score = 0;
    if (review.overall_rating !== null) score += 4;
    if (review.effectiveness_rating !== null) score += 4;
    if (review.irritation_rating !== null) score += 4;
    if (review.skin_response !== null) score += 4;
    if (context.some((item) => item.product_name)) score += 6;
    if (review.helpful_count > review.not_helpful_count) {
      score += Math.min(
        8,
        (review.helpful_count - review.not_helpful_count) * 2,
      );
    }
    return score;
  }

  private defaultOutcomeSignalCounts(
    counts: Partial<Record<CommunityOutcomeSignal, number>> | null | undefined,
  ): Record<CommunityOutcomeSignal, number> {
    return {
      [CommunityOutcomeSignal.WorkedForMeToo]:
        counts?.[CommunityOutcomeSignal.WorkedForMeToo] ?? 0,
      [CommunityOutcomeSignal.WorkedWithChanges]:
        counts?.[CommunityOutcomeSignal.WorkedWithChanges] ?? 0,
      [CommunityOutcomeSignal.MixedResult]:
        counts?.[CommunityOutcomeSignal.MixedResult] ?? 0,
      [CommunityOutcomeSignal.DidNotWork]:
        counts?.[CommunityOutcomeSignal.DidNotWork] ?? 0,
      [CommunityOutcomeSignal.CausedIrritation]:
        counts?.[CommunityOutcomeSignal.CausedIrritation] ?? 0,
      [CommunityOutcomeSignal.NotRelevant]:
        counts?.[CommunityOutcomeSignal.NotRelevant] ?? 0,
    };
  }

  private addOutcomeSignalCounts(
    target: Record<CommunityOutcomeSignal, number>,
    source: Partial<Record<CommunityOutcomeSignal, number>> | null | undefined,
  ) {
    const normalized = this.defaultOutcomeSignalCounts(source);
    Object.values(CommunityOutcomeSignal).forEach((signal) => {
      target[signal] += normalized[signal];
    });
  }

  private toOutcomeSignalContext(
    dto: CommunityOutcomeSignalDto,
  ): CommunityOutcomeSignalContext {
    const followedParts = Array.from(new Set(dto.followedParts)).filter(
      (part) => Object.values(CommunityOutcomeFollowedPart).includes(part),
    );
    return {
      sameGoal: dto.sameGoal,
      trialDuration: Object.values(CommunityOutcomeTrialDuration).includes(
        dto.trialDuration,
      )
        ? dto.trialDuration
        : CommunityOutcomeTrialDuration.UnderTwoWeeks,
      followedParts:
        followedParts.length > 0
          ? followedParts
          : [CommunityOutcomeFollowedPart.Partial],
      irritationLevel: Object.values(CommunityOutcomeIrritationLevel).includes(
        dto.irritationLevel,
      )
        ? dto.irritationLevel
        : CommunityOutcomeIrritationLevel.Mild,
    };
  }

  private averageRating(values: Array<number | null>): number | null {
    const ratings = values.filter((value): value is number => value !== null);
    if (ratings.length === 0) return null;
    const average =
      ratings.reduce((sum, value) => sum + value, 0) / ratings.length;
    return Number(average.toFixed(1));
  }

  private topCounts(values: string[]) {
    const counts = new Map<string, number>();
    values.filter(Boolean).forEach((value) => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 5);
  }

  private isSimilarFacets(
    viewer: CommunitySafeProfileFacets,
    candidate: CommunitySafeProfileFacets | null | undefined,
  ) {
    if (!candidate) return false;
    return this.safeFacetSimilarityScore(viewer, candidate) >= 35;
  }

  private safeFacetSimilarityScore(
    viewer: CommunitySafeProfileFacets,
    candidate: CommunitySafeProfileFacets,
  ) {
    let score = 0;
    if (viewer.skinType && viewer.skinType === candidate.skinType) score += 20;
    if (
      viewer.sensitivityLevel &&
      viewer.sensitivityLevel === candidate.sensitivityLevel
    ) {
      score += 15;
    }
    if (viewer.skinToneRange && viewer.skinToneRange === candidate.skinToneRange) {
      score += 10;
    }
    if (viewer.climateBucket && viewer.climateBucket === candidate.climateBucket) {
      score += 10;
    }
    if (viewer.routinePace && viewer.routinePace === candidate.routinePace) {
      score += 10;
    }
    const concernOverlap = candidate.concernTags.filter((tag) =>
      viewer.concernTags.includes(tag),
    ).length;
    const goalOverlap = candidate.goalTags.filter((tag) =>
      viewer.goalTags.includes(tag),
    ).length;
    return score + Math.min(25, concernOverlap * 8 + goalOverlap * 8);
  }

  private reviewEvidenceReasons(
    review: CommunityReview,
    context: CommunityReviewContextProduct[],
  ) {
    const reasons: string[] = [];
    if (
      review.overall_rating !== null &&
      review.effectiveness_rating !== null &&
      review.irritation_rating !== null
    ) {
      reasons.push('rated experience');
    }
    if (review.skin_response !== null) reasons.push('reported skin response');
    if (context.some((item) => item.product_name)) {
      reasons.push('named routine context');
    }
    return reasons;
  }

  private toRoutineStepPublic(
    step: CommunityRoutineStep,
  ): CommunityRoutineStepPublic {
    return {
      stepOrder: step.step_order,
      slot: step.slot,
      productBrand: step.product_brand,
      productName: step.product_name,
      category: step.category,
      frequency: step.frequency,
      notes: step.notes,
    };
  }

  private toReviewContextPublic(
    context: CommunityReviewContextProduct,
  ): CommunityRoutineContextProductPublic {
    return {
      productBrand: context.product_brand,
      productName: context.product_name,
      category: context.category,
    };
  }

  private buildPatterns(
    facets: CommunitySafeProfileFacets,
    routines: ReturnType<CommunityService['toRoutineResponse']>[],
    reviews: ReturnType<CommunityService['toReviewResponse']>[],
  ) {
    const matched = [...routines, ...reviews].filter(
      (item) => item.matchScore >= 40,
    );
    return [
      {
        id: 'similar-users',
        title: 'Community evidence is ranked by similarity, not popularity',
        body: `${matched.length} published items currently match your profile facets.`,
      },
      {
        id: 'routine-context',
        title: 'Reviews with routine context rank higher',
        body: 'Ritora requires product reviews to include the surrounding routine before they can influence matching.',
      },
      {
        id: 'safe-facets',
        title: 'Your private profile stays private',
        body: `${facets.concernTags.length} concern tags are used without exposing exact location, email, photos, or medical history.`,
      },
    ];
  }

  private async createReport(
    userId: string,
    contentType: CommunityContentType,
    contentId: string,
    dto: CreateCommunityReportDto,
  ) {
    await this.assertActionLimit({
      label: 'reports',
      repository: this.reports,
      userColumn: 'reporter_user_id',
      userId,
      maxPerDay: 20,
    });
    const report = await this.dataSource.transaction(async (manager) => {
      const reportRepository = manager.getRepository(CommunityReport);
      const existing = await reportRepository.findOne({
        where: {
          reporter_user_id: userId,
          content_type: contentType,
          content_id: contentId,
          status: In([
            CommunityReportStatus.Open,
            CommunityReportStatus.Triaged,
          ]),
        },
      });
      if (existing) {
        const shouldEscalate = SEVERE_REPORT_REASONS.has(dto.reason);
        existing.reason = dto.reason;
        existing.note = cleanText(dto.note, 1000) ?? existing.note;
        if (shouldEscalate) {
          existing.status = CommunityReportStatus.Open;
        }
        const saved = await reportRepository.save(existing);
        if (shouldEscalate) {
          await this.removeContentFromFeedsForSevereReport(
            manager,
            contentType,
            contentId,
            dto.reason,
          );
        }
        return saved;
      }

      const existingReportCount = await reportRepository.count({
        where: {
          content_type: contentType,
          content_id: contentId,
          status: In([
            CommunityReportStatus.Open,
            CommunityReportStatus.Triaged,
          ]),
        },
      });
      const shouldEscalate =
        SEVERE_REPORT_REASONS.has(dto.reason) ||
        existingReportCount + 1 >= REPORT_ESCALATION_THRESHOLD;
      const saved = await reportRepository.save(
        reportRepository.create({
          reporter_user_id: userId,
          content_type: contentType,
          content_id: contentId,
          reason: dto.reason,
          note: cleanText(dto.note, 1000),
          status: shouldEscalate
            ? CommunityReportStatus.Open
            : CommunityReportStatus.Triaged,
        }),
      );
      if (shouldEscalate) {
        await this.removeContentFromFeedsForSevereReport(
          manager,
          contentType,
          contentId,
          dto.reason,
        );
      } else {
        await this.recordDecision(manager, {
          contentType,
          contentId,
          actorAdminId: null,
          from: CommunityModerationStatus.Published,
          to: CommunityModerationStatus.Published,
          reason: `AI moderation triaged non-critical report: ${dto.reason}`,
        });
      }
      return saved;
    });
    return this.toReportResponse(report);
  }

  private async findActiveReport(
    userId: string,
    contentType: CommunityContentType,
    contentId: string,
  ): Promise<CommunityReport | null> {
    return this.reports.findOne({
      where: {
        reporter_user_id: userId,
        content_type: contentType,
        content_id: contentId,
        status: In([CommunityReportStatus.Open, CommunityReportStatus.Triaged]),
      },
      order: { created_at: 'DESC' },
    });
  }

  private async vote(
    userId: string,
    contentType: CommunityContentType,
    contentId: string,
    vote: CommunityHelpfulnessVote,
  ) {
    await this.dataSource.query(
      `
        INSERT INTO "community_helpfulness_votes" (
          "id", "user_id", "content_type", "content_id", "vote", "created_at"
        )
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT ("user_id", "content_type", "content_id")
        DO UPDATE SET "vote" = EXCLUDED."vote"
      `,
      [ulid(), userId, contentType, contentId, vote],
    );
    await this.recountVotes(contentType, contentId);
    return { vote };
  }

  private async signalOutcome(
    userId: string,
    contentType: CommunityContentType,
    contentId: string,
    dto: CommunityOutcomeSignalDto,
  ) {
    const context = this.toOutcomeSignalContext(dto);
    const safeFacets = await this.getSafeFacets(userId);
    await this.dataSource.query(
      `
        INSERT INTO "community_outcome_signal_votes" (
          "id",
          "user_id",
          "content_type",
          "content_id",
          "signal",
          "context",
          "safe_facets",
          "created_at",
          "updated_at"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
        ON CONFLICT ("user_id", "content_type", "content_id")
        DO UPDATE SET
          "signal" = EXCLUDED."signal",
          "context" = EXCLUDED."context",
          "safe_facets" = EXCLUDED."safe_facets",
          "updated_at" = now()
      `,
      [ulid(), userId, contentType, contentId, dto.signal, context, safeFacets],
    );
    const outcomeSignalCounts = await this.recountOutcomeSignals(
      contentType,
      contentId,
    );
    return { signal: dto.signal, context, outcomeSignalCounts };
  }

  private async recountOutcomeSignals(
    contentType: CommunityContentType,
    contentId: string,
  ) {
    const rows = await this.outcomeVotes
      .createQueryBuilder('vote')
      .select('vote.signal', 'signal')
      .addSelect('COUNT(*)::int', 'count')
      .where('vote.content_type = :contentType', { contentType })
      .andWhere('vote.content_id = :contentId', { contentId })
      .groupBy('vote.signal')
      .getRawMany<{ signal: CommunityOutcomeSignal; count: number | string }>();
    const counts = this.defaultOutcomeSignalCounts(
      Object.fromEntries(
        rows.map((row) => [row.signal, Number(row.count)]),
      ) as Partial<Record<CommunityOutcomeSignal, number>>,
    );
    if (contentType === CommunityContentType.Routine) {
      await this.routines.update(contentId, {
        outcome_signal_counts: counts,
      });
    } else {
      await this.reviews.update(contentId, {
        outcome_signal_counts: counts,
      });
    }
    return counts;
  }

  private async recountVotes(
    contentType: CommunityContentType,
    contentId: string,
  ) {
    const rows = await this.votes
      .createQueryBuilder('vote')
      .select('vote.vote', 'vote')
      .addSelect('COUNT(*)::int', 'count')
      .where('vote.content_type = :contentType', { contentType })
      .andWhere('vote.content_id = :contentId', { contentId })
      .groupBy('vote.vote')
      .getRawMany<{ vote: CommunityHelpfulnessVote; count: number | string }>();
    const countFor = (targetVote: CommunityHelpfulnessVote) =>
      Number(rows.find((row) => row.vote === targetVote)?.count ?? 0);
    const helpful = countFor(CommunityHelpfulnessVote.Helpful);
    const notHelpful = countFor(CommunityHelpfulnessVote.NotHelpful);
    if (contentType === CommunityContentType.Routine) {
      await this.routines.update(contentId, {
        helpful_count: helpful,
        not_helpful_count: notHelpful,
      });
    } else {
      await this.reviews.update(contentId, {
        helpful_count: helpful,
        not_helpful_count: notHelpful,
      });
    }
  }

  private canRead(
    item: Pick<
      CommunityRoutine | CommunityReview,
      'author_user_id' | 'moderation_status' | 'withdrawn_at'
    >,
    viewerUserId: string,
  ) {
    if (item.withdrawn_at) return false;
    return (
      item.moderation_status === CommunityModerationStatus.Published ||
      item.author_user_id === viewerUserId
    );
  }

  private async findContent(contentId: string) {
    const routine = await this.routines.findOne({ where: { id: contentId } });
    if (routine) {
      return {
        type: CommunityContentType.Routine,
        item: routine,
        entity: CommunityRoutine,
      };
    }
    const review = await this.reviews.findOne({ where: { id: contentId } });
    if (review) {
      return {
        type: CommunityContentType.Review,
        item: review,
        entity: CommunityReview,
      };
    }
    throw new NotFoundException('Community content not found');
  }

  async getAdminContentDetail(contentId: string) {
    const content = await this.findContent(contentId);
    const [reports, decisions, safetyScans] = await Promise.all([
      this.reports.find({
        where: { content_type: content.type, content_id: contentId },
        order: { created_at: 'DESC' },
      }),
      this.decisions.find({
        where: { content_type: content.type, content_id: contentId },
        order: { created_at: 'DESC' },
      }),
      this.safetyScans.find({
        where: { content_type: content.type, content_id: contentId },
        order: { created_at: 'DESC' },
      }),
    ]);
    const steps =
      content.type === CommunityContentType.Routine
        ? await this.routineSteps.find({
            where: { routine_id: contentId },
            order: { step_order: 'ASC' },
          })
        : [];
    const reviewContext =
      content.type === CommunityContentType.Review
        ? await this.reviewContext.find({ where: { review_id: contentId } })
        : [];
    return {
      item: this.toAdminContentItem(content.type, content.item),
      content: content.item,
      steps,
      reviewContext,
      reports: reports.map((report) => this.toReportResponse(report)),
      decisions: decisions.map((decision) => ({
        id: decision.id,
        actorAdminId: decision.actor_admin_id,
        fromStatus: decision.from_status,
        toStatus: decision.to_status,
        reason: decision.reason,
        createdAt: decision.created_at.toISOString(),
      })),
      safetyScans: safetyScans.map((scan) => ({
        id: scan.id,
        result: scan.result,
        createdAt: scan.created_at.toISOString(),
      })),
    };
  }

  private toAdminContentItem(
    type: CommunityContentType,
    item: CommunityRoutine | CommunityReview,
  ) {
    const title =
      type === CommunityContentType.Routine
        ? (item as CommunityRoutine).title
        : `${(item as CommunityReview).product_brand} ${(item as CommunityReview).product_name}`;
    return {
      id: item.id,
      type,
      title,
      editableText:
        type === CommunityContentType.Routine
          ? (item as CommunityRoutine).summary
          : (item as CommunityReview).body,
      status: item.moderation_status,
      disclosureType: item.disclosure_type,
      safetyFlags: item.safety_flags,
      authorUserId: item.author_user_id,
      assignedAdminId: item.assigned_admin_id,
      createdAt: item.created_at.toISOString(),
      updatedAt: item.updated_at.toISOString(),
    };
  }

  private toSubmissionItem(
    type: CommunityContentType.Routine,
    item: CommunityRoutine,
    relations: CommunityRoutineStep[],
  ): ReturnType<CommunityService['toAdminContentItem']> & {
    editableRoutine: ReturnType<CommunityService['toEditableRoutineSubmission']>;
    editableReview: null;
  };
  private toSubmissionItem(
    type: CommunityContentType.Review,
    item: CommunityReview,
    relations: CommunityReviewContextProduct[],
  ): ReturnType<CommunityService['toAdminContentItem']> & {
    editableRoutine: null;
    editableReview: ReturnType<CommunityService['toEditableReviewSubmission']>;
  };
  private toSubmissionItem(
    type: CommunityContentType,
    item: CommunityRoutine | CommunityReview,
    relations: CommunityRoutineStep[] | CommunityReviewContextProduct[],
  ) {
    const base = this.toAdminContentItem(type, item);
    if (type === CommunityContentType.Routine) {
      return {
        ...base,
        editableRoutine: this.toEditableRoutineSubmission(
          item as CommunityRoutine,
          relations as CommunityRoutineStep[],
        ),
        editableReview: null,
      };
    }
    return {
      ...base,
      editableRoutine: null,
      editableReview: this.toEditableReviewSubmission(
        item as CommunityReview,
        relations as CommunityReviewContextProduct[],
      ),
    };
  }

  private toEditableRoutineSubmission(
    routine: CommunityRoutine,
    steps: CommunityRoutineStep[],
  ) {
    return {
      title: routine.title,
      summary: routine.summary,
      disclosureType: routine.disclosure_type,
      concernTags: routine.concern_tags ?? [],
      goalTags: routine.goal_tags ?? [],
      goalResult: routine.goal_result ?? null,
      timeframe: routine.timeframe,
      avoidTags: routine.avoid_tags ?? [],
      habitTags: routine.habit_tags ?? [],
      didNotWorkTags: routine.did_not_work_tags ?? [],
      warningTags: routine.warning_tags ?? [],
      steps: steps.map((step) => ({
        slot: step.slot,
        productId: step.product_id,
        productBrand: step.product_brand,
        productName: step.product_name,
        category: step.category,
        frequency: step.frequency,
        notes: step.notes,
      })),
    };
  }

  private toEditableReviewSubmission(
    review: CommunityReview,
    context: CommunityReviewContextProduct[],
  ) {
    return {
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
      routineContext: context.map((item) => ({
        productId: item.product_id,
        productBrand: item.product_brand,
        productName: item.product_name,
        category: item.category,
      })),
      body: review.body,
    };
  }

  private queryAdminModerationRows<
    T extends CommunityRoutine | CommunityReview,
  >(
    repository: Repository<T>,
    contentType: CommunityContentType,
    statuses: CommunityModerationStatus[],
    query: AdminCommunityModerationQueryDto,
  ): Promise<T[]> {
    const alias =
      contentType === CommunityContentType.Routine ? 'routine' : 'review';
    const builder = repository
      .createQueryBuilder(alias)
      .where(`${alias}.moderation_status IN (:...statuses)`, { statuses })
      .andWhere(`${alias}.withdrawn_at IS NULL`);

    if (query.disclosureType) {
      builder.andWhere(`${alias}.disclosure_type = :disclosureType`, {
        disclosureType: query.disclosureType,
      });
    }
    if (query.severity) {
      builder.andWhere(`${alias}.safety_flags @> :severityFilter`, {
        severityFilter: JSON.stringify([{ severity: query.severity }]),
      });
    }
    if (query.assignedAdminId) {
      if (query.assignedAdminId === 'unassigned') {
        builder.andWhere(`${alias}.assigned_admin_id IS NULL`);
      } else {
        builder.andWhere(`${alias}.assigned_admin_id = :assignedAdminId`, {
          assignedAdminId: query.assignedAdminId,
        });
      }
    }
    if (query.search?.trim()) {
      const search = `%${query.search.trim().toLowerCase()}%`;
      const searchableColumns =
        contentType === CommunityContentType.Routine
          ? [`${alias}.title`]
          : [`${alias}.product_brand`, `${alias}.product_name`];
      builder.andWhere(
        `(${[
          `${alias}.id ILIKE :search`,
          `${alias}.author_user_id ILIKE :search`,
          ...searchableColumns.map((column) => `${column} ILIKE :search`),
        ].join(' OR ')})`,
        { search },
      );
    }
    if (query.reason) {
      builder.andWhere(
        `EXISTS (
          SELECT 1
          FROM "community_reports" report
          WHERE report."content_type" = :reportContentType
            AND report."content_id" = ${alias}."id"
            AND report."reason" = :reportReason
            AND report."status" = :reportStatus
        )`,
        {
          reportContentType: contentType,
          reportReason: query.reason,
          reportStatus: CommunityReportStatus.Open,
        },
      );
    }

    return builder
      .orderBy(`${alias}.updated_at`, 'DESC')
      .take(DEFAULT_LIMIT)
      .getMany();
  }

  private matchesAdminModerationFilters(
    item: ReturnType<CommunityService['toAdminContentItem']>,
    query: AdminCommunityModerationQueryDto,
  ): boolean {
    if (query.disclosureType && item.disclosureType !== query.disclosureType)
      return false;
    if (
      query.severity &&
      !item.safetyFlags.some((flag) => flag.severity === query.severity)
    ) {
      return false;
    }
    if (query.assignedAdminId) {
      if (query.assignedAdminId === 'unassigned') {
        if (item.assignedAdminId) return false;
      } else if (item.assignedAdminId !== query.assignedAdminId) {
        return false;
      }
    }
    if (query.search) {
      const needle = query.search.toLowerCase().trim();
      const haystack =
        `${item.title} ${item.authorUserId} ${item.id}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  private toReportResponse(report: CommunityReport) {
    return {
      id: report.id,
      contentType: report.content_type,
      contentId: report.content_id,
      reason: report.reason,
      note: report.note,
      status: report.status,
      createdAt: report.created_at.toISOString(),
      updatedAt: report.updated_at.toISOString(),
    };
  }

  private toCommunitySettingsResponse(settings: CommunitySettings | null) {
    return {
      minimumAccountAgeDays:
        settings?.minimum_account_age_days ??
        DEFAULT_COMMUNITY_MIN_ACCOUNT_AGE_DAYS,
      updatedAt: (
        settings?.updated_at ??
        settings?.created_at ??
        new Date(0)
      ).toISOString(),
      updatedByAdminId: settings?.updated_by_admin_id ?? null,
    };
  }

  private automationDecisionReason(
    automation: CommunityModerationAutomationSnapshot,
  ): string {
    return automation.handledBy === 'admin'
      ? `Automation escalated to admin: ${automation.reason}`
      : `AI moderation ${automation.action}: ${automation.reason}`;
  }

  private async recordDecision(
    manager: Pick<DataSource['manager'], 'getRepository'>,
    input: {
      contentType: CommunityContentType;
      contentId: string;
      actorAdminId: string | null;
      from: CommunityModerationStatus;
      to: CommunityModerationStatus;
      reason: string;
    },
  ) {
    await manager.getRepository(CommunityModerationDecision).save(
      manager.getRepository(CommunityModerationDecision).create({
        content_type: input.contentType,
        content_id: input.contentId,
        actor_admin_id: input.actorAdminId,
        from_status: input.from,
        to_status: input.to,
        reason: input.reason,
      }),
    );
  }

  private async recordSafetyScan(
    manager: Pick<DataSource['manager'], 'getRepository'>,
    input: {
      contentType: CommunityContentType;
      contentId: string;
      flags: CommunitySafetyFlag[];
      status: CommunityModerationStatus;
      scannedTextLength: number;
      automation?: CommunityModerationAutomationSnapshot;
    },
  ) {
    await manager.getRepository(CommunitySafetyScanResult).save(
      manager.getRepository(CommunitySafetyScanResult).create({
        content_type: input.contentType,
        content_id: input.contentId,
        result: {
          flags: input.flags,
          status: input.status,
          scannedTextLength: input.scannedTextLength,
          scannerVersion: 'deterministic-v1+ai-triage-v1',
          automation: input.automation,
        },
      }),
    );
  }

  private async assertActionLimit(input: {
    label: string;
    repository: {
      count(options: { where: Record<string, unknown> }): Promise<number>;
    };
    userColumn: string;
    userId: string;
    maxPerDay: number;
  }) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await input.repository.count({
      where: {
        [input.userColumn]: input.userId,
        created_at: MoreThan(since),
      },
    });
    if (count >= input.maxPerDay) {
      throw new BadRequestException(
        `Too many community ${input.label} in the last 24 hours`,
      );
    }
  }

  private productMatchesReactionTrigger(
    product: InventoryProduct,
    triggers: string[],
  ): boolean {
    if (triggers.length === 0) return false;
    const haystack = [
      product.brand,
      product.name,
      product.category,
      ...(product.identity?.inciIngredients ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return triggers.some((trigger) => haystack.includes(trigger));
  }

  private stepRemovalReasonForProfile(
    step: CommunityRoutineStep,
    profile: SkinProfile | null,
    routinePreferences: SkinProfile['routine_preferences'],
    activeTolerances: SkinProfile['active_tolerances'],
  ): string | null {
    const category = step.category;
    const frequency = (step.frequency ?? '').toLowerCase();
    const activeCategories = new Set(['serum', 'exfoliant', 'treatment']);
    if (!profile || !activeCategories.has(category)) return null;

    const maxActiveNights = routinePreferences?.max_active_nights_per_week;
    if (typeof maxActiveNights === 'number' && maxActiveNights <= 0) {
      return 'Removed because your profile currently avoids leave-on active steps.';
    }
    if (
      category === 'exfoliant' &&
      (frequency.includes('daily') || frequency.includes('every day')) &&
      (routinePreferences?.pace === 'cautious' || maxActiveNights === 1)
    ) {
      return 'Removed because daily exfoliation is too aggressive for your current routine pace.';
    }
    const lowTolerance = Object.entries(activeTolerances ?? {}).some(
      ([active, value]) =>
        frequency.includes(active.toLowerCase()) &&
        ['low', 'none', 'avoid'].includes(
          String(value?.tolerance ?? '').toLowerCase(),
        ),
    );
    if (lowTolerance) {
      return 'Removed because your active-tolerance profile flags this ingredient role as low tolerance.';
    }
    return null;
  }

  private productCompatibleForStep(
    product: InventoryProduct,
    step: CommunityRoutineStep,
    routinePreferences: SkinProfile['routine_preferences'],
  ): boolean {
    if (String(product.category) !== step.category) return false;
    const ingredients = product.identity?.inciIngredients ?? [];
    const joined = ingredients.join(' ').toLowerCase();
    if (step.category === 'sun-protection') {
      const sunscreenText =
        `${product.name} ${product.guidance?.steps?.join(' ') ?? ''} ${joined}`.toLowerCase();
      if (
        !/(spf|zinc oxide|titanium dioxide|avobenzone|uvinul|tinosorb|octocrylene|octisalate)/.test(
          sunscreenText,
        )
      ) {
        return false;
      }
      const preferredFilter = String(
        routinePreferences?.sunscreen_filter ?? '',
      ).toLowerCase();
      if (preferredFilter === 'mineral') {
        return /(zinc oxide|titanium dioxide)/.test(sunscreenText);
      }
      if (preferredFilter === 'chemical') {
        return !/(zinc oxide|titanium dioxide)/.test(sunscreenText);
      }
    }
    if (routinePreferences?.fragrance_free) {
      const fragranceSignals = [
        'fragrance',
        'parfum',
        'limonene',
        'linalool',
        'citral',
        'geraniol',
      ];
      if (fragranceSignals.some((signal) => joined.includes(signal)))
        return false;
    }
    return true;
  }

  private adaptationSwapReason(
    step: CommunityRoutineStep,
    target: InventoryProduct,
  ): string {
    if (step.category === 'sun-protection') {
      return 'Mapped to an owned sunscreen-compatible product that preserves the protection role.';
    }
    const ingredientOverlap = (target.identity?.inciIngredients ?? []).some(
      (ingredient) =>
        (step.notes ?? '').toLowerCase().includes(ingredient.toLowerCase()),
    );
    return ingredientOverlap
      ? 'Mapped to an owned product with a matching category and ingredient-role signal.'
      : 'Mapped to the closest safe category match on your shelf.';
  }

  private async removeContentFromFeedsForSevereReport(
    manager: Pick<DataSource['manager'], 'getRepository'>,
    contentType: CommunityContentType,
    contentId: string,
    reason: CommunityReportReason,
  ) {
    const content =
      contentType === CommunityContentType.Routine
        ? await manager.getRepository(CommunityRoutine).findOne({
            where: { id: contentId },
          })
        : await manager.getRepository(CommunityReview).findOne({
            where: { id: contentId },
          });
    if (
      !content ||
      content.moderation_status !== CommunityModerationStatus.Published
    ) {
      return;
    }
    content.moderation_status = CommunityModerationStatus.PendingReview;
    await manager
      .getRepository(
        contentType === CommunityContentType.Routine
          ? CommunityRoutine
          : CommunityReview,
      )
      .save(content);
    await this.recordDecision(manager, {
      contentType,
      contentId,
      actorAdminId: null,
      from: CommunityModerationStatus.Published,
      to: CommunityModerationStatus.PendingReview,
      reason: `Auto-removed from ranking after severe report: ${reason}`,
    });
  }

  private async writeCommunityAuditLog(input: {
    action: AdminAuditAction;
    actorAdminId: string;
    contentId: string;
    contentType: string;
    context?: AdminCommunityAuditContext;
    metadata?: Record<string, unknown>;
    reason: string;
    targetUserId: string | null;
  }) {
    await this.auditLogs.save(
      this.auditLogs.create({
        action: input.action,
        actor_admin_id: input.actorAdminId,
        actor_session_id: input.context?.sessionId ?? 'community-admin',
        target_admin_id: null,
        target_user_id: input.targetUserId,
        reason: input.reason,
        ip_address: input.context?.ip ?? null,
        user_agent: input.context?.userAgent ?? null,
        metadata: {
          contentId: input.contentId,
          contentType: input.contentType,
          ...(input.metadata ?? {}),
        },
      }),
    );
  }

  private async notifyModerationOutcome(
    item: CommunityRoutine | CommunityReview,
    contentType: CommunityContentType,
    status: CommunityModerationStatus,
  ) {
    if (
      ![
        CommunityModerationStatus.Published,
        CommunityModerationStatus.Hidden,
        CommunityModerationStatus.Rejected,
        CommunityModerationStatus.NeedsEdit,
      ].includes(status)
    ) {
      return;
    }
    try {
      await this.notifications.save(
        this.notifications.create({
          user_id: item.author_user_id,
          kind: 'community_moderation',
          title_key: 'community.notifications.moderation.title',
          body_key: `community.notifications.moderation.${status}`,
          severity:
            status === CommunityModerationStatus.Published ? 'info' : 'warning',
          dedupe_key: `community:${contentType}:${item.id}:${status}`,
          deep_link: '/community?tab=submissions',
          payload: null,
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') {
        throw error;
      }
      // Duplicate moderation notifications should not block the moderation action.
    }
  }
}
