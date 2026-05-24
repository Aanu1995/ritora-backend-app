import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from '../../admin/entities/admin-account.entity';
import { AdminAuditLog } from '../../admin/entities/admin-audit-log.entity';
import { AppModule } from '../../app.module';
import { assertDestructiveTestDatabaseResetAllowed } from '../../common/utils/destructive-database-guard';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { InAppNotification } from '../../notifications/entities/in-app-notification.entity';
import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../../users/entities/user-consent.entity';
import { User } from '../../users/entities/user.entity';
import { UserConsentType } from '../../users/user-consent.constants';
import { CommunityAiModerationService } from '../community-ai-moderation.service';
import { CommunitySafetyService } from '../community-safety.service';
import { CommunityService } from '../community.service';
import { CommunityHelpfulnessVoteEntity } from '../entities/community-helpfulness-vote.entity';
import { CommunityModerationDecision } from '../entities/community-moderation-decision.entity';
import { CommunityOutcomeSignalVote } from '../entities/community-outcome-signal-vote.entity';
import { CommunityProfile } from '../entities/community-profile.entity';
import { CommunityReport } from '../entities/community-report.entity';
import { CommunityReview } from '../entities/community-review.entity';
import { CommunityRoutineAdaptation } from '../entities/community-routine-adaptation.entity';
import { CommunityRoutine } from '../entities/community-routine.entity';
import { CommunitySafetyScanResult } from '../entities/community-safety-scan-result.entity';
import {
  CommunityContentType,
  CommunityDisclosureType,
  CommunityGoalResult,
  CommunityGoalTimeframe,
  CommunityHelpfulnessVote,
  CommunityModerationStatus,
  CommunityOutcomeFollowedPart,
  CommunityOutcomeIrritationLevel,
  CommunityOutcomeSignal,
  CommunityOutcomeTrialDuration,
  CommunityReportReason,
  CommunityReviewRoutineSlot,
  CommunityReviewSkinResponse,
  CommunitySafetySeverity,
  type CommunityModerationAutomationSnapshot,
  type CommunitySafetyFlag,
  CommunityReportStatus,
} from '../community.types';
import {
  COMMUNITY_MODERATION_EVALUATION_CASES,
  type CommunityModerationEvaluationCase,
} from './community-evaluation.fixtures';

