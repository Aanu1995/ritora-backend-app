import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { ApplicationItemStatus } from '../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { type AppLanguage, normalizeLanguage } from '../common/i18n/i18n';
import { resolveEffectiveTimeZone } from '../common/timezone/timezone.utils';
import { toIsoString } from '../common/utils/date';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { formatDateInTimeZone } from '../suggestions/services/suggestion-helpers';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { User } from '../users/entities/user.entity';
import {
  RoutineReviewActionDto,
  RoutineReviewEvidenceDto,
  RoutineReviewResponseDto,
  RoutineReviewSignalDto,
} from './dto/routine-review-response.dto';
import {
  RoutineReviewDecisionValue,
  RoutineReviewRiskLevelValue,
  type RoutineReviewActionCode,
  type RoutineReviewDecision,
  type RoutineReviewReasonCode,
  type RoutineReviewRiskLevel,
  type RoutineReviewSignalCode,
  type RoutineReviewSignalSeverity,
} from './routine-review.types';

const REVIEW_WINDOW_DAYS = 14;
const RECENT_WINDOW_DAYS = 7;
const HIGH_RATING_THRESHOLD = 4;
const ACTIVE_USE_DAY_REDUCE_THRESHOLD = 3;

const ACTIVE_PRODUCT_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.Exfoliant,
  ProductCategory.Treatment,
]);

const ACTIVE_APPLICATION_STATUSES = new Set<ApplicationItemStatus>([
  ApplicationItemStatus.Applied,
  ApplicationItemStatus.Substituted,
]);

const ACTIVE_PRODUCT_TERMS = [
  'retinol',
  'retinal',
  'retinoid',
  'tretinoin',
  'adapalene',
  'glycolic',
  'lactic',
  'mandelic',
  'salicylic',
  'azelaic',
  'benzoyl peroxide',
  'aha',
  'bha',
  'pha',
  'vitamin c',
  'ascorbic',
  'hydroquinone',
];

const PIGMENT_CONCERNS = new Set(['dark_marks', 'uneven_tone']);
const LOW_SPF_HABITS = new Set(['rarely']);

interface RoutineReviewFacts {
  today: string;
  windowStart: string;
  recentStart: string;
  generatedAt: Date;
  timeZone: string;
  language: AppLanguage;
  profile: SkinProfile | null;
  entries: SkinJournalEntry[];
  recentEntries: SkinJournalEntry[];
  applications: ApplicationLog[];
  activeProducts: InventoryProduct[];
  activeSimplification: RoutineSimplificationEvent | null;
  evidence: RoutineReviewEvidenceDto;
}

@Injectable()
export class RoutineReviewService {
  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly entries: Repository<SkinJournalEntry>,
    @InjectRepository(ApplicationLog)
    private readonly applications: Repository<ApplicationLog>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryProducts: Repository<InventoryProduct>,
    @InjectRepository(SkinProfile)
    private readonly skinProfiles: Repository<SkinProfile>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplifications: Repository<RoutineSimplificationEvent>,
  ) {}

  async getCurrentReview(
    user: User,
    requestTimeZone?: string | null,
    now = new Date(),
  ): Promise<RoutineReviewResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const language = normalizeLanguage(user.preferred_language);
    const today = formatDateInTimeZone(timeZone, now);
    const windowStart = addDaysToDateOnly(today, -(REVIEW_WINDOW_DAYS - 1));
    const recentStart = addDaysToDateOnly(today, -(RECENT_WINDOW_DAYS - 1));

    const [
      entries,
      applications,
      activeProducts,
      profile,
      activeSimplification,
    ] = await Promise.all([
      this.entries.find({
        where: {
          user_id: user.id,
          entry_date: Between(windowStart, today),
        },
        order: { entry_date: 'DESC' },
      }),
      this.applications.find({
        where: {
          user_id: user.id,
          target_date: Between(windowStart, today),
        },
        relations: ['items', 'items.product'],
        order: { target_date: 'DESC' },
      }),
      this.inventoryProducts.find({
        where: { user_id: user.id, status: ShelfStatus.Active },
        order: { created_at: 'DESC' },
        take: 80,
      }),
      this.skinProfiles.findOne({ where: { user_id: user.id } }),
      this.simplifications.findOne({
        where: { user_id: user.id, ended_at: IsNull() },
        order: { started_at: 'DESC' },
      }),
    ]);

    const recentEntries = entries.filter(
      (entry) => entry.entry_date >= recentStart,
    );
    const facts: RoutineReviewFacts = {
      today,
      windowStart,
      recentStart,
      generatedAt: now,
      timeZone,
      language,
      profile,
      entries,
      recentEntries,
      applications,
      activeProducts,
      activeSimplification,
      evidence: buildEvidence({
        profile,
        entries,
        recentEntries,
        applications,
        activeProducts,
        activeSimplification,
        now,
      }),
    };

    const decision = chooseDecision(facts);

    return {
      generatedAt: toIsoString(now),
      timeZone,
      window: {
        start: windowStart,
        end: today,
        days: REVIEW_WINDOW_DAYS,
      },
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      reasonCode: decision.reasonCode,
      title: decision.title,
      summary: decision.summary,
      nextReviewAt: decision.nextReviewAt
        ? toIsoString(decision.nextReviewAt)
        : null,
      actions: decision.actions,
      signals: decision.signals,
      evidence: facts.evidence,
    };
  }
}

