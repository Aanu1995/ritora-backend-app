import { createHash } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, IsNull, Repository } from 'typeorm';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import { DEFAULT_TIME_ZONE } from '../common/timezone/timezone.utils';
import { AppModule } from '../app.module';
import { DayOfWeek, DAYS_OF_WEEK } from '../schedule/dto/schedule.constants';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { User } from '../users/entities/user.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import {
  SuggestionGenerationJobStatus,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions/suggestions.constants';
import {
  SuggestionAiGenerator,
  type SuggestionGenerationStepOutput,
} from '../suggestions/services/suggestion-ai-generator';
import { SuggestionGenerationContextService } from '../suggestions/services/suggestion-generation-context.service';
import { resolveSuggestionProductScores } from '../suggestions/services/suggestion-product-score-resolver';
import {
  isPreferredTimeCompatibleWithDaypart,
  isSingleUseSuggestionCategory,
} from '../suggestions/services/suggestion-product-intelligence';

type AccountSelectionRow = {
  id: string;
  active_product_count: string;
  slot_count: string;
};

export type SlotEvaluationResult = {
  targetDate: string;
  targetDay: DayOfWeek;
  slotIdHash: string;
  slotTime: string;
  daypart: string;
  provider: string | null;
  fallbackReason: string | null;
  activeProductCount: number;
  activeCategoryCounts: Record<string, number>;
  scoreDiagnostics: {
    productHash: string;
    category: string;
    preferredTimeOfDay: string | null;
    suitabilityScore: number;
    dataQuality: string;
    activeTags: string[];
    cautionReasons: string[];
  }[];
  stepCount: number;
  stepCategories: string[];
  stepProductHashes: string[];
  stepSignatureHash: string;
  failures: string[];
};

type DayEvaluationResult = {
  targetDate: string;
  targetDay: DayOfWeek;
  slots: SlotEvaluationResult[];
};

export type DiversitySummary = {
  evaluatedDays: number;
  evaluatedSlots: number;
  distinctSelectedProductCount: number;
  distinctStepSignatureCount: number;
  productUseCounts: {
    productHash: string;
    category: string | null;
    count: number;
  }[];
  daypartSummaries: {
    daypart: string;
    slotCount: number;
    distinctSelectedProductCount: number;
    distinctStepSignatureCount: number;
    repeatedSignatures: {
      stepSignatureHash: string;
      count: number;
      stepCategories: string[];
      stepProductHashes: string[];
    }[];
  }[];
  slotPatternSummaries: {
    slotKey: string;
    slotTime: string;
    daypart: string;
    daysEvaluated: number;
    distinctStepSignatureCount: number;
    repeatedSignatures: {
      stepSignatureHash: string;
      count: number;
      dates: string[];
      stepCategories: string[];
      stepProductHashes: string[];
    }[];
  }[];
  warnings: string[];
};

async function runAccountEvaluation(): Promise<number> {
  loadEnvFiles(evaluationEnvFilePaths(process.env.EVAL_ENV_FILE));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const userRepo = dataSource.getRepository(User);
    const slotRepo = dataSource.getRepository(ScheduleSlot);
    const contextService = app.get(SuggestionGenerationContextService);
    const aiGenerator = app.get(SuggestionAiGenerator);

    const user = await resolveEvaluationUser(dataSource, userRepo);
    const timeZone = user.time_zone ?? DEFAULT_TIME_ZONE;
    const startDate =
      process.env.SUGGESTION_EVALUATION_START_DATE?.trim() ||
      process.env.SUGGESTION_EVALUATION_TARGET_DATE?.trim() ||
      dateInTimeZone(timeZone);
    const dayCount = readDayCount();
    const days: DayEvaluationResult[] = [];
    for (let offset = 0; offset < dayCount; offset += 1) {
      const targetDate = addDays(startDate, offset);
      const targetDay = dayOfWeek(targetDate, timeZone);
      const slots = await loadEvaluationSlots(slotRepo, user.id, targetDay, {
        fallbackToAllSlots: dayCount === 1,
      });
      const slotsForDay: SlotEvaluationResult[] = [];
      for (const slot of slots) {
        const slotStartedAt = Date.now();
        console.error(
          `[account-eval] start date=${targetDate} day=${targetDay} slot=${slot.slot_time}`,
        );
        const result = await evaluateSlot({
          aiGenerator,
          contextService,
          user,
          slot,
          targetDate,
          targetDay,
        });
        console.error(
          `[account-eval] done date=${targetDate} day=${targetDay} slot=${
            slot.slot_time
          } provider=${result.provider ?? 'unknown'} fallback=${
            result.fallbackReason ?? 'none'
          } steps=${result.stepCount} durationMs=${Date.now() - slotStartedAt}`,
        );
        slotsForDay.push(result);
      }
      days.push({ targetDate, targetDay, slots: slotsForDay });
    }

    const results = days.flatMap((day) => day.slots);
    if (results.length === 0) {
      throw new Error(
        'No schedule slots were found across the selected evaluation dates.',
      );
    }
    const failed = results.filter((result) => result.failures.length > 0);
    const diversity = buildDiversitySummary(results);
    console.log(
      JSON.stringify(
        {
          startDate,
          dayCount,
          userHash: hashId(user.id),
          evaluatedDays: days.length,
          evaluatedSlots: results.length,
          failedSlots: failed.length,
          diversity,
          days,
        },
        null,
        2,
      ),
    );
    return exitCodeForAccountSuggestionEvaluation({
      failedSlotCount: failed.length,
      diversityWarnings: diversity.warnings,
    });
  } finally {
    await app.close();
  }
}

