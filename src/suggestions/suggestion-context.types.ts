import type { PreferredTimeOfDay, ProductCategory } from '../shelf/shelf.types';
import type { EnvironmentContextSummary } from '../environment-intelligence/environment-intelligence.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionEvidenceSourceJson,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
} from './suggestions.constants';

export interface SuggestionContextSummary {
  cacheKey: string;
  builtAt: string;
  targetDate: string;
  targetTime: string;
  daypart: SuggestionDaypart;
  requestSource: SuggestionRequestSource;
  onDemand: SuggestionRequestContextJson | null;
  skinProfile: {
    primaryGoal: string | null;
    skinType: string | null;
    sensitivityLevel: string | null;
    activeConcerns: string[];
    pregnancyStatus: string | null;
  };
  goalSignals?: SuggestionGoalSignals;
  profileSignals?: SuggestionProfileSignals;
  reaction: {
    hasSignal: boolean;
    severity: string | null;
    confidence: number | null;
    indicators: string[];
    affectedZones: string[];
    concernKeys: string[];
    daysSinceLatestSignal: number | null;
    barrierCompromised: boolean;
    photoInputImages: number;
    multiAnglePhotoEntries: number;
  };
  journalSignals?: SuggestionJournalSignals;
  routineBreak: {
    recentlyResumed: boolean;
    lastPausedFrom: string | null;
    lastPausedUntil: string | null;
  };
  environment: EnvironmentContextSummary | null;
  environmentSignals?: SuggestionEnvironmentSignals;
  appliedProductHistory?: SuggestionAppliedProductHistory;
  routineMemory?: SuggestionRoutineMemory;
  productScores: SuggestionProductScore[];
  applicationPatterns: {
    days: number;
    daysSinceLastApplication: number | null;
    conservativeRestart: boolean;
    skippedByCategory: Record<string, number>;
    substitutedByCategory: Record<string, number>;
    addedOffShelfCount: number;
    editedLogCount: number;
    adherenceByCategory: Record<string, number>;
  };
  safetyConstraints: string[];
  governance: {
    safetyPolicyVersion: string;
    safetyPolicyReviewedAt: string;
    aiPersonalizationAllowed: boolean;
    aiPersonalizationBlockedReason: string | null;
  };
  evidenceSources: SuggestionEvidenceSourceJson[];
  skippedCandidates: {
    productId: string;
    reason: string;
    sourceIds: SuggestionEvidenceSourceId[];
  }[];
}

export interface SuggestionGoalSignals {
  mainGoal: string | null;
  primaryGoal: string | null;
  selectedGoals: string[];
  secondaryGoals: SuggestionGoalSignal[];
  activeConcernCount: number;
}

export interface SuggestionGoalSignal {
  concern: string;
  priority: number | null;
  severity: string | null;
  durationMonths: number | null;
  locations: string[];
  subtype: string | null;
  triggers: string[];
  isPrimary: boolean;
}

export interface SuggestionProfileSignals {
  safety: {
    pregnancyStatus: string | null;
    underDermatologistCare: string | null;
    conditions: string[];
    medications: string[];
    photosensitizingOther: boolean;
    recentProcedures: {
      type: string;
      performedAt: string | null;
    }[];
  };
  routinePreferences: {
    pace: string | null;
    amMinutes: number | null;
    pmMinutes: number | null;
    maxActiveNightsPerWeek: number | null;
    fragranceFree: boolean | null;
    nonComedogenic: boolean | null;
    sunscreenFilter: string | null;
    sunscreenFinish: string | null;
  };
  skinBehavior: {
    burnTendency: string | null;
    tanTendency: string | null;
    pihTendency: string | null;
    melasmaTendency: string | null;
    sunscreenHabit: string | null;
    sunscreenTolerance: string | null;
  };
  shoppingPreferences: {
    ingredientDislikes: string[];
    productDislikes: string[];
    brandDislikes: string[];
    texturePreferences: string[];
  };
  activeTolerances: {
    ingredient: string;
    tolerance: string | null;
    lastUsed: string | null;
  }[];
}

export interface SuggestionJournalSignals {
  recordsConsidered: number;
  latestEntryDate: string | null;
  checkIns: {
    stressCounts: Record<string, number>;
    sleepCounts: Record<string, number>;
    overallFeelCounts: Record<string, number>;
    sunExposureCounts: Record<string, number>;
    sweatExerciseDays: number;
    cycleMarkers: string[];
    recentChangeKinds: string[];
    complaintNotes: string[];
  };
  detectedConcerns: {
    concern: string;
    count: number;
    severities: string[];
    locations: string[];
  }[];
  photoCoverage: {
    photoEntries: number;
    photoInputImages: number;
    multiAnglePhotoEntries: number;
    needsRetakeCount: number;
  };
  trendSignals: string[];
}

export interface SuggestionEnvironmentSignals {
  signalKinds: string[];
  alerts: {
    kind: string;
    title: string;
    message: string;
  }[];
  safetyConstraints: string[];
  gapCategories: string[];
}

export interface SuggestionAppliedProductHistory {
  windowStartDate: string;
  windowEndDate: string;
  recordsConsidered: number;
  products: SuggestionAppliedProductHistoryItem[];
}

export interface SuggestionAppliedProductHistoryItem {
  productId: string | null;
  brand: string | null;
  name: string | null;
  category: string | null;
  stepLabel: string | null;
  sourceTypes: string[];
  dayparts: string[];
  statuses: string[];
  useCount: number;
  lastAppliedDate: string | null;
  lastAppliedAt: string | null;
  isOffShelf: boolean;
  isSubstitution: boolean;
}

export interface SuggestionRoutineMemory {
  recordsConsidered: number;
  previousSuggestionCount: number;
  sameDaypartSuggestionCount: number;
  recentSameDaypartFingerprints: {
    targetDate: string;
    targetTime: string;
    productIds: string[];
    productNames: string[];
    fingerprint: string;
  }[];
  recentlySuggestedProductIds: string[];
  exactRepeatCountByFingerprint: Record<string, number>;
  skippedProducts: Record<string, number>;
  substitutedProducts: Record<string, number>;
  adheredProducts: Record<string, number>;
  editedLogCount: number;
  offShelfUseCount: number;
}

export interface SuggestionProductScore {
  productId: string;
  brand: string;
  name: string;
  category: ProductCategory;
  preferredTimeOfDay: PreferredTimeOfDay | null;
  activeTags: string[];
  suitabilityScore: number;
  suitabilityReasons: string[];
  cautionReasons: string[];
  waitMinutes: number | null;
  inciQuality: 'available' | 'missing';
  dataQuality: 'verified' | 'partial' | 'insufficient';
  dataQualityWarnings: string[];
  evidenceSourceIds: SuggestionEvidenceSourceId[];
}