function buildEvidence(input: {
  profile: SkinProfile | null;
  entries: SkinJournalEntry[];
  recentEntries: SkinJournalEntry[];
  applications: ApplicationLog[];
  activeProducts: InventoryProduct[];
  activeSimplification: RoutineSimplificationEvent | null;
  now: Date;
}): RoutineReviewEvidenceDto {
  const recentProductCutoff = new Date(input.now);
  recentProductCutoff.setUTCDate(recentProductCutoff.getUTCDate() - 13);

  const recentNewProductCount = Math.max(
    input.entries.filter(isRecentProductChange).length,
    input.activeProducts.filter(
      (product) =>
        product.created_at.getTime() >= recentProductCutoff.getTime(),
    ).length,
  );

  return {
    journalEntryCount: input.entries.length,
    applicationLogCount: input.applications.length,
    reactionSignalCount: input.recentEntries.filter(hasReactionSignal).length,
    userReactionReportCount:
      input.recentEntries.filter(hasReactionReport).length,
    userReactionRedFlagCount: input.recentEntries.reduce(
      (count, entry) => count + (entry.reaction_report?.red_flags?.length ?? 0),
      0,
    ),
    barrierSignalCount: input.recentEntries.filter(hasBarrierSignal).length,
    highIrritationEntryCount: input.recentEntries.filter(
      hasHighIrritationRating,
    ).length,
    highBreakoutEntryCount: input.recentEntries.filter(hasHighBreakoutRating)
      .length,
    recentNewProductCount,
    activeUseDayCount: countActiveUseDays(input.applications),
    activeShelfProductCount: input.activeProducts.filter((product) =>
      isActiveProduct(product),
    ).length,
    activeSimplification: Boolean(input.activeSimplification),
    lowSpfWithPigmentGoal: hasLowSpfPigmentGap(input.profile),
  };
}

