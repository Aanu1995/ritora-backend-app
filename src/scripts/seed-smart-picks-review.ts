import 'dotenv/config';
import { hash } from 'bcrypt';
import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { ulid } from 'ulid';
import { AppModule } from '../app.module';
import {
  ApplicationDaypart,
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../application-tracking/application-tracking.constants';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { CatalogueSource, DataProvenance } from '../shelf/shelf.types';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { AnalysisStatusValue } from '../skin-journal/skin-journal.constants';
import type {
  AnalysisConcern,
  AnalysisObservations,
} from '../skin-journal/skin-journal.constants';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SmartPickGenerationJob } from '../smart-picks/entities/smart-pick-generation-job.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SMART_PICKS_GOLDEN_PERSONAS } from '../smart-picks/evaluation/smart-picks-golden-personas';
import type {
  GoldenSmartPicksPersona,
  GoldenSmartPicksProduct,
} from '../smart-picks/evaluation/smart-picks-golden-personas';
import { SmartPicksContextBuilder } from '../smart-picks/services/smart-picks-context-builder';
import { SmartPicksOverviewService } from '../smart-picks/services/smart-picks-overview.service';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';
import { User } from '../users/entities/user.entity';

interface SeedCliOptions {
  personaIds: string[];
  generate: boolean;
}

const SEED_EMAIL_DOMAIN = 'smart-picks-review.ritora.local';
const DEFAULT_REVIEW_PASSWORD = 'RitoraReview1!';
const REFERENCE_DATE = '2026-05-10';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const personas = options.personaIds.length
    ? SMART_PICKS_GOLDEN_PERSONAS.filter((persona) =>
        options.personaIds.includes(persona.id),
      )
    : SMART_PICKS_GOLDEN_PERSONAS;
  if (personas.length === 0) {
    throw new Error('No Smart Picks review personas matched the filter.');
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const dataSource = app.get(DataSource);
    const contextBuilder = app.get(SmartPicksContextBuilder);
    const overviewService = app.get(SmartPicksOverviewService);
    const password =
      process.env.SMART_PICKS_REVIEW_SEED_PASSWORD ?? DEFAULT_REVIEW_PASSWORD;
    const passwordMessage = process.env.SMART_PICKS_REVIEW_SEED_PASSWORD
      ? 'Password for seeded review users: value from SMART_PICKS_REVIEW_SEED_PASSWORD (not printed)'
      : `Password for seeded review users: ${DEFAULT_REVIEW_PASSWORD}`;
    const passwordHash = await hash(password, 10);
    const seededUsers: User[] = [];

    for (const persona of personas) {
      const user = await seedPersona(dataSource, persona, passwordHash);
      seededUsers.push(user);
      if (options.generate) {
        const context = await contextBuilder.build(user, persona.mode);
        await overviewService.generateProductPicksForJob(
          user,
          persona.mode,
          context.inputsHash,
        );
      }
    }

    console.log(
      [
        `Smart Picks review seed complete for ${seededUsers.length} personas.`,
        passwordMessage,
        `Generate products now: ${options.generate ? 'yes' : 'no'}`,
        'Seeded review emails:',
        ...seededUsers.map((user) => `- ${user.email}`),
      ].join('\n'),
    );
  } finally {
    await app.close();
  }
}

