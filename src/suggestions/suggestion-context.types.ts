import type { ProductCategory } from '../shelf/shelf.types';
import {
  SuggestionEvidenceSourceId,
  SuggestionEvidenceSourceJson,
} from './suggestions.constants';

export interface SuggestionContextSummary {
  cacheKey: string;
  builtAt: string;
  targetDate: string;
  targetTime: string;
  daypart: 'morning' | 'noon' | 'evening';
  skinProfile: {
    primaryGoal: string | null;
    skinType: string | null;
    sensitivityLevel: string | null;
    activeConcerns: string[];
    pregnancyStatus: string | null;
  };
  reaction: {
    hasSignal: boolean;
    severity: string | null;
    confidence: number | null;
    indicators: string[];
    affectedZones: string[];
    concernKeys: string[];
    daysSinceLatestSignal: number | null;
    barrierCompromised: boolean;
  };
  routineBreak: {
    recentlyResumed: boolean;
    lastPausedFrom: string | null;
    lastPausedUntil: string | null;
  };
  productScores: SuggestionProductScore[];
  applicationPatterns: {
    days: number;
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

export interface SuggestionProductScore {
  productId: string;
  brand: string;
  name: string;
  category: ProductCategory;
  preferredTimeOfDay: 'morning' | 'evening' | 'either' | null;
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