function chooseDecision(facts: RoutineReviewFacts): {
  decision: RoutineReviewDecision;
  riskLevel: RoutineReviewRiskLevel;
  reasonCode: RoutineReviewReasonCode;
  title: string;
  summary: string;
  nextReviewAt: Date | null;
  actions: RoutineReviewActionDto[];
  signals: RoutineReviewSignalDto[];
} {
  const signals = buildSignals(facts);
  const evidence = facts.evidence;

  if (
    facts.recentEntries.some(hasDoctorFollowUpSignal) ||
    evidence.userReactionRedFlagCount > 0
  ) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.SeekProfessionalHelp,
      riskLevel: RoutineReviewRiskLevelValue.Urgent,
      reasonCode: 'safety_follow_up',
      actionCodes: ['seek_professional_help', 'keep_routine_simple'],
      nextReviewDays: 1,
    });
  }

  if (
    evidence.recentNewProductCount > 0 &&
    (evidence.userReactionReportCount > 0 ||
      evidence.highBreakoutEntryCount > 0 ||
      evidence.highIrritationEntryCount > 0)
  ) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.Pause,
      riskLevel: RoutineReviewRiskLevelValue.High,
      reasonCode: 'new_product_reaction',
      actionCodes: [
        'pause_newest_change',
        'keep_routine_simple',
        'keep_logging',
      ],
      nextReviewDays: 3,
    });
  }

  if (
    evidence.activeSimplification ||
    evidence.reactionSignalCount > 0 ||
    evidence.userReactionReportCount > 0 ||
    evidence.barrierSignalCount > 0 ||
    evidence.highIrritationEntryCount >= 2
  ) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.Recover,
      riskLevel: RoutineReviewRiskLevelValue.High,
      reasonCode: evidence.activeSimplification
        ? 'active_simplification'
        : 'reaction_or_barrier',
      actionCodes: [
        'keep_routine_simple',
        'pause_strong_actives',
        'keep_logging',
      ],
      nextReviewDays: 3,
    });
  }

  if (
    evidence.activeUseDayCount >= ACTIVE_USE_DAY_REDUCE_THRESHOLD &&
    (evidence.highIrritationEntryCount > 0 ||
      evidence.highBreakoutEntryCount > 0)
  ) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.Reduce,
      riskLevel: RoutineReviewRiskLevelValue.Medium,
      reasonCode: 'active_overuse',
      actionCodes: [
        'reduce_active_frequency',
        'wait_before_changing',
        'keep_logging',
      ],
      nextReviewDays: 7,
    });
  }

  if (evidence.lowSpfWithPigmentGoal) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.ReviewSpf,
      riskLevel: RoutineReviewRiskLevelValue.Medium,
      reasonCode: 'spf_gap',
      actionCodes: [
        'review_sunscreen_fit',
        'wait_before_changing',
        'keep_logging',
      ],
      nextReviewDays: 7,
    });
  }

  if (evidence.recentNewProductCount > 0) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.WaitAndTrack,
      riskLevel: RoutineReviewRiskLevelValue.Low,
      reasonCode: 'new_product_tracking',
      actionCodes: ['wait_before_changing', 'keep_logging'],
      nextReviewDays: 7,
    });
  }

  if (evidence.journalEntryCount < 2 && evidence.applicationLogCount < 2) {
    return decisionPayload({
      facts,
      signals,
      decision: RoutineReviewDecisionValue.WaitAndTrack,
      riskLevel: RoutineReviewRiskLevelValue.Low,
      reasonCode: 'not_enough_data',
      actionCodes: ['keep_logging', 'wait_before_changing'],
      nextReviewDays: 7,
    });
  }

  return decisionPayload({
    facts,
    signals,
    decision: RoutineReviewDecisionValue.Continue,
    riskLevel: RoutineReviewRiskLevelValue.Low,
    reasonCode: 'stable_week',
    actionCodes: ['continue_current_routine', 'keep_logging'],
    nextReviewDays: 7,
  });
}

function buildSignals(facts: RoutineReviewFacts): RoutineReviewSignalDto[] {
  const signals: RoutineReviewSignalDto[] = [];
  const evidence = facts.evidence;

  if (facts.recentEntries.some(hasDoctorFollowUpSignal)) {
    signals.push(signal('doctor_follow_up_flag', 'critical', facts.language));
  }
  if (evidence.activeSimplification) {
    signals.push(signal('active_recovery_mode', 'warning', facts.language));
  }
  if (evidence.userReactionRedFlagCount > 0) {
    signals.push(signal('reaction_red_flags', 'critical', facts.language));
  } else if (evidence.userReactionReportCount > 0) {
    signals.push(signal('user_reported_reaction', 'warning', facts.language));
  }
  if (evidence.reactionSignalCount > 0) {
    signals.push(signal('reaction_signal', 'warning', facts.language));
  }
  if (evidence.barrierSignalCount > 0) {
    signals.push(signal('barrier_signal', 'warning', facts.language));
  }
  if (evidence.highIrritationEntryCount > 0) {
    signals.push(signal('high_irritation_checkins', 'watch', facts.language));
  }
  if (evidence.highBreakoutEntryCount > 0) {
    signals.push(signal('high_breakout_checkins', 'watch', facts.language));
  }
  if (evidence.recentNewProductCount > 0) {
    signals.push(
      signal(
        evidence.recentNewProductCount > 1
          ? 'multiple_recent_products'
          : 'recent_new_product',
        evidence.recentNewProductCount > 1 ? 'warning' : 'info',
        facts.language,
      ),
    );
  }
  if (evidence.activeUseDayCount >= ACTIVE_USE_DAY_REDUCE_THRESHOLD) {
    signals.push(signal('active_heavy_week', 'watch', facts.language));
  }
  if (evidence.lowSpfWithPigmentGoal) {
    signals.push(signal('low_spf_with_pigment_goal', 'watch', facts.language));
  }
  if (evidence.journalEntryCount < 2 && evidence.applicationLogCount < 2) {
    signals.push(signal('limited_tracking_data', 'info', facts.language));
  }

  if (signals.length === 0) {
    signals.push(signal('calm_recent_entries', 'info', facts.language));
  }

  return signals;
}