async function seedPersona(
  dataSource: DataSource,
  persona: GoldenSmartPicksPersona,
  passwordHash: string,
): Promise<User> {
  const userRepo = dataSource.getRepository(User);
  const email = reviewEmail(persona);
  let user = await userRepo.findOne({ where: { canonical_email: email } });
  if (!user) {
    user = userRepo.create({
      id: ulid(),
      email,
      canonical_email: email,
      password_hash: passwordHash,
      first_name: 'Smart Picks',
      last_name: reviewName(persona),
      email_verified: true,
      email_verification_token_hash: null,
      email_verification_expires: null,
      password_reset_token_hash: null,
      password_reset_expires: null,
      preferred_language: 'en',
      time_zone: 'Europe/Stockholm',
      date_of_birth: '1992-04-12',
      sex_at_birth: 'female',
      google_subject: null,
      apple_subject: null,
    });
  } else {
    user.password_hash = passwordHash;
    user.first_name = 'Smart Picks';
    user.last_name = reviewName(persona);
    user.email_verified = true;
    user.preferred_language = 'en';
    user.time_zone = 'Europe/Stockholm';
    user.date_of_birth = '1992-04-12';
    user.sex_at_birth = 'female';
  }
  user = await userRepo.save(user);

  await clearPersonaData(dataSource, user.id);
  await dataSource.getRepository(SkinProfile).save(profileRow(user, persona));
  await dataSource
    .getRepository(InventoryProduct)
    .save(productsForPersona(user.id, persona));
  await seedHistory(dataSource, user.id, persona);
  return user;
}

async function clearPersonaData(
  dataSource: DataSource,
  userId: string,
): Promise<void> {
  const logRepo = dataSource.getRepository(ApplicationLog);
  const logs = await logRepo.find({
    where: { user_id: userId },
    select: ['id'],
  });
  const logIds = logs.map((log) => log.id);
  if (logIds.length > 0) {
    await dataSource
      .getRepository(ApplicationLogItem)
      .delete({ application_log_id: In(logIds) });
  }
  await logRepo.delete({ user_id: userId });
  await dataSource.getRepository(SkinJournalEntry).delete({ user_id: userId });
  await dataSource
    .getRepository(SuggestionGapAction)
    .delete({ user_id: userId });
  await dataSource
    .getRepository(SmartPickProductSuggestion)
    .delete({ user_id: userId });
  await dataSource.getRepository(SmartPickSnapshot).delete({ user_id: userId });
  await dataSource
    .getRepository(SmartPickGenerationJob)
    .delete({ user_id: userId });
  await dataSource.getRepository(InventoryProduct).delete({ user_id: userId });
  await dataSource.getRepository(SkinProfile).delete({ user_id: userId });
}

function profileRow(user: User, persona: GoldenSmartPicksPersona): SkinProfile {
  return {
    id: ulid(),
    user_id: user.id,
    skin_type: persona.skinType,
    skin_tone: persona.skinTone,
    ethnicity: persona.ethnicity,
    current_concerns: [...persona.currentConcerns],
    country_code: persona.countryCode,
    city: persona.city,
    fitzpatrick_phototype: persona.skinTone.includes('deep')
      ? 'type_v'
      : 'type_iii',
    sensitivity_level: 'moderate',
    hydration_level: 'balanced',
    primary_goal: persona.primaryGoal,
    pregnancy_status: persona.pregnancyStatus,
    under_dermatologist_care: null,
    allow_smart_picks: true,
    budget_tier: persona.budgetTier,
    safety_context: { conditions: [], medications: [] },
    reaction_history: {
      entries: persona.reactionTriggers.map((trigger) => ({ trigger })),
    },
    concern_details: {
      per_concern: persona.currentConcerns.map((concern, index) => ({
        concern,
        severity: index === 0 ? 'moderate' : 'mild',
        priority: index + 1,
      })),
    },
    skin_behavior: {
      pih_tendency: 'yes',
      melasma_tendency: 'not_sure',
      keloid_tendency: 'not_sure',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'some_white_cast',
    },
    active_tolerances: persona.activeTolerances,
    routine_preferences: {
      pace: 'steady',
      am_minutes: 5,
      pm_minutes: 8,
      max_active_nights_per_week: 2,
      fragrance_free: persona.ingredientDislikes.includes('fragrance'),
      non_comedogenic: true,
      sunscreen_filter: 'no_preference',
      sunscreen_finish: 'no_white_cast',
    },
    lifestyle_context: {
      water_hardness: 'unknown',
      water_sensitivity: 'not_sure',
      climate_sensitivities: [],
    },
    shopping_preferences: {
      ingredient_dislikes: [...persona.ingredientDislikes],
      product_dislikes: [],
      brand_dislikes: [],
    },
    hormonal_context: {},
  } as unknown as SkinProfile;
}