export type CommunityEvaluationCheck = {
  code: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type CommunityModerationEvaluationCaseResult = {
  caseId: string;
  title: string;
  status: 'passed' | 'failed';
  riskFocus: string[];
  hardChecksPassed: number;
  hardChecksTotal: number;
  hardCheckFailures: string[];
  scannedFlags: CommunitySafetyFlag[];
  moderation: {
    status: CommunityModerationStatus;
    action: CommunityModerationAutomationSnapshot['action'];
    handledBy: CommunityModerationAutomationSnapshot['handledBy'];
    provider: CommunityModerationAutomationSnapshot['provider'];
    model: string | null;
    fallbackReason: string | null;
    critical: boolean;
    confidence: number;
    durationMs: number;
    reason: string;
  };
  checks: CommunityEvaluationCheck[];
};

export type CommunityGuardrailSimulationResult = {
  id: string;
  status: 'passed' | 'failed';
  checks: CommunityEvaluationCheck[];
};

export type CommunityWorkflowEvaluationResult = {
  enabled: boolean;
  status: 'passed' | 'failed' | 'skipped';
  checks: CommunityEvaluationCheck[];
  created: {
    userIds: string[];
    adminIds: string[];
    contentIds: string[];
  };
  cleanup: {
    attempted: boolean;
    completed: boolean;
    deletedOnlyEvaluationScopedRows: boolean;
    error: string | null;
  };
};

export type CommunityEvaluationReport = {
  reportType: 'community_launch_evaluation';
  generatedAt: string;
  model: string | null;
  strict: boolean;
  requireLiveAi: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  liveAi: {
    observed: boolean;
    providerFailures: number;
    fallbackCases: string[];
  };
  gate: {
    passed: boolean;
    blockers: string[];
    warnings: string[];
  };
  moderationCases: CommunityModerationEvaluationCaseResult[];
  guardrailSimulations: CommunityGuardrailSimulationResult[];
  workflow: CommunityWorkflowEvaluationResult;
};

export async function buildCommunityEvaluationReport(
  input: {
    generatedAt?: Date;
    requireLiveAi?: boolean;
    includeDatabaseWorkflow?: boolean;
  } = {},
): Promise<CommunityEvaluationReport> {
  const generatedAt = input.generatedAt ?? new Date();
  const requireLiveAi = input.requireLiveAi ?? true;
  const configService = configServiceFromEnv();
  const model =
    configService.get<string>('COMMUNITY_MODERATION_AI_MODEL')?.trim() || null;
  const safety = new CommunitySafetyService();
  const aiModeration = new CommunityAiModerationService(configService);
  const moderationCases = await evaluateModerationCases({
    aiModeration,
    safety,
  });
  const guardrailSimulations = await evaluateGuardrailSimulations({ safety });
  const workflow =
    input.includeDatabaseWorkflow === false
      ? skippedWorkflow()
      : await evaluateDatabaseWorkflow();
  const allCaseResults = [
    ...moderationCases.map((result) => result.status),
    ...guardrailSimulations.map((result) => result.status),
    workflow.status === 'skipped' ? 'passed' : workflow.status,
  ];
  const failedCases = allCaseResults.filter(
    (status) => status === 'failed',
  ).length;
  const totalCases = allCaseResults.length;
  const liveAiFallbackCases = moderationCases
    .filter((result) => result.moderation.fallbackReason)
    .map((result) => result.caseId);
  const liveAiObserved = moderationCases.some(
    (result) =>
      result.moderation.provider === 'openai' &&
      result.moderation.fallbackReason === null,
  );
  const blockers = [
    ...(failedCases > 0
      ? ['One or more Community evaluation cases failed.']
      : []),
    ...(requireLiveAi && !liveAiObserved
      ? ['No successful live OpenAI moderation call was observed.']
      : []),
    ...(workflow.status === 'failed'
      ? ['Disposable database workflow evaluation failed.']
      : []),
    ...(!workflow.cleanup.completed && workflow.cleanup.attempted
      ? ['Disposable evaluation cleanup did not complete.']
      : []),
  ];
  const warnings = [
    ...(workflow.status === 'skipped'
      ? ['Database workflow evaluation was skipped.']
      : []),
    ...(liveAiFallbackCases.length > 0
      ? [
          `Fallback used in moderation cases: ${liveAiFallbackCases.join(', ')}.`,
        ]
      : []),
  ];

  return {
    reportType: 'community_launch_evaluation',
    generatedAt: generatedAt.toISOString(),
    model,
    strict: true,
    requireLiveAi,
    totalCases,
    passedCases: totalCases - failedCases,
    failedCases,
    liveAi: {
      observed: liveAiObserved,
      providerFailures: liveAiFallbackCases.length,
      fallbackCases: liveAiFallbackCases,
    },
    gate: {
      passed: blockers.length === 0,
      blockers,
      warnings,
    },
    moderationCases,
    guardrailSimulations,
    workflow,
  };
}

async function evaluateModerationCases(input: {
  aiModeration: CommunityAiModerationService;
  safety: CommunitySafetyService;
}): Promise<CommunityModerationEvaluationCaseResult[]> {
  const results: CommunityModerationEvaluationCaseResult[] = [];
  for (const evaluationCase of COMMUNITY_MODERATION_EVALUATION_CASES) {
    const scannedFlags = scanCase(input.safety, evaluationCase);
    const moderation = await input.aiModeration.triage({
      contentType: evaluationCase.contentType,
      disclosureType: evaluationCase.disclosureType,
      flags: scannedFlags,
      text: caseText(evaluationCase),
    });
    const checks = moderationCaseChecks(
      evaluationCase,
      scannedFlags,
      moderation.automation,
      moderation.status,
    );
    const hardCheckFailures = checks
      .filter((check) => !check.passed)
      .map((check) => check.code);
    results.push({
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      status: hardCheckFailures.length === 0 ? 'passed' : 'failed',
      riskFocus: evaluationCase.riskFocus,
      hardChecksPassed: checks.length - hardCheckFailures.length,
      hardChecksTotal: checks.length,
      hardCheckFailures,
      scannedFlags,
      moderation: {
        status: moderation.status,
        action: moderation.automation.action,
        handledBy: moderation.automation.handledBy,
        provider: moderation.automation.provider,
        model: moderation.automation.model,
        fallbackReason: moderation.automation.fallbackReason,
        critical: moderation.automation.critical,
        confidence: moderation.automation.confidence,
        durationMs: moderation.automation.durationMs,
        reason: moderation.automation.reason,
      },
      checks,
    });
  }
  return results;
}

async function evaluateGuardrailSimulations(input: {
  safety: CommunitySafetyService;
}): Promise<CommunityGuardrailSimulationResult[]> {
  const originalFetch = globalThis.fetch;
  const results: CommunityGuardrailSimulationResult[] = [];
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            action: 'publish',
            confidence: 0.99,
            reason: 'The model attempted to publish this content.',
          }),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };

  try {
    const aiModeration = new CommunityAiModerationService(
      configServiceFromRecord({
        COMMUNITY_MODERATION_AI_MODEL: 'community-eval-guardrail-model',
        OPENAI_API_KEY: 'community-eval-key',
      }),
    );
    const sunscreenCase = COMMUNITY_MODERATION_EVALUATION_CASES.find(
      (item) => item.id === 'missing_sunscreen_request_edit',
    );
    if (sunscreenCase) {
      const flags = scanCase(input.safety, sunscreenCase);
      const result = await aiModeration.triage({
        contentType: sunscreenCase.contentType,
        disclosureType: sunscreenCase.disclosureType,
        flags,
        text: caseText(sunscreenCase),
      });
      results.push(
        simulationResult('llm_publish_overridden_for_missing_sunscreen', [
          check(
            'guardrail_overrides_publish',
            result.status === CommunityModerationStatus.NeedsEdit &&
              result.automation.action === 'request_edit',
            CommunityModerationStatus.NeedsEdit,
            result.status,
          ),
          check(
            'provider_call_was_exercised',
            fetchCalls > 0,
            'fetch called',
            fetchCalls,
          ),
          check(
            'override_reason_is_visible',
            /Deterministic guardrail overrode LLM/i.test(
              result.automation.reason,
            ),
            'override reason',
            result.automation.reason,
          ),
        ]),
      );
    }

    fetchCalls = 0;
    const manipulationCase = COMMUNITY_MODERATION_EVALUATION_CASES.find(
      (item) => item.id === 'prompt_injection_request_edit',
    );
    if (manipulationCase) {
      const flags = scanCase(input.safety, manipulationCase);
      const result = await aiModeration.triage({
        contentType: manipulationCase.contentType,
        disclosureType: manipulationCase.disclosureType,
        flags,
        text: caseText(manipulationCase),
      });
      results.push(
        simulationResult('llm_publish_overridden_for_moderation_manipulation', [
          check(
            'guardrail_overrides_publish',
            result.status === CommunityModerationStatus.NeedsEdit &&
              result.automation.action === 'request_edit',
            CommunityModerationStatus.NeedsEdit,
            result.status,
          ),
          check(
            'provider_call_was_exercised',
            fetchCalls > 0,
            'fetch called',
            fetchCalls,
          ),
          check(
            'override_reason_is_visible',
            /moderation-manipulation/i.test(result.automation.reason),
            'moderation-manipulation override reason',
            result.automation.reason,
          ),
        ]),
      );
    }

    fetchCalls = 0;
    const criticalCase = COMMUNITY_MODERATION_EVALUATION_CASES.find(
      (item) => item.id === 'medical_claim_admin_review',
    );
    if (criticalCase) {
      const flags = scanCase(input.safety, criticalCase);
      const result = await aiModeration.triage({
        contentType: criticalCase.contentType,
        disclosureType: criticalCase.disclosureType,
        flags,
        text: caseText(criticalCase),
      });
      results.push(
        simulationResult('critical_guardrail_bypasses_llm_publish_attempt', [
          check(
            'critical_case_escalates_to_admin',
            result.status === CommunityModerationStatus.PendingReview &&
              result.automation.handledBy === 'admin',
            CommunityModerationStatus.PendingReview,
            result.status,
          ),
          check(
            'llm_not_called_for_critical_case',
            fetchCalls === 0,
            0,
            fetchCalls,
          ),
        ]),
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  return results;
}

async function evaluateDatabaseWorkflow(): Promise<CommunityWorkflowEvaluationResult> {
  let app: INestApplicationContext | null = null;
  const created = {
    userIds: [] as string[],
    adminIds: [] as string[],
    contentIds: [] as string[],
  };
  const checks: CommunityEvaluationCheck[] = [];
  const cleanup = {
    attempted: false,
    completed: false,
    deletedOnlyEvaluationScopedRows: true,
    error: null as string | null,
  };

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    const dataSource = app.get(DataSource);
    assertDestructiveTestDatabaseResetAllowed({
      databaseName: dataSource.options.database,
      operation: 'Community database workflow evaluation',
    });
    const service = app.get(CommunityService);
    const suffix = Date.now().toString(36);
    const author = await createEvaluationUser(dataSource, {
      suffix: `${suffix}-author`,
      accountAgeDays: 10,
      acceptCommunityGuidelines: true,
      shelfProducts: [
        productFixture(
          'Ritora Eval',
          'Soft Cleanser',
          ProductCategory.Cleanser,
        ),
        productFixture(
          'Ritora Eval',
          'Barrier Cream',
          ProductCategory.Moisturizer,
        ),
        productFixture(
          'Ritora Eval',
          'Daily SPF 50',
          ProductCategory.SunProtection,
        ),
      ],
    });
    const reader = await createEvaluationUser(dataSource, {
      suffix: `${suffix}-reader`,
      accountAgeDays: 10,
      acceptCommunityGuidelines: true,
      shelfProducts: [
        productFixture(
          'Reader Eval',
          'Calm Cleanser',
          ProductCategory.Cleanser,
        ),
        productFixture(
          'Reader Eval',
          'Comfort Cream',
          ProductCategory.Moisturizer,
        ),
        productFixture(
          'Reader Eval',
          'Mineral SPF 50',
          ProductCategory.SunProtection,
        ),
      ],
    });
    const young = await createEvaluationUser(dataSource, {
      suffix: `${suffix}-young`,
      accountAgeDays: 0,
      acceptCommunityGuidelines: true,
      shelfProducts: [
        productFixture(
          'Young Eval',
          'Starter Cream',
          ProductCategory.Moisturizer,
        ),
      ],
    });
    created.userIds.push(author.userId, reader.userId, young.userId);
    const admin = await createEvaluationAdmin(dataSource, suffix);
    created.adminIds.push(admin.adminId);

    const youngEligibility = await service.getPostingEligibility(young.userId);
    checks.push(
      check(
        'young_account_is_not_eligible_to_post',
        !youngEligibility.eligible &&
          youngEligibility.reasons.some(
            (reason) => reason.code === 'account_too_new',
          ),
        'account_too_new',
        youngEligibility.reasons.map((reason) => reason.code),
      ),
    );
    const youngCreateReviewStatus = await rejectedStatus(() =>
      service.createReview(young.userId, safeReviewInput()),
    );
    checks.push(
      check(
        'young_account_create_review_returns_forbidden',
        youngCreateReviewStatus === 403,
        403,
        youngCreateReviewStatus,
      ),
    );

    const authorEligibility = await service.getPostingEligibility(
      author.userId,
    );
    checks.push(
      check(
        'eligible_author_can_post',
        authorEligibility.eligible,
        true,
        authorEligibility,
      ),
    );

    const reviewResult = await service.createReview(
      author.userId,
      safeReviewInput({
        contextProductId: author.products.cleanser,
        productId: author.products.moisturizer,
      }),
    );
    created.contentIds.push(reviewResult.item.id);
    checks.push(
      check(
        'safe_review_auto_published',
        reviewResult.moderationStatus === CommunityModerationStatus.Published,
        CommunityModerationStatus.Published,
        reviewResult.moderationStatus,
      ),
    );
    checks.push(
      check(
        'review_shelf_selection_stores_snapshot_details',
        reviewResult.item.product_id === author.products.moisturizer &&
          reviewResult.item.product_brand === 'Ritora Eval' &&
          reviewResult.item.product_name === 'Barrier Cream',
        'shelf product id plus brand/name snapshot',
        {
          productId: reviewResult.item.product_id,
          brand: reviewResult.item.product_brand,
          name: reviewResult.item.product_name,
        },
      ),
    );

    const publishedReviewEditStatus = await rejectedStatus(() =>
      service.updateReview(author.userId, reviewResult.item.id, {
        body: 'A small typo fix after publication.',
      }),
    );
    checks.push(
      check(
        'published_review_content_cannot_be_edited',
        publishedReviewEditStatus === 400,
        400,
        publishedReviewEditStatus,
      ),
    );

    const safeRoutine = await service.createRoutine(author.userId, {
      title: 'Community evaluation safe AM routine',
      summary: 'Gentle cleanse, moisturize, and sunscreen.',
      disclosureType: CommunityDisclosureType.Ordinary,
      concernTags: ['barrier'],
      goalTags: ['maintenance'],
      goalResult: CommunityGoalResult.MostlyImproved,
      timeframe: CommunityGoalTimeframe.EightWeeks,
      avoidTags: ['over-exfoliation'],
      habitTags: ['consistent-sleep'],
      didNotWorkTags: ['too-many-actives'],
      warningTags: ['patch-test-first'],
      steps: [
        {
          slot: 'am',
          productId: author.products.cleanser,
          category: ProductCategory.Cleanser,
          frequency: 'daily',
          notes: 'Gentle cleanser.',
        },
        {
          slot: 'am',
          productId: author.products.moisturizer,
          category: ProductCategory.Moisturizer,
          frequency: 'daily',
          notes: 'Barrier moisturizer.',
        },
        {
          slot: 'am',
          productId: author.products.sunscreen,
          category: ProductCategory.SunProtection,
          frequency: 'daily',
          notes: 'SPF 50 sunscreen.',
        },
      ],
    });
    created.contentIds.push(safeRoutine.id);
    checks.push(
      check(
        'safe_routine_auto_published',
        safeRoutine.moderationStatus === CommunityModerationStatus.Published,
        CommunityModerationStatus.Published,
        safeRoutine.moderationStatus,
      ),
    );

    const adaptation = await service.adaptRoutine(
      reader.userId,
      safeRoutine.id,
    );
    checks.push(
      check(
        'adaptation_maps_to_reader_shelf',
        adaptation.summary.swapped + adaptation.summary.kept >= 2,
        'at least two kept/swapped steps',
        adaptation.summary,
      ),
    );

    await service.voteRoutine(reader.userId, safeRoutine.id, {
      vote: CommunityHelpfulnessVote.Helpful,
    });
    const detailAfterVote = await service.getRoutine(
      reader.userId,
      safeRoutine.id,
    );
    checks.push(
      check(
        'helpfulness_vote_recounts',
        detailAfterVote.helpfulCount >= 1,
        'helpfulCount >= 1',
        detailAfterVote.helpfulCount,
      ),
    );

    const routineSignal = await service.signalRoutineOutcome(
      reader.userId,
      safeRoutine.id,
      {
        signal: CommunityOutcomeSignal.WorkedForMeToo,
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.EightWeeks,
        followedParts: [
          CommunityOutcomeFollowedPart.Products,
          CommunityOutcomeFollowedPart.RoutineTiming,
          CommunityOutcomeFollowedPart.Habits,
        ],
        irritationLevel: CommunityOutcomeIrritationLevel.None,
      },
    );
    checks.push(
      check(
        'routine_outcome_confirmation_tracks_context',
        routineSignal.context.sameGoal &&
          routineSignal.context.followedParts.includes(
            CommunityOutcomeFollowedPart.Habits,
          ) &&
          routineSignal.outcomeSignalCounts[
            CommunityOutcomeSignal.WorkedForMeToo
          ] >= 1,
        'same goal, habits followed, count incremented',
        routineSignal,
      ),
    );

    const reviewSignal = await service.signalReviewOutcome(
      reader.userId,
      reviewResult.item.id,
      {
        signal: CommunityOutcomeSignal.WorkedForMeToo,
        sameGoal: true,
        trialDuration: CommunityOutcomeTrialDuration.FourWeeks,
        followedParts: [CommunityOutcomeFollowedPart.Products],
        irritationLevel: CommunityOutcomeIrritationLevel.None,
      },
    );
    checks.push(
      check(
        'review_outcome_confirmation_tracks_context',
        reviewSignal.context.trialDuration ===
          CommunityOutcomeTrialDuration.FourWeeks &&
          reviewSignal.outcomeSignalCounts[
            CommunityOutcomeSignal.WorkedForMeToo
          ] >= 1,
        'trial duration and count incremented',
        reviewSignal,
      ),
    );

    const productEvidence = await service.getProductEvidence(
      author.userId,
      author.products.moisturizer,
    );
    checks.push(
      check(
        'product_evidence_aggregates_reviews_playbooks_and_confirmations',
        productEvidence.reviewCount >= 1 &&
          productEvidence.playbookCount >= 1 &&
          productEvidence.similarOutcomeConfirmationCount >= 2 &&
          productEvidence.averageEffectivenessRating === 4 &&
          productEvidence.topAvoids.some(
            (item) => item.value === 'over-exfoliation',
          ),
        'review, playbook, similar confirmations, ratings, avoid tags',
        productEvidence,
      ),
    );

    const riskyRoutine = await service.createRoutine(author.userId, {
      title: 'Community evaluation high-risk routine',
      summary: 'This cured my acne with nightly retinol and glycolic acid.',
      disclosureType: CommunityDisclosureType.Ordinary,
      concernTags: ['acne'],
      goalTags: ['texture'],
      goalResult: CommunityGoalResult.Mixed,
      timeframe: CommunityGoalTimeframe.FourWeeks,
      avoidTags: ['over-exfoliation'],
      habitTags: ['consistent-sleep'],
      didNotWorkTags: ['nightly-acids'],
      warningTags: ['go-slow-if-sensitive'],
      steps: [
        {
          slot: 'pm',
          category: ProductCategory.Treatment,
          productName: 'Retinol treatment',
          frequency: 'nightly',
          notes: 'Retinol treatment.',
        },
        {
          slot: 'pm',
          category: ProductCategory.Exfoliant,
          productName: 'Glycolic acid toner',
          frequency: 'nightly',
          notes: 'Glycolic acid toner.',
        },
      ],
    });
    created.contentIds.push(riskyRoutine.id);
    checks.push(
      check(
        'critical_routine_goes_to_admin_queue',
        riskyRoutine.moderationStatus ===
          CommunityModerationStatus.PendingReview &&
          riskyRoutine.safetyFlags.some(
            (flag) => flag.severity === CommunitySafetySeverity.High,
          ),
        CommunityModerationStatus.PendingReview,
        {
          status: riskyRoutine.moderationStatus,
          flags: riskyRoutine.safetyFlags,
        },
      ),
    );

    const needsEditReview = await service.createReview(author.userId, {
      ...safeReviewInput(),
      body: 'Use my code EVAL10. I may earn a commission if you buy it.',
      disclosureType: CommunityDisclosureType.Ordinary,
      productName: 'Commission Serum',
    });
    created.contentIds.push(needsEditReview.item.id);
    checks.push(
      check(
        'noncritical_disclosure_issue_needs_edit_without_admin',
        needsEditReview.moderationStatus ===
          CommunityModerationStatus.NeedsEdit,
        CommunityModerationStatus.NeedsEdit,
        needsEditReview.moderationStatus,
      ),
    );

    const correctedReview = await service.updateReview(
      author.userId,
      needsEditReview.item.id,
      {
        disclosureType: CommunityDisclosureType.Affiliate,
        body: 'Affiliate context is now disclosed. I used it for four weeks and results may vary.',
      },
    );
    checks.push(
      check(
        'returned_review_can_be_edited_and_resubmitted',
        correctedReview.moderationStatus ===
          CommunityModerationStatus.Published,
        CommunityModerationStatus.Published,
        correctedReview.moderationStatus,
      ),
    );

    const queue = await service.listAdminModeration({
      status: CommunityModerationStatus.PendingReview,
      contentType: CommunityContentType.Routine,
      severity: CommunitySafetySeverity.High,
      search: 'high-risk',
    });
    checks.push(
      check(
        'admin_queue_filters_find_critical_item',
        queue.items.some((item) => item.id === riskyRoutine.id),
        riskyRoutine.id,
        queue.items.map((item) => item.id),
      ),
    );

    const assigned = await service.assignContent(
      admin.adminId,
      riskyRoutine.id,
      {
        assignedAdminId: admin.adminId,
        reason: 'Community evaluation assignment.',
      },
    );
    checks.push(
      check(
        'admin_assignment_sets_owner',
        assigned.assignedAdminId === admin.adminId,
        admin.adminId,
        assigned.assignedAdminId,
      ),
    );

    const adminDetail = await service.getAdminContentDetail(riskyRoutine.id);
    checks.push(
      check(
        'admin_detail_contains_safety_scan_history',
        adminDetail.safetyScans.length > 0 &&
          adminDetail.safetyScans.some((scan) => scan.result.automation),
        'safety scan with automation snapshot',
        adminDetail.safetyScans,
      ),
    );

    const report = await service.reportRoutine(reader.userId, safeRoutine.id, {
      reason: CommunityReportReason.UnsafeAdvice,
      note: 'Community evaluation severe report.',
    });
    const safeRoutineAfterReport = await service.getRoutine(
      author.userId,
      safeRoutine.id,
    );
    checks.push(
      check(
        'severe_report_removes_content_from_ranking',
        report.status === CommunityReportStatus.Open &&
          safeRoutineAfterReport.moderationStatus ===
            CommunityModerationStatus.PendingReview,
        {
          reportStatus: CommunityReportStatus.Open,
          contentStatus: CommunityModerationStatus.PendingReview,
        },
        {
          reportStatus: report.status,
          contentStatus: safeRoutineAfterReport.moderationStatus,
        },
      ),
    );

    const publicRoutinePayload = JSON.stringify(
      await service.getRoutine(author.userId, safeRoutine.id),
    );
    checks.push(
      check(
        'public_payload_does_not_expose_email_or_exact_location',
        !publicRoutinePayload.includes('@') &&
          !publicRoutinePayload.toLowerCase().includes('stockholm') &&
          !publicRoutinePayload.toLowerCase().includes('medical'),
        'no email, exact city, or medical context',
        publicRoutinePayload.slice(0, 500),
      ),
    );

    await service.withdrawContent(author.userId, reviewResult.item.id);
    const productEvidenceAfterWithdraw = await service.getProductEvidence(
      author.userId,
      author.products.moisturizer,
    );
    checks.push(
      check(
        'withdrawn_review_is_removed_from_product_evidence',
        productEvidenceAfterWithdraw.reviewCount === 0 &&
          productEvidenceAfterWithdraw.averageOverallRating === null,
        'no review evidence after withdrawal',
        productEvidenceAfterWithdraw,
      ),
    );
  } catch (error) {
    checks.push(
      check(
        'database_workflow_completed_without_unhandled_error',
        false,
        'no unhandled error',
        error instanceof Error ? error.message : String(error),
      ),
    );
  } finally {
    cleanup.attempted = true;
    if (app) {
      try {
        await cleanupEvaluationRows(app.get(DataSource), created);
        cleanup.completed = true;
      } catch (error) {
        cleanup.error = error instanceof Error ? error.message : String(error);
      }
      await app.close();
    }
  }

  return {
    enabled: true,
    status:
      checks.every((item) => item.passed) && cleanup.completed
        ? 'passed'
        : 'failed',
    checks,
    created,
    cleanup,
  };
}

function moderationCaseChecks(
  evaluationCase: CommunityModerationEvaluationCase,
  scannedFlags: CommunitySafetyFlag[],
  automation: CommunityModerationAutomationSnapshot,
  status: CommunityModerationStatus,
): CommunityEvaluationCheck[] {
  const flagCodes = scannedFlags.map((flag) => flag.code);
  return [
    check(
      'expected_status',
      status === evaluationCase.expectedStatus,
      evaluationCase.expectedStatus,
      status,
    ),
    check(
      'expected_action',
      automation.action === evaluationCase.expectedAction,
      evaluationCase.expectedAction,
      automation.action,
    ),
    check(
      'expected_handler',
      automation.handledBy === evaluationCase.expectedHandledBy,
      evaluationCase.expectedHandledBy,
      automation.handledBy,
    ),
    check(
      'required_flags_present',
      evaluationCase.requiredFlagCodes.every((code) =>
        flagCodes.includes(code),
      ),
      evaluationCase.requiredFlagCodes,
      flagCodes,
    ),
    check(
      'risky_content_not_published',
      evaluationCase.expectedStatus === CommunityModerationStatus.Published ||
        status !== CommunityModerationStatus.Published,
      'not published for risky cases',
      status,
    ),
    check(
      'live_ai_used_when_required',
      !evaluationCase.requireLiveAi ||
        (automation.provider === 'openai' &&
          automation.fallbackReason === null),
      'openai provider without fallback',
      {
        provider: automation.provider,
        fallbackReason: automation.fallbackReason,
      },
    ),
    check(
      'reason_is_user_safe',
      !/\b(prompt|schema|system message)\b/i.test(automation.reason),
      'no prompt/schema/internal language',
      automation.reason,
    ),
    check(
      'confidence_is_valid',
      automation.confidence >= 0 && automation.confidence <= 1,
      '0..1',
      automation.confidence,
    ),
  ];
}

function scanCase(
  safety: CommunitySafetyService,
  evaluationCase: CommunityModerationEvaluationCase,
) {
  return [
    ...safety.scanText(evaluationCase.text),
    ...safety.scanRoutine(evaluationCase.steps ?? []),
  ];
}

function caseText(evaluationCase: CommunityModerationEvaluationCase) {
  return [
    evaluationCase.text,
    ...(evaluationCase.steps ?? []).map((step) =>
      [step.productBrand, step.productName, step.category, step.notes]
        .filter(Boolean)
        .join(' '),
    ),
  ].join(' ');
}

function simulationResult(
  id: string,
  checks: CommunityEvaluationCheck[],
): CommunityGuardrailSimulationResult {
  return {
    id,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
  };
}

function check(
  code: string,
  passed: boolean,
  expected: unknown,
  actual: unknown,
): CommunityEvaluationCheck {
  return { code, passed, expected, actual };
}

function skippedWorkflow(): CommunityWorkflowEvaluationResult {
  return {
    enabled: false,
    status: 'skipped',
    checks: [],
    created: { userIds: [], adminIds: [], contentIds: [] },
    cleanup: {
      attempted: false,
      completed: true,
      deletedOnlyEvaluationScopedRows: true,
      error: null,
    },
  };
}

function configServiceFromEnv(): ConfigService {
  return configServiceFromRecord(process.env as Record<string, string>);
}

function configServiceFromRecord(
  values: Record<string, string>,
): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined =>
      values[key] as T | undefined,
  } as ConfigService;
}