export function exitCodeForAccountSuggestionEvaluation(input: {
  failedSlotCount: number;
  diversityWarnings: readonly string[];
}): number {
  return input.failedSlotCount > 0 || input.diversityWarnings.length > 0
    ? 1
    : 0;
}

async function evaluateSlot(input: {
  aiGenerator: SuggestionAiGenerator;
  contextService: SuggestionGenerationContextService;
  user: User;
  slot: ScheduleSlot;
  targetDate: string;
  targetDay: DayOfWeek;
}): Promise<SlotEvaluationResult> {
  const inputs = await input.contextService.buildScheduled({
    user: input.user,
    job: evaluationJob(input.user.id, input.slot, input.targetDate),
    slot: input.slot,
    targetDate: input.targetDate,
    targetTime: input.slot.slot_time,
  });
  const output = await input.aiGenerator.generate(inputs);
  const productScores = new Map(
    resolveSuggestionProductScores(inputs).map((score) => [
      score.productId,
      score,
    ]),
  );
  const activeProductIds = new Set(
    inputs.shelfActiveProducts.map((product) => product.id),
  );
  const lockedProductIds = new Set(
    inputs.routineSteps
      .filter((step) => step.is_specialist_locked)
      .map((step) => step.inventory_product_id)
      .filter((productId): productId is string => Boolean(productId)),
  );
  const failures: string[] = [];

  if (output.metadata.provider === 'deterministic_baseline') {
    failures.push('deterministic fallback provider used');
  }
  if (output.metadata.fallbackReason) {
    failures.push(`fallback reason present: ${output.metadata.fallbackReason}`);
  }
  if (
    output.steps.length === 0 &&
    inputs.shelfActiveProducts.length > 0 &&
    output.gapRecommendations.length === 0
  ) {
    failures.push('empty action plan despite active shelf products');
  }
  for (const step of output.steps) {
    if (
      step.inventoryProductId &&
      !activeProductIds.has(step.inventoryProductId) &&
      !lockedProductIds.has(step.inventoryProductId)
    ) {
      failures.push('step uses product outside active shelf');
    }
    if (
      step.provenance === SuggestionStepProvenance.AiAdded &&
      step.inventoryProductId
    ) {
      const score = productScores.get(step.inventoryProductId);
      if (
        !isPreferredTimeCompatibleWithDaypart(
          score?.preferredTimeOfDay,
          inputs.daypart,
        )
      ) {
        failures.push('AI step violates product preferred time');
      }
    }
  }
  for (const failure of singleUseCategoryFailures(
    output.steps,
    productScores,
  )) {
    failures.push(failure);
  }

  const stepProductHashes = output.steps
    .map((step) =>
      step.inventoryProductId ? hashId(step.inventoryProductId) : null,
    )
    .filter((value): value is string => Boolean(value));

  return {
    targetDate: input.targetDate,
    targetDay: input.targetDay,
    slotIdHash: hashId(input.slot.id),
    slotTime: input.slot.slot_time,
    daypart: inputs.daypart,
    provider: output.metadata.provider ?? null,
    fallbackReason: output.metadata.fallbackReason ?? null,
    activeProductCount: inputs.shelfActiveProducts.length,
    activeCategoryCounts: countBy(
      inputs.shelfActiveProducts.map((product) => product.category),
    ),
    scoreDiagnostics: [...productScores.values()].map((score) => ({
      productHash: hashId(score.productId),
      category: score.category,
      preferredTimeOfDay: score.preferredTimeOfDay ?? null,
      suitabilityScore: score.suitabilityScore,
      dataQuality: score.dataQuality,
      activeTags: score.activeTags,
      cautionReasons: score.cautionReasons,
    })),
    stepCount: output.steps.length,
    stepCategories: output.steps.map((step) => step.stepLabel),
    stepProductHashes,
    stepSignatureHash: hashId(stepProductHashes.join('|')),
    failures: Array.from(new Set(failures)),
  };
}