function decisionPayload(input: {
  facts: RoutineReviewFacts;
  signals: RoutineReviewSignalDto[];
  decision: RoutineReviewDecision;
  riskLevel: RoutineReviewRiskLevel;
  reasonCode: RoutineReviewReasonCode;
  actionCodes: RoutineReviewActionCode[];
  nextReviewDays: number;
}) {
  const copy = localize(DECISION_COPY[input.reasonCode], input.facts.language);
  return {
    decision: input.decision,
    riskLevel: input.riskLevel,
    reasonCode: input.reasonCode,
    title: copy.title,
    summary: copy.summary,
    nextReviewAt: addDaysToDate(input.facts.generatedAt, input.nextReviewDays),
    actions: input.actionCodes.map((code) =>
      action(code, input.facts.language),
    ),
    signals: input.signals,
  };
}

function signal(
  code: RoutineReviewSignalCode,
  severity: RoutineReviewSignalSeverity,
  language: AppLanguage,
): RoutineReviewSignalDto {
  const copy = localize(SIGNAL_COPY[code], language);
  return { code, severity, label: copy.label, detail: copy.detail };
}

function action(
  code: RoutineReviewActionCode,
  language: AppLanguage,
): RoutineReviewActionDto {
  return { code, ...localize(ACTION_COPY[code], language) };
}

type Localized<T> = {
  en: T;
  sv: T;
  es?: T;
};

type TitleSummaryCopy = {
  title: string;
  summary: string;
};

type LabelDetailCopy = {
  label: string;
  detail: string;
};

function localize<T>(copy: Localized<T>, language: AppLanguage): T {
  return copy[language] ?? copy.en;
}

const DECISION_COPY: Record<
  RoutineReviewReasonCode,
  Localized<TitleSummaryCopy>
> = {
  safety_follow_up: {
    en: {
      title: 'Seek professional help',
      summary:
        'Recent journal analysis includes safety follow-up signals. Keep your routine simple and consider professional care, especially if symptoms are severe or persistent.',
    },
    sv: {
      title: 'Sök professionell hjälp',
      summary:
        'De senaste journalanteckningarna innehåller säkerhetssignaler. Håll rutinen enkel och överväg professionell vård, särskilt om symtomen är svåra eller ihållande.',
    },
  },
  active_simplification: {
    en: {
      title: 'Recover',
      summary:
        'Your recent signals or symptom report suggest your skin may need a calmer routine. Keep the basics stable and pause strong actives while you track whether irritation settles.',
    },
    sv: {
      title: 'Återhämta',
      summary:
        'Dina senaste signaler eller symtomrapport tyder på att huden kan behöva en lugnare rutin. Behåll grunderna och pausa starka aktiva produkter medan du följer om irritationen lugnar sig.',
    },
  },
  reaction_or_barrier: {
    en: {
      title: 'Recover',
      summary:
        'Your recent signals or symptom report suggest your skin may need a calmer routine. Keep the basics stable and pause strong actives while you track whether irritation settles.',
    },
    sv: {
      title: 'Återhämta',
      summary:
        'Dina senaste signaler eller symtomrapport tyder på att huden kan behöva en lugnare rutin. Behåll grunderna och pausa starka aktiva produkter medan du följer om irritationen lugnar sig.',
    },
  },
  new_product_reaction: {
    en: {
      title: 'Pause',
      summary:
        'A recent product or frequency change overlaps with worse check-ins or symptoms. Pause the newest change first and keep the rest of your routine steady.',
    },
    sv: {
      title: 'Pausa',
      summary:
        'En ny produkt eller ändrad frekvens sammanfaller med sämre incheckningar eller symtom. Pausa den nyaste ändringen först och håll resten av rutinen stabil.',
    },
  },
  active_overuse: {
    en: {
      title: 'Reduce',
      summary:
        'Your week looks active-heavy while your check-ins show discomfort. Reduce active frequency before adding or swapping products.',
    },
    sv: {
      title: 'Minska',
      summary:
        'Veckan verkar ha många aktiva steg samtidigt som dina incheckningar visar obehag. Minska frekvensen innan du lägger till eller byter produkter.',
    },
  },
  spf_gap: {
    en: {
      title: 'Review SPF',
      summary:
        'Your profile points to dark marks or uneven tone, but sunscreen use is not consistent yet. Review SPF comfort before adding stronger brightening steps.',
    },
    sv: {
      title: 'Se över SPF',
      summary:
        'Din profil pekar på mörka märken eller ojämn ton, men solskyddet används inte konsekvent än. Se över SPF-komforten innan du lägger till starkare uppljusande steg.',
    },
  },
  new_product_tracking: {
    en: {
      title: 'Wait and track',
      summary:
        'You have a recent product or routine change, but no strong reaction pattern is visible yet. Give tolerance more time before changing the routine again.',
    },
    sv: {
      title: 'Vänta och följ',
      summary:
        'Du har en ny produkt- eller rutinändring, men inget tydligt reaktionsmönster syns än. Ge toleransen mer tid innan du ändrar rutinen igen.',
    },
  },
  not_enough_data: {
    en: {
      title: 'Wait and track',
      summary:
        'Ritora needs a little more routine history before it can give a confident continue, reduce, or pause decision.',
    },
    sv: {
      title: 'Vänta och följ',
      summary:
        'Ritora behöver lite mer rutinhistorik innan appen kan ge ett säkert beslut om att fortsätta, minska eller pausa.',
    },
  },
  stable_week: {
    en: {
      title: 'Continue',
      summary:
        'Recent records look stable. Keep the routine steady and avoid adding multiple new products at once.',
    },
    sv: {
      title: 'Fortsätt',
      summary:
        'De senaste registreringarna ser stabila ut. Håll rutinen stadig och undvik att lägga till flera nya produkter samtidigt.',
    },
  },
};