async function rejectedStatus(
  action: () => Promise<unknown>,
): Promise<number | 'resolved' | 'unknown'> {
  try {
    await action();
    return 'resolved';
  } catch (error) {
    const maybeStatus = error as { getStatus?: () => number; status?: number };
    return maybeStatus.getStatus?.() ?? maybeStatus.status ?? 'unknown';
  }
}

type EvaluationProduct = {
  brand: string;
  name: string;
  category: ProductCategory;
};

type EvaluationUser = {
  userId: string;
  products: Record<string, string>;
};

function productFixture(
  brand: string,
  name: string,
  category: ProductCategory,
): EvaluationProduct {
  return { brand, name, category };
}

async function createEvaluationUser(
  dataSource: DataSource,
  input: {
    suffix: string;
    accountAgeDays: number;
    acceptCommunityGuidelines: boolean;
    shelfProducts: EvaluationProduct[];
  },
): Promise<EvaluationUser> {
  const userRepo = dataSource.getRepository(User);
  const user = await userRepo.save(
    userRepo.create({
      email: `community-eval-${input.suffix}@example.invalid`,
      canonical_email: `community-eval-${input.suffix}@example.invalid`,
      first_name: 'Community',
      last_name: 'Evaluation',
      email_verified: true,
      preferred_language: 'en',
      time_zone: 'Europe/Stockholm',
      date_of_birth: '1992-04-15',
      sex_at_birth: 'female',
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
    }),
  );
  if (input.accountAgeDays > 0) {
    await dataSource.query(
      `UPDATE "users" SET "created_at" = now() - ($1::int * interval '1 day') WHERE "id" = $2`,
      [input.accountAgeDays, user.id],
    );
  }

  const profileRepo = dataSource.getRepository(SkinProfile);
  await profileRepo.save(
    profileRepo.create({
      user_id: user.id,
      skin_type: 'combination',
      skin_tone: 'medium',
      ethnicity: 'black',
      current_concerns: ['acne', 'dark_marks'],
      country_code: 'SE',
      city: 'Stockholm',
      fitzpatrick_phototype: 'IV',
      sensitivity_level: 'medium',
      hydration_level: 'balanced',
      primary_goal: 'barrier support',
      pregnancy_status: null,
      under_dermatologist_care: null,
      allow_smart_picks: true,
      budget_tier: 'mid',
      safety_context: {},
      reaction_history: { has_known_reactions: false, entries: [] },
      concern_details: {
        per_concern: [
          { concern: 'acne', severity: 'moderate', priority: 1 },
          { concern: 'dark_marks', severity: 'mild', priority: 2 },
        ],
      },
      skin_behavior: {
        burn_tendency: 'sometimes',
        tan_tendency: 'often',
        pih_tendency: 'often',
        melasma_tendency: 'never',
        keloid_tendency: 'never',
        sunscreen_habit: 'most_days',
        sunscreen_tolerance: 'fine',
      },
      active_tolerances: { retinoid: { tolerance: 'low' } },
      routine_preferences: {
        pace: 'cautious',
        fragrance_free: true,
        non_comedogenic: true,
        sunscreen_filter: 'mineral',
        sunscreen_finish: 'natural',
      },
      lifestyle_context: {
        water_hardness: 'unknown',
        water_sensitivity: 'none',
      },
      shopping_preferences: {},
      hormonal_context: {},
    }),
  );

  if (input.acceptCommunityGuidelines) {
    const consentRepo = dataSource.getRepository(UserConsent);
    await consentRepo.save(
      consentRepo.create({
        user_id: user.id,
        consent_type: UserConsentType.CommunityGuidelines,
        consent_version: '1.0.0',
        granted: true,
        granted_at: new Date(),
        revoked_at: null,
        ip_address: '127.0.0.1',
      }),
    );
  }

  const products: Record<string, string> = {};
  for (const product of input.shelfProducts) {
    const saved = await createEvaluationProduct(dataSource, user.id, product);
    products[product.category.replace('-', '_')] = saved.id;
    if (product.category === ProductCategory.Cleanser)
      products.cleanser = saved.id;
    if (product.category === ProductCategory.Moisturizer)
      products.moisturizer = saved.id;
    if (product.category === ProductCategory.SunProtection)
      products.sunscreen = saved.id;
  }

  return { userId: user.id, products };
}