function singleUseCategoryFailures(
  steps: readonly SuggestionGenerationStepOutput[],
  productScores: ReadonlyMap<
    string,
    ReturnType<typeof resolveSuggestionProductScores>[number]
  >,
): string[] {
  const selectedByCategory = new Map<string, string[]>();
  for (const step of steps) {
    if (step.provenance === SuggestionStepProvenance.SpecialistLocked) {
      continue;
    }
    const category = step.inventoryProductId
      ? (productScores.get(step.inventoryProductId)?.category ?? null)
      : null;
    if (!category || !isSingleUseSuggestionCategory(category)) continue;
    selectedByCategory.set(category, [
      ...(selectedByCategory.get(category) ?? []),
      step.inventoryProductId ?? `step-${step.stepOrder}`,
    ]);
  }
  return [...selectedByCategory.entries()].flatMap(([category, productIds]) =>
    productIds.length > 1
      ? [
          `single-use category selected more than once: ${category} (${productIds.join(
            ', ',
          )})`,
        ]
      : [],
  );
}

async function resolveEvaluationUser(
  dataSource: DataSource,
  userRepo: Repository<User>,
): Promise<User> {
  const configuredUserId = process.env.SUGGESTION_EVALUATION_USER_ID?.trim();
  if (configuredUserId) {
    const user = await userRepo.findOne({ where: { id: configuredUserId } });
    if (!user) throw new Error('Configured evaluation user was not found.');
    return user;
  }

  const configuredEmail = process.env.SUGGESTION_EVALUATION_EMAIL?.trim();
  if (configuredEmail) {
    const user = await userRepo.findOne({
      where: { canonical_email: configuredEmail.toLowerCase() },
    });
    if (!user) throw new Error('Configured evaluation email was not found.');
    return user;
  }

  const rows = await dataSource.query<AccountSelectionRow[]>(
    `
      SELECT
        users.id,
        COUNT(DISTINCT inventory_products.id) AS active_product_count,
        COUNT(DISTINCT schedule_slots.id) AS slot_count
      FROM users
      LEFT JOIN inventory_products
        ON inventory_products.user_id = users.id
       AND inventory_products.status = 'active'
      LEFT JOIN schedule_slots
        ON schedule_slots.user_id = users.id
       AND schedule_slots.deleted_at IS NULL
      WHERE users.account_deletion_requested_at IS NULL
      GROUP BY users.id
      ORDER BY active_product_count DESC, slot_count DESC, users.updated_at DESC
      LIMIT 1
    `,
  );
  const selected = rows[0];
  if (!selected) throw new Error('No evaluation user was found.');
  const user = await userRepo.findOne({ where: { id: selected.id } });
  if (!user) throw new Error('Selected evaluation user was not found.');
  return user;
}

async function loadEvaluationSlots(
  slotRepo: Repository<ScheduleSlot>,
  userId: string,
  targetDay: DayOfWeek,
  options: { fallbackToAllSlots: boolean },
): Promise<ScheduleSlot[]> {
  const slotsForDay = await slotRepo.find({
    where: { user_id: userId, day_of_week: targetDay, deleted_at: IsNull() },
    relations: ['steps', 'steps.product'],
    order: { slot_time: 'ASC' },
  });
  if (slotsForDay.length > 0) return slotsForDay;
  if (!options.fallbackToAllSlots) return [];

  return slotRepo.find({
    where: { user_id: userId, deleted_at: IsNull() },
    relations: ['steps', 'steps.product'],
    order: { day_of_week: 'ASC', slot_time: 'ASC' },
  });
}