const SIGNAL_COPY: Record<
  RoutineReviewSignalCode,
  Localized<LabelDetailCopy>
> = {
  doctor_follow_up_flag: {
    en: {
      label: 'Safety follow-up flag',
      detail:
        'A recent journal entry suggested professional review may be useful.',
    },
    sv: {
      label: 'Säkerhetsflagga',
      detail:
        'En nylig journalanteckning tyder på att professionell granskning kan vara användbar.',
    },
  },
  active_recovery_mode: {
    en: {
      label: 'Recovery mode is active',
      detail: 'Ritora already has your routine in a calmer safety state.',
    },
    sv: {
      label: 'Återhämtningsläge är aktivt',
      detail: 'Ritora har redan satt rutinen i ett lugnare säkerhetsläge.',
    },
  },
  user_reported_reaction: {
    en: {
      label: 'Symptoms you reported',
      detail:
        'Your check-in says your skin is reacting, even if a photo does not show it clearly.',
    },
    sv: {
      label: 'Symtom du rapporterade',
      detail:
        'Din incheckning säger att huden reagerar, även om ett foto inte visar det tydligt.',
    },
  },
  reaction_red_flags: {
    en: {
      label: 'Reaction red flags',
      detail:
        'Your symptom report includes signs that may need professional review.',
    },
    sv: {
      label: 'Varningssignaler vid reaktion',
      detail:
        'Din symtomrapport innehåller tecken som kan behöva professionell granskning.',
    },
  },
  reaction_signal: {
    en: {
      label: 'Reaction signal',
      detail: 'Recent photos or analysis detected possible irritation.',
    },
    sv: {
      label: 'Reaktionssignal',
      detail: 'Nya foton eller analyser upptäckte möjlig irritation.',
    },
  },
  barrier_signal: {
    en: {
      label: 'Barrier signal',
      detail: 'Recent entries include signs that can match barrier stress.',
    },
    sv: {
      label: 'Barriärsignal',
      detail:
        'Nya anteckningar innehåller tecken som kan matcha barriärstress.',
    },
  },
  high_irritation_checkins: {
    en: {
      label: 'Irritation check-ins',
      detail:
        'Recent check-ins rated irritation, redness, dryness, or sensitivity high.',
    },
    sv: {
      label: 'Irritation i incheckningar',
      detail:
        'Nya incheckningar skattade irritation, rodnad, torrhet eller känslighet högt.',
    },
  },
  high_breakout_checkins: {
    en: {
      label: 'Breakout check-ins',
      detail: 'Recent check-ins rated breakouts high.',
    },
    sv: {
      label: 'Utslag i incheckningar',
      detail: 'Nya incheckningar skattade finnar eller utslag högt.',
    },
  },
  recent_new_product: {
    en: {
      label: 'Recent routine change',
      detail:
        'A product or frequency change happened inside the review window.',
    },
    sv: {
      label: 'Ny rutinändring',
      detail:
        'En produkt- eller frekvensändring skedde inom granskningsperioden.',
    },
  },
  multiple_recent_products: {
    en: {
      label: 'Multiple recent changes',
      detail:
        'Several new products or changes make cause and effect harder to read.',
    },
    sv: {
      label: 'Flera nya ändringar',
      detail:
        'Flera nya produkter eller ändringar gör orsak och effekt svårare att läsa.',
    },
  },
  active_heavy_week: {
    en: {
      label: 'Active-heavy week',
      detail:
        'Several logged routine days included treatment or exfoliating steps.',
    },
    sv: {
      label: 'Aktiv-tung vecka',
      detail:
        'Flera loggade rutindagar innehöll behandlingar eller exfolierande steg.',
    },
  },
  low_spf_with_pigment_goal: {
    en: {
      label: 'SPF gap',
      detail: 'Dark marks or uneven tone need consistent sunscreen support.',
    },
    sv: {
      label: 'SPF-lucka',
      detail: 'Mörka märken eller ojämn ton behöver konsekvent solskyddsstöd.',
    },
  },
  limited_tracking_data: {
    en: {
      label: 'More tracking needed',
      detail: 'There are not enough recent logs to make a stronger decision.',
    },
    sv: {
      label: 'Mer uppföljning behövs',
      detail:
        'Det finns inte tillräckligt många nya loggar för ett starkare beslut.',
    },
  },
  calm_recent_entries: {
    en: {
      label: 'Stable recent records',
      detail: 'No strong reaction, barrier, or change signal stood out.',
    },
    sv: {
      label: 'Stabila senaste registreringar',
      detail: 'Ingen stark reaktions-, barriär- eller ändringssignal stack ut.',
    },
  },
};