function productsForPersona(
  userId: string,
  persona: GoldenSmartPicksPersona,
): InventoryProduct[] {
  const products =
    persona.allProducts.length > 0
      ? persona.allProducts
      : persona.activeProducts;
  return products.map((product) => productRow(userId, product));
}

function productRow(
  userId: string,
  product: GoldenSmartPicksProduct,
): InventoryProduct {
  const search = `${product.brand} ${product.name}`.toLowerCase();
  return {
    id: product.id,
    user_id: userId,
    brand: product.brand,
    name: product.name,
    category: product.category,
    barcode: null,
    status: product.status,
    provenance: DataProvenance.PhotoLookup,
    brand_search: product.brand.toLowerCase(),
    name_search: product.name.toLowerCase(),
    search_document: search,
    opened_at: new Date('2026-02-01T00:00:00.000Z'),
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
      benefits: [...product.benefits],
      suitedFor: [],
      inciIngredients: [...product.ingredients],
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
      brand: product.brand,
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    user_fields: {
      openedAt: '2026-02-01',
      expiresAt: null,
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: null,
    },
  } as unknown as InventoryProduct;
}

async function seedHistory(
  dataSource: DataSource,
  userId: string,
  persona: GoldenSmartPicksPersona,
): Promise<void> {
  for (const summary of persona.productPerformance) {
    await seedApplicationLogs(
      dataSource,
      userId,
      summary.productId,
      Math.min(summary.usageDaysLast90, 90),
    );
  }
  if (
    persona.productPerformance.some((summary) => summary.photoCheckpoints > 0)
  ) {
    await seedJournalTrend(dataSource, userId, persona);
  }
}

async function seedApplicationLogs(
  dataSource: DataSource,
  userId: string,
  productId: string,
  usageDays: number,
): Promise<void> {
  const logRepo = dataSource.getRepository(ApplicationLog);
  const itemRepo = dataSource.getRepository(ApplicationLogItem);
  for (let offset = usageDays - 1; offset >= 0; offset -= 1) {
    const targetDate = shiftDate(REFERENCE_DATE, -offset);
    const log = await logRepo.save(
      logRepo.create({
        id: ulid(),
        user_id: userId,
        suggestion_instance_id: null,
        slot_id: null,
        target_date: targetDate,
        target_time: '20:30:00',
        daypart: ApplicationDaypart.Evening,
        applied_at: new Date(`${targetDate}T20:30:00.000Z`),
        general_notes: null,
        edit_reason: null,
        edit_count: 0,
        has_been_edited: false,
        first_recorded_at: new Date(`${targetDate}T20:35:00.000Z`),
        last_edited_at: null,
      }),
    );
    await itemRepo.save(
      itemRepo.create({
        id: ulid(),
        application_log_id: log.id,
        step_order: 1,
        suggestion_step_id: null,
        inventory_product_id: productId,
        substituted_with_product_id: null,
        product_brand_snapshot: null,
        product_name_snapshot: null,
        step_label: 'Treatment',
        status: ApplicationItemStatus.Applied,
        is_ad_hoc: false,
        item_source: ApplicationItemSource.AddedShelf,
        ad_hoc_brand: null,
        ad_hoc_name: null,
        notes: null,
        substitution_reason: null,
        recommended_snapshot: null,
        applied_snapshot: {
          product_id: productId,
          brand: null,
          name: null,
          step_label: 'Treatment',
          provenance: CatalogueSource.UserPhotos,
        },
        applied_at: new Date(`${targetDate}T20:30:00.000Z`),
      }),
    );
  }
}