function evaluationJob(
  userId: string,
  slot: ScheduleSlot,
  targetDate: string,
): SuggestionGenerationJob {
  return {
    id: `eval-${slot.id}`,
    user_id: userId,
    slot_id: slot.id,
    suggestion_instance_id: null,
    target_date: targetDate,
    target_time: slot.slot_time,
    visible_at: new Date(),
    request_source: SuggestionRequestSource.Scheduled,
    status: SuggestionGenerationJobStatus.Running,
    attempt_count: 1,
    run_after: new Date(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    user: null,
    slot,
    suggestion_instance: null,
  } as unknown as SuggestionGenerationJob;
}

export function buildDiversitySummary(
  results: readonly SlotEvaluationResult[],
): DiversitySummary {
  const productCategoryByHash = new Map<string, string | null>();
  for (const result of results) {
    for (const score of result.scoreDiagnostics) {
      productCategoryByHash.set(score.productHash, score.category);
    }
  }

  const productUseCounts = [
    ...countMap(results.flatMap((result) => result.stepProductHashes)),
  ]
    .map(([productHash, count]) => ({
      productHash,
      category: productCategoryByHash.get(productHash) ?? null,
      count,
    }))
    .sort((left, right) => right.count - left.count);

  const daypartSummaries = [...groupBy(results, (result) => result.daypart)]
    .map(([daypart, daypartResults]) => ({
      daypart,
      slotCount: daypartResults.length,
      distinctSelectedProductCount: new Set(
        daypartResults.flatMap((result) => result.stepProductHashes),
      ).size,
      distinctStepSignatureCount: new Set(
        daypartResults.map((result) => result.stepSignatureHash),
      ).size,
      repeatedSignatures: repeatedSignatureSummaries(daypartResults).map(
        (summary) => ({
          stepSignatureHash: summary.stepSignatureHash,
          count: summary.count,
          stepCategories: summary.stepCategories,
          stepProductHashes: summary.stepProductHashes,
        }),
      ),
    }))
    .sort((left, right) => left.daypart.localeCompare(right.daypart));

  const slotPatternSummaries = [
    ...groupBy(results, (result) => `${result.slotTime}:${result.daypart}`),
  ]
    .map(([slotKey, slotResults]) => ({
      slotKey,
      slotTime: slotResults[0]?.slotTime ?? '',
      daypart: slotResults[0]?.daypart ?? '',
      daysEvaluated: slotResults.length,
      distinctStepSignatureCount: new Set(
        slotResults.map((result) => result.stepSignatureHash),
      ).size,
      repeatedSignatures: repeatedSignatureSummaries(slotResults).map(
        (summary) => ({
          stepSignatureHash: summary.stepSignatureHash,
          count: summary.count,
          dates: summary.results.map((result) => result.targetDate),
          stepCategories: summary.stepCategories,
          stepProductHashes: summary.stepProductHashes,
        }),
      ),
    }))
    .sort(
      (left, right) =>
        left.daypart.localeCompare(right.daypart) ||
        left.slotTime.localeCompare(right.slotTime),
    );

  return {
    evaluatedDays: new Set(results.map((result) => result.targetDate)).size,
    evaluatedSlots: results.length,
    distinctSelectedProductCount: new Set(
      results.flatMap((result) => result.stepProductHashes),
    ).size,
    distinctStepSignatureCount: new Set(
      results.map((result) => result.stepSignatureHash),
    ).size,
    productUseCounts,
    daypartSummaries,
    slotPatternSummaries,
    warnings: diversityWarnings(
      results,
      daypartSummaries,
      slotPatternSummaries,
    ),
  };
}

function repeatedSignatureSummaries(results: readonly SlotEvaluationResult[]) {
  return [...groupBy(results, (result) => result.stepSignatureHash)]
    .map(([, signatureResults]) => ({
      stepSignatureHash: signatureResults[0]?.stepSignatureHash ?? '',
      count: signatureResults.length,
      stepCategories: signatureResults[0]?.stepCategories ?? [],
      stepProductHashes: signatureResults[0]?.stepProductHashes ?? [],
      results: signatureResults,
    }))
    .filter((summary) => summary.count > 1)
    .sort((left, right) => right.count - left.count);
}

function diversityWarnings(
  results: readonly SlotEvaluationResult[],
  daypartSummaries: DiversitySummary['daypartSummaries'],
  slotPatternSummaries: DiversitySummary['slotPatternSummaries'],
): string[] {
  const warnings: string[] = [];
  const resultsByDaypart = groupBy(results, (result) => result.daypart);
  const resultsBySlotPattern = groupBy(
    results,
    (result) => `${result.slotTime}:${result.daypart}`,
  );
  for (const summary of daypartSummaries) {
    const daypartResults = resultsByDaypart.get(summary.daypart) ?? [];
    if (
      summary.slotCount >= 3 &&
      summary.distinctStepSignatureCount === 1 &&
      hasEligibleUnselectedDiversityAlternative(daypartResults, results)
    ) {
      warnings.push(
        `${summary.daypart} repeated the same step signature across ${summary.slotCount} generated slots.`,
      );
    }
    if (
      summary.slotCount >= 3 &&
      summary.distinctSelectedProductCount <= 2 &&
      hasEligibleUnselectedDiversityAlternative(daypartResults, results)
    ) {
      warnings.push(
        `${summary.daypart} used ${summary.distinctSelectedProductCount} distinct product(s) across ${summary.slotCount} generated slots.`,
      );
    }
  }
  for (const summary of slotPatternSummaries) {
    if (
      summary.daysEvaluated >= 3 &&
      summary.distinctStepSignatureCount === 1 &&
      hasEligibleUnselectedDiversityAlternative(
        resultsBySlotPattern.get(summary.slotKey) ?? [],
        results,
      )
    ) {
      warnings.push(
        `${summary.daypart} slot ${summary.slotTime} repeated the same step signature across ${summary.daysEvaluated} evaluated day(s).`,
      );
    }
  }
  return Array.from(new Set(warnings));
}

function hasEligibleUnselectedDiversityAlternative(
  results: readonly SlotEvaluationResult[],
  allResults: readonly SlotEvaluationResult[],
): boolean {
  const selected = new Set(
    allResults.flatMap((result) => result.stepProductHashes),
  );
  for (const result of results) {
    for (const diagnostic of result.scoreDiagnostics) {
      if (!isEligibleDiversityCandidate(result, diagnostic)) continue;
      if (!selected.has(diagnostic.productHash)) return true;
    }
  }
  return false;
}

function isEligibleDiversityCandidate(
  result: SlotEvaluationResult,
  diagnostic: SlotEvaluationResult['scoreDiagnostics'][number],
): boolean {
  if (diagnostic.suitabilityScore < 60) return false;
  if (
    result.daypart === 'evening' &&
    diagnostic.category === 'sun-protection'
  ) {
    return false;
  }
  return !diagnostic.cautionReasons.some((reason) =>
    /preferred time of day does not match|recent same-daypart repeat|reaction|spacing|blocked|expired|paused|failed/i.test(
      reason,
    ),
  );
}

function readDayCount(): number {
  const raw = process.env.SUGGESTION_EVALUATION_DAY_COUNT?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) {
    throw new Error(
      'SUGGESTION_EVALUATION_DAY_COUNT must be between 1 and 30.',
    );
  }
  return parsed;
}

function addDays(date: string, offset: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid evaluation date: ${date}.`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function dateInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`;
}

function dayOfWeek(date: string, timeZone: string): DayOfWeek {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  })
    .format(new Date(`${date}T12:00:00.000Z`))
    .toLowerCase()
    .slice(0, 3);
  if (!DAYS_OF_WEEK.includes(weekday as DayOfWeek)) {
    throw new Error(`Could not resolve day of week for ${date}.`);
  }
  return weekday as DayOfWeek;
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  const value = parts.find((item) => item.type === type)?.value;
  if (!value) throw new Error(`Missing date part ${type}.`);
  return value;
}

function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function countBy(values: readonly string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function countMap(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function groupBy<T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  return groups;
}

if (require.main === module) {
  void runAccountEvaluation()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'unknown error');
      process.exitCode = 1;
    });
}