async function createEvaluationProduct(
  dataSource: DataSource,
  userId: string,
  product: EvaluationProduct,
) {
  const repo = dataSource.getRepository(InventoryProduct);
  const searchDocument =
    `${product.brand} ${product.name} ${product.category}`.toLowerCase();
  return repo.save(
    repo.create({
      user_id: userId,
      brand: product.brand,
      name: product.name,
      category: product.category,
      barcode: null,
      status: ShelfStatus.Active,
      provenance: DataProvenance.PhotoLookup,
      brand_search: product.brand.toLowerCase(),
      name_search: product.name.toLowerCase(),
      search_document: searchDocument,
      opened_at: null,
      expires_at: null,
      period_after_opening_months: null,
      effective_expires_at: null,
      identity: {
        brand: product.brand,
        name: product.name,
        category: product.category,
        barcode: null,
        imageUrls: [],
        sizeMl: null,
        description: null,
        benefits: [],
        suitedFor: [],
        inciIngredients: [],
        inciLastConfirmedAt: null,
      },
      guidance: {
        applicationMethod: ApplicationMethod.Fingertips,
        quantity: Quantity.AsNeeded,
        steps: [],
        cautions: [],
        waitMinutes: null,
      },
      manufacturer: {
        brand: product.brand,
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
        preferredTimeOfDay: PreferredTimeOfDay.Either,
      },
    }),
  );
}