const ACTION_COPY: Record<
  RoutineReviewActionCode,
  Localized<LabelDetailCopy>
> = {
  seek_professional_help: {
    en: {
      label: 'Consider professional help',
      detail:
        'If symptoms are severe, painful, spreading, swollen, or persistent, contact a qualified professional.',
    },
    sv: {
      label: 'Överväg professionell hjälp',
      detail:
        'Om symtomen är svåra, smärtsamma, sprider sig, svullnar eller håller i sig, kontakta kvalificerad vårdpersonal.',
    },
  },
  keep_routine_simple: {
    en: {
      label: 'Keep the routine simple',
      detail:
        'Use only the basics your skin already tolerates while you monitor changes.',
    },
    sv: {
      label: 'Håll rutinen enkel',
      detail:
        'Använd bara de grundsteg huden redan tolererar medan du följer förändringarna.',
    },
  },
  pause_strong_actives: {
    en: {
      label: 'Pause strong actives',
      detail:
        'Hold exfoliants, retinoids, strong acne treatments, and harsh masks for now.',
    },
    sv: {
      label: 'Pausa starka aktiva produkter',
      detail:
        'Avvakta med exfolieringar, retinoider, starka aknebehandlingar och kraftiga masker tills vidare.',
    },
  },
  pause_newest_change: {
    en: {
      label: 'Pause the newest change first',
      detail:
        'Do not change everything at once. Remove the most recent change and track.',
    },
    sv: {
      label: 'Pausa den nyaste ändringen först',
      detail:
        'Ändra inte allt samtidigt. Ta bort den senaste ändringen och följ utvecklingen.',
    },
  },
  reduce_active_frequency: {
    en: {
      label: 'Reduce active frequency',
      detail:
        'Use fewer treatment or exfoliating nights before adding anything new.',
    },
    sv: {
      label: 'Minska aktiv frekvens',
      detail:
        'Använd färre behandlings- eller exfolieringskvällar innan du lägger till något nytt.',
    },
  },
  review_sunscreen_fit: {
    en: {
      label: 'Review sunscreen comfort',
      detail:
        'Look for pilling, stinging, breakouts, white cast, or greasiness blocking use.',
    },
    sv: {
      label: 'Se över solskyddets komfort',
      detail:
        'Titta efter smulning, sveda, finnar, vit hinna eller fet känsla som hindrar användning.',
    },
  },
  wait_before_changing: {
    en: {
      label: 'Wait before changing again',
      detail:
        'Avoid adding another active until this review window becomes clearer.',
    },
    sv: {
      label: 'Vänta innan du ändrar igen',
      detail:
        'Undvik att lägga till en ny aktiv produkt tills granskningsperioden blir tydligare.',
    },
  },
  keep_logging: {
    en: {
      label: 'Keep logging',
      detail:
        'Record product use and a short skin check-in so Ritora can compare patterns.',
    },
    sv: {
      label: 'Fortsätt logga',
      detail:
        'Registrera produktanvändning och en kort hudincheckning så att Ritora kan jämföra mönster.',
    },
  },
  continue_current_routine: {
    en: {
      label: 'Continue current routine',
      detail:
        'Keep your routine stable and watch for any new irritation or breakouts.',
    },
    sv: {
      label: 'Fortsätt med nuvarande rutin',
      detail:
        'Håll rutinen stabil och håll utkik efter ny irritation eller nya finnar.',
    },
  },
};