async function seedJournalTrend(
  dataSource: DataSource,
  userId: string,
  persona: GoldenSmartPicksPersona,
): Promise<void> {
  const repo = dataSource.getRepository(SkinJournalEntry);
  const concern = concernForGoal(persona.primaryGoal);
  const dates = ['2026-02-15', '2026-03-15', '2026-04-15', REFERENCE_DATE];
  for (const [index, entryDate] of dates.entries()) {
    await repo.save(
      repo.create({
        id: ulid(),
        user_id: userId,
        entry_date: entryDate,
        time_zone: 'Europe/Stockholm',
        photo_object_key: `seed/smart-picks/${userId}/${entryDate}.jpg`,
        photo_width: 1200,
        photo_height: 1600,
        photo_size: 120000,
        photo_content_type: 'image/jpeg',
        exif_stripped: true,
        angle: 'head_on',
        concern_focus: [...persona.currentConcerns],
        is_pre_routine: true,
        ratings: null,
        overall_feel: 'ok',
        sleep_band: '7to9h',
        stress_today: 'mid',
        sun_exposure_today: 'brief',
        sweat_exercise_today: false,
        cycle_marker: 'dont_track',
        recent_change: null,
        complaint_note: null,
        analysis_status: AnalysisStatusValue.Completed,
        analysis_observations: analysisObservation(concern, index),
        analysis_interpretation: null,
        analysis_concern_keys: [concern],
        has_reaction_signal: false,
        needs_retake: false,
        analysis_summary:
          'Seeded review trend for Smart Picks replacement checks.',
        analysis_model: 'seeded-review',
        analysis_version: '1.0',
        analysis_prompt_version: 'seeded-review',
        analysis_error: null,
        analysis_started_at: new Date(`${entryDate}T08:00:00.000Z`),
        analysis_completed_at: new Date(`${entryDate}T08:00:10.000Z`),
        analysis_duration_ms: 10000,
        analysis_input_image_count: 1,
        analysis_input_tokens: null,
        analysis_output_tokens: null,
        analysis_total_tokens: null,
        analysis_estimated_cost_usd: null,
        analysis_retry_count: 0,
      }),
    );
  }
}

function analysisObservation(
  concern: AnalysisConcern,
  index: number,
): AnalysisObservations {
  return {
    schema_version: '1.1',
    model_version: 'seeded-review',
    image_quality: {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      issues: [],
      quality_score: 0.88,
      needs_retake: false,
      excluded_from_trends_reason: null,
    },
    detected_concerns: [
      {
        concern,
        severity: index >= 2 ? 'severe' : 'moderate',
        locations: ['cheeks'],
        confidence: 0.86,
        change_from_previous: index === 3 ? 'worsened' : 'stable',
        change_confidence: 0.74,
      },
    ],
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0.9,
    },
    barrier_signs: {
      barrier_compromise: false,
      indicators: [],
    },
    overall_assessment: 'Seeded trend shows limited progress.',
    overall_change_from_previous: index === 3 ? 'worsened' : 'stable',
    should_flag_for_doctor: false,
  };
}

function concernForGoal(goal: string): AnalysisConcern {
  const normalized = goal.toLowerCase();
  if (normalized.includes('mark') || normalized.includes('tone')) {
    return 'hyperpigmentation';
  }
  if (normalized.includes('line')) return 'fine_lines';
  if (normalized.includes('dry')) return 'dryness';
  if (normalized.includes('congestion')) return 'acne';
  return 'texture';
}

function shiftDate(isoDate: string, offsetDays: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function reviewEmail(persona: GoldenSmartPicksPersona): string {
  return `${persona.id}@${SEED_EMAIL_DOMAIN}`.toLowerCase();
}

function reviewName(persona: GoldenSmartPicksPersona): string {
  return persona.id
    .split('_')
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseArgs(args: readonly string[]): SeedCliOptions {
  return {
    personaIds: readRepeatedFlag(args, '--persona'),
    generate: args.includes('--generate'),
  };
}

function readRepeatedFlag(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value && !value.startsWith('--')) values.push(value);
  }
  return values;
}

void main().catch((error) => {
  console.error(
    `Smart Picks review seed failed: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  );
  process.exitCode = 1;
});