async function createEvaluationAdmin(dataSource: DataSource, suffix: string) {
  const repo = dataSource.getRepository(AdminAccount);
  const admin = await repo.save(
    repo.create({
      email: `community-eval-admin-${suffix}@example.invalid`,
      canonical_email: `community-eval-admin-${suffix}@example.invalid`,
      name: 'Community Evaluation Admin',
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
      accepted_at: new Date(),
      last_login_at: null,
      deleted_at: null,
    }),
  );
  return { adminId: admin.id };
}

function safeReviewInput(
  input: {
    contextProductId?: string;
    productId?: string;
  } = {},
) {
  return {
    productId: input.productId,
    productBrand: 'Ritora Eval',
    productName: 'Barrier Cream',
    productCategory: ProductCategory.Moisturizer,
    disclosureType: CommunityDisclosureType.Ordinary,
    usageDuration: '4-weeks',
    frequency: 'daily',
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
        productId: input.contextProductId,
        productName: input.contextProductId ? undefined : 'Milky Cleanser',
      },
    ],
    body: 'I bought this myself and it felt comfortable in a simple routine.',
  };
}

async function cleanupEvaluationRows(
  dataSource: DataSource,
  created: {
    userIds: string[];
    adminIds: string[];
    contentIds: string[];
  },
) {
  await dataSource.transaction(async (manager) => {
    if (created.contentIds.length > 0) {
      await manager.delete(CommunitySafetyScanResult, {
        content_id: In(created.contentIds),
      });
      await manager.delete(CommunityModerationDecision, {
        content_id: In(created.contentIds),
      });
      await manager.delete(CommunityReport, {
        content_id: In(created.contentIds),
      });
      await manager.delete(CommunityHelpfulnessVoteEntity, {
        content_id: In(created.contentIds),
      });
      await manager.delete(CommunityOutcomeSignalVote, {
        content_id: In(created.contentIds),
      });
      await manager.delete(CommunityRoutineAdaptation, {
        routine_id: In(created.contentIds),
      });
    }
    if (created.userIds.length > 0) {
      await manager.delete(CommunityReport, {
        reporter_user_id: In(created.userIds),
      });
      await manager.delete(CommunityHelpfulnessVoteEntity, {
        user_id: In(created.userIds),
      });
      await manager.delete(CommunityOutcomeSignalVote, {
        user_id: In(created.userIds),
      });
      await manager.delete(CommunityRoutineAdaptation, {
        user_id: In(created.userIds),
      });
      await manager.delete(CommunityRoutine, {
        author_user_id: In(created.userIds),
      });
      await manager.delete(CommunityReview, {
        author_user_id: In(created.userIds),
      });
      await manager.delete(CommunityProfile, {
        user_id: In(created.userIds),
      });
      await manager.delete(InAppNotification, {
        user_id: In(created.userIds),
      });
      await manager.delete(InventoryProduct, {
        user_id: In(created.userIds),
      });
      await manager.delete(SkinProfile, {
        user_id: In(created.userIds),
      });
      await manager.delete(UserConsent, {
        user_id: In(created.userIds),
      });
      await manager.delete(User, {
        id: In(created.userIds),
      });
    }
    if (created.adminIds.length > 0 || created.userIds.length > 0) {
      await manager.query(
        `
          DELETE FROM "admin_audit_logs"
          WHERE "actor_admin_id" = ANY($1::varchar[])
             OR "target_user_id" = ANY($2::varchar[])
        `,
        [created.adminIds, created.userIds],
      );
    }
    if (created.adminIds.length > 0) {
      await manager.delete(AdminAuditLog, {
        actor_admin_id: In(created.adminIds),
      });
      await manager.delete(AdminAccount, {
        id: In(created.adminIds),
      });
    }
  });
}