function hasReactionSignal(entry: SkinJournalEntry): boolean {
  return Boolean(
    entry.has_reaction_signal ||
    entry.analysis_observations?.reaction_signals?.reaction_detected,
  );
}

function hasReactionReport(entry: SkinJournalEntry): boolean {
  return Boolean(entry.reaction_report?.symptoms?.length);
}

function hasBarrierSignal(entry: SkinJournalEntry): boolean {
  return Boolean(
    entry.analysis_observations?.barrier_signs?.barrier_compromise,
  );
}

function hasDoctorFollowUpSignal(entry: SkinJournalEntry): boolean {
  const obs = entry.analysis_observations;
  return Boolean(
    obs?.should_flag_for_doctor ||
    obs?.safety_flags?.urgent_review_recommended ||
    obs?.safety_flags?.doctor_follow_up_recommended,
  );
}

function hasHighIrritationRating(entry: SkinJournalEntry): boolean {
  const ratings = entry.ratings;
  if (!ratings) return false;
  return [
    ratings.dryness,
    ratings.redness,
    ratings.irritation,
    ratings.sensitivity,
  ].some((value) => (value ?? 0) >= HIGH_RATING_THRESHOLD);
}

function hasHighBreakoutRating(entry: SkinJournalEntry): boolean {
  return (entry.ratings?.breakouts ?? 0) >= HIGH_RATING_THRESHOLD;
}

function isRecentProductChange(entry: SkinJournalEntry): boolean {
  return ['started_new_product', 'changed_frequency'].includes(
    entry.recent_change?.kind ?? '',
  );
}

function countActiveUseDays(applications: ApplicationLog[]): number {
  const days = new Set<string>();
  for (const log of applications) {
    const hasActiveApplied = (log.items ?? []).some((item) => {
      if (!ACTIVE_APPLICATION_STATUSES.has(item.status)) {
        return false;
      }
      return isActiveProduct(item.product, item.step_label);
    });

    if (hasActiveApplied) {
      days.add(log.target_date);
    }
  }
  return days.size;
}

function isActiveProduct(
  product: InventoryProduct | null | undefined,
  fallbackLabel?: string | null,
): boolean {
  const category = product?.category ?? product?.identity?.category ?? null;
  if (category && ACTIVE_PRODUCT_CATEGORIES.has(category)) {
    return true;
  }

  const text = [
    fallbackLabel,
    product?.name,
    product?.brand,
    product?.identity?.name,
    product?.identity?.description,
    ...(product?.identity?.benefits ?? []),
    ...(product?.identity?.inciIngredients ?? []),
    ...(product?.guidance?.cautions ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return ACTIVE_PRODUCT_TERMS.some((term) => text.includes(term));
}

function hasLowSpfPigmentGap(profile: SkinProfile | null): boolean {
  if (!profile) return false;
  const concerns = new Set([
    profile.primary_goal,
    ...(profile.current_concerns ?? []),
  ]);
  const hasPigmentGoal = Array.from(concerns).some(
    (concern) => typeof concern === 'string' && PIGMENT_CONCERNS.has(concern),
  );
  return (
    hasPigmentGoal &&
    LOW_SPF_HABITS.has(profile.skin_behavior?.sunscreen_habit ?? '')
  );
}

function addDaysToDateOnly(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addDaysToDate(date: Date, days: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}
