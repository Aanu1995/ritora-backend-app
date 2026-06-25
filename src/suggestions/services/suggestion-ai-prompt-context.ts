import type { SuggestionContextSummary } from '../suggestion-context.types';
import type { SuggestionGenerationInputs } from './suggestion-ai-generator';

const SUGGESTION_PROMPT_STRING_MAX_CHARS = 240;
const SUGGESTION_PROMPT_ARRAY_MAX_ITEMS = 40;

export function formatPromptJson(value: unknown): string {
  return JSON.stringify(compactPromptValue(value), null, 2);
}

export function formatSkinProfileForPrompt(
  skin: SuggestionGenerationInputs['skinProfile'],
): string {
  if (!skin) return 'not set';
  return formatPromptJson({
    type: skin.skin_type ?? null,
    tone: skin.skin_tone ?? null,
    ethnicity: skin.ethnicity ?? null,
    countryCode: skin.country_code ?? null,
    city: skin.city ?? null,
    fitzpatrickPhototype: skin.fitzpatrick_phototype ?? null,
    sensitivity: skin.sensitivity_level ?? null,
    hydration: skin.hydration_level ?? null,
    primaryGoal: skin.primary_goal ?? null,
    currentConcerns: skin.current_concerns ?? [],
    pregnancyStatus: skin.pregnancy_status ?? null,
    underDermatologistCare: skin.under_dermatologist_care ?? null,
    allowSmartPicks: skin.allow_smart_picks ?? null,
    budgetTier: skin.budget_tier ?? null,
    safetyContext: skin.safety_context ?? {},
    reactionHistory: skin.reaction_history ?? {},
    concernDetails: skin.concern_details ?? {},
    skinBehavior: skin.skin_behavior ?? {},
    activeTolerances: skin.active_tolerances ?? {},
    routinePreferences: skin.routine_preferences ?? {},
    lifestyleContext: skin.lifestyle_context ?? {},
    shoppingPreferences: skin.shopping_preferences ?? {},
    hormonalContext: skin.hormonal_context ?? {},
  });
}

export function formatGoalSignalsForPrompt(
  signals: SuggestionContextSummary['goalSignals'],
): unknown {
  if (!signals) return null;
  return {
    mainGoal: signals.mainGoal,
    primaryGoal: signals.primaryGoal,
    selectedGoals: signals.selectedGoals,
    activeConcernCount: signals.activeConcernCount,
    secondaryGoals: signals.secondaryGoals.map((goal) => ({
      concern: goal.concern,
      priority: goal.priority,
      severity: goal.severity,
      durationMonths: goal.durationMonths,
      locations: goal.locations,
      subtype: goal.subtype,
      triggers: goal.triggers,
      isPrimary: goal.isPrimary,
    })),
  };
}

export function formatAppliedProductHistoryForPrompt(
  history: SuggestionContextSummary['appliedProductHistory'],
): unknown {
  if (!history) return null;
  return {
    windowStartDate: history.windowStartDate,
    windowEndDate: history.windowEndDate,
    recordsConsidered: history.recordsConsidered,
    products: history.products.slice(0, 30).map((product) => ({
      productId: product.productId,
      brand: product.brand,
      name: product.name,
      category: product.category,
      stepLabel: product.stepLabel,
      sourceTypes: product.sourceTypes,
      dayparts: product.dayparts,
      statuses: product.statuses,
      useCount: product.useCount,
      lastAppliedDate: product.lastAppliedDate,
      lastAppliedAt: product.lastAppliedAt,
      isOffShelf: product.isOffShelf,
      isSubstitution: product.isSubstitution,
    })),
    recentItems: (history.recentItems ?? []).slice(0, 20).map((item) => ({
      targetDate: item.targetDate,
      targetTime: item.targetTime,
      daypart: item.daypart,
      status: item.status,
      itemSource: item.itemSource,
      stepLabel: item.stepLabel,
      recommendedProductId: item.recommendedProductId,
      recommendedName: item.recommendedName,
      recommendedCategory: item.recommendedCategory,
      appliedProductId: item.appliedProductId,
      appliedName: item.appliedName,
      appliedCategory: item.appliedCategory,
      appliedAt: item.appliedAt,
      isOffShelf: item.isOffShelf,
      isSubstitution: item.isSubstitution,
      notes: item.notes,
      substitutionReason: item.substitutionReason,
    })),
  };
}

export function formatJournalSignalsForPrompt(
  signals: SuggestionContextSummary['journalSignals'],
): unknown {
  if (!signals) return null;
  return {
    recordsConsidered: signals.recordsConsidered,
    latestEntryDate: signals.latestEntryDate,
    checkIns: {
      stressCounts: signals.checkIns.stressCounts,
      sleepCounts: signals.checkIns.sleepCounts,
      overallFeelCounts: signals.checkIns.overallFeelCounts,
      sunExposureCounts: signals.checkIns.sunExposureCounts,
      sweatExerciseDays: signals.checkIns.sweatExerciseDays,
      cycleMarkers: signals.checkIns.cycleMarkers.slice(0, 10),
      recentChangeKinds: signals.checkIns.recentChangeKinds.slice(0, 10),
      recentChanges: (signals.checkIns.recentChanges ?? [])
        .slice(0, 8)
        .map((change) => ({
          entryDate: change.entryDate,
          kind: change.kind,
          relatedInventoryProductId: change.relatedInventoryProductId,
          note: change.note,
        })),
      complaintNotes: signals.checkIns.complaintNotes
        .slice(0, 5)
        .map((note) => trimPromptText(note, 120)),
    },
    detectedConcerns: signals.detectedConcerns.slice(0, 20).map((concern) => ({
      concern: concern.concern,
      count: concern.count,
      severities: concern.severities,
      locations: concern.locations,
      averageConfidence: concern.averageConfidence,
      maxConfidence: concern.maxConfidence,
      changeDirections: concern.changeDirections,
    })),
    photoCoverage: {
      photoEntries: signals.photoCoverage.photoEntries,
      photoInputImages: signals.photoCoverage.photoInputImages,
      multiAnglePhotoEntries: signals.photoCoverage.multiAnglePhotoEntries,
      needsRetakeCount: signals.photoCoverage.needsRetakeCount,
    },
    trendSignals: signals.trendSignals.slice(0, 20),
    analysisQuality: signals.analysisQuality
      ? {
          visualLabelCounts: signals.analysisQuality.visualLabelCounts,
          trendLabelCounts: signals.analysisQuality.trendLabelCounts,
          lightingQualityCounts: signals.analysisQuality.lightingQualityCounts,
          framingQualityCounts: signals.analysisQuality.framingQualityCounts,
          issueCounts: signals.analysisQuality.issueCounts,
          trendExcludedReasons: signals.analysisQuality.trendExcludedReasons,
          averageQualityScore: signals.analysisQuality.averageQualityScore,
          usedForAnalysisImages: signals.analysisQuality.usedForAnalysisImages,
        }
      : null,
    interpretationSignals: signals.interpretationSignals
      ? {
          codes: signals.interpretationSignals.codes
            .slice(0, 12)
            .map((code) => ({
              code: code.code,
              severity: code.severity,
              count: code.count,
              latestEntryDate: code.latestEntryDate,
              sourceIds: code.sourceIds.slice(0, 12),
            })),
          sourceIds: signals.interpretationSignals.sourceIds.slice(0, 20),
          guidanceKeys: signals.interpretationSignals.guidanceKeys.slice(0, 20),
          caveatKeys: signals.interpretationSignals.caveatKeys.slice(0, 20),
        }
      : null,
    concernGuidance: signals.concernGuidance
      ? signals.concernGuidance.slice(0, 12).map((guidance) => ({
          concern: guidance.concern,
          severity: guidance.severity,
          count: guidance.count,
          locations: guidance.locations.slice(0, 12),
          confidenceLabels: guidance.confidenceLabels.slice(0, 12),
          actionKeys: guidance.actionKeys.slice(0, 12),
          avoidKeys: guidance.avoidKeys.slice(0, 12),
          factorKeys: guidance.factorKeys.slice(0, 12),
          possibleCauseItems: (guidance.possibleCauseItems ?? [])
            .slice(0, 4)
            .map((item) => trimPromptText(item, 140)),
          tryNextItems: (guidance.tryNextItems ?? [])
            .slice(0, 4)
            .map((item) => trimPromptText(item, 140)),
          avoidItems: (guidance.avoidItems ?? [])
            .slice(0, 4)
            .map((item) => trimPromptText(item, 140)),
          escalationKeys: guidance.escalationKeys.slice(0, 12),
          sourceIds: guidance.sourceIds.slice(0, 12),
        }))
      : [],
    visualChanges: signals.visualChanges
      ? signals.visualChanges.slice(0, 12).map((change) => ({
          concern: change.concern,
          directions: change.directions,
          count: change.count,
          averageConfidence: change.averageConfidence,
          latestDirection: change.latestDirection,
        }))
      : [],
    safetySignals: signals.safetySignals
      ? {
          urgentReviewRecommended:
            signals.safetySignals.urgentReviewRecommended,
          doctorFollowUpRecommended:
            signals.safetySignals.doctorFollowUpRecommended,
          doctorFlagReasons: signals.safetySignals.doctorFlagReasons
            .slice(0, 5)
            .map((reason) => trimPromptText(reason, 120)),
          safetyReasons: signals.safetySignals.safetyReasons.slice(0, 12),
          flaggedEntryCount: signals.safetySignals.flaggedEntryCount,
        }
      : null,
  };
}

export function formatRoutineMemoryForPrompt(
  memory: SuggestionContextSummary['routineMemory'],
): unknown {
  if (!memory) return null;
  return {
    recordsConsidered: memory.recordsConsidered,
    previousSuggestionCount: memory.previousSuggestionCount,
    sameDaypartSuggestionCount: memory.sameDaypartSuggestionCount,
    recentSameDaypartSuggestions: memory.recentSameDaypartFingerprints
      .slice(0, 10)
      .map((fingerprint) => ({
        targetDate: fingerprint.targetDate,
        targetTime: fingerprint.targetTime,
        productIds: fingerprint.productIds,
        productNames: fingerprint.productNames,
      })),
    recentlySuggestedProductIds: memory.recentlySuggestedProductIds.slice(
      0,
      50,
    ),
    skippedProducts: memory.skippedProducts,
    skippedProductsRule:
      'A skipped count means the user did not apply the product. Do not treat it as avoid/suppress unless scored product context or skippedCandidates provides a current safety or reaction reason.',
    substitutedProducts: memory.substitutedProducts,
    adheredProducts: memory.adheredProducts,
    editedLogCount: memory.editedLogCount,
    offShelfUseCount: memory.offShelfUseCount,
  };
}

export function formatEnvironmentSignalsForPrompt(
  signals: SuggestionContextSummary['environmentSignals'],
): unknown {
  if (!signals) return null;
  return {
    signalKinds: signals.signalKinds,
    alerts: signals.alerts.map((alert) => ({
      kind: alert.kind,
      title: alert.title,
      message: alert.message,
    })),
    safetyConstraints: signals.safetyConstraints,
    gapCategories: signals.gapCategories,
  };
}

export function formatScoredContextForPrompt(
  summary: SuggestionContextSummary,
): unknown {
  return {
    profileSignals: formatProfileSignalsForPrompt(summary.profileSignals),
    reaction: {
      hasSignal: summary.reaction.hasSignal,
      severity: summary.reaction.severity,
      confidence: summary.reaction.confidence,
      indicators: summary.reaction.indicators,
      affectedZones: summary.reaction.affectedZones,
      concernKeys: summary.reaction.concernKeys,
      daysSinceLatestSignal: summary.reaction.daysSinceLatestSignal,
      barrierCompromised: summary.reaction.barrierCompromised,
      photoInputImages: summary.reaction.photoInputImages,
      multiAnglePhotoEntries: summary.reaction.multiAnglePhotoEntries,
    },
    onDemand: summary.onDemand
      ? {
          intent: summary.onDemand.intent,
          intensity: summary.onDemand.intensity,
          note: summary.onDemand.note,
          activityAt: summary.onDemand.activityAt,
          requestedAt: summary.onDemand.requestedAt,
        }
      : null,
    routineBreak: {
      recentlyResumed: summary.routineBreak.recentlyResumed,
      lastPausedFrom: summary.routineBreak.lastPausedFrom,
      lastPausedUntil: summary.routineBreak.lastPausedUntil,
    },
    productScores: summary.productScores.slice(0, 20).map((score) => ({
      productId: score.productId,
      brand: score.brand,
      name: score.name,
      category: score.category,
      preferredTimeOfDay: score.preferredTimeOfDay,
      openedAt: score.openedAt ?? null,
      expiresAt: score.expiresAt ?? null,
      effectiveExpiresAt: score.effectiveExpiresAt ?? null,
      introductionStatus: score.introductionStatus ?? null,
      introductionStartedAt: score.introductionStartedAt ?? null,
      introductionStatusUpdatedAt: score.introductionStatusUpdatedAt ?? null,
      benefits: score.benefits ?? [],
      suitedFor: score.suitedFor ?? [],
      applicationMethod: score.applicationMethod ?? null,
      quantity: score.quantity ?? null,
      guidanceSteps: score.guidanceSteps ?? [],
      guidanceCautions: score.guidanceCautions ?? [],
      userProductNote: score.userProductNote ?? null,
      activeTags: score.activeTags,
      suitabilityScore: score.suitabilityScore,
      suitabilityReasons: score.suitabilityReasons,
      cautionReasons: score.cautionReasons,
      waitMinutes: score.waitMinutes,
      inciQuality: score.inciQuality,
      dataQuality: score.dataQuality,
      dataQualityWarnings: score.dataQualityWarnings,
      ingredientConflicts: (score.ingredientConflicts ?? [])
        .slice(0, 8)
        .map((conflict) => ({
          code: conflict.code,
          severity: conflict.severity,
          productIds: conflict.productIds,
          ingredientNames: conflict.ingredientNames,
          description: conflict.description,
          mitigation: conflict.mitigation,
        })),
      evidenceSourceIds: score.evidenceSourceIds,
    })),
    environment: formatEnvironmentForPrompt(summary.environment),
    applicationPatterns: {
      days: summary.applicationPatterns.days,
      daysSinceLastApplication:
        summary.applicationPatterns.daysSinceLastApplication,
      conservativeRestart: summary.applicationPatterns.conservativeRestart,
      skippedByCategory: summary.applicationPatterns.skippedByCategory,
      substitutedByCategory: summary.applicationPatterns.substitutedByCategory,
      addedOffShelfCount: summary.applicationPatterns.addedOffShelfCount,
      editedLogCount: summary.applicationPatterns.editedLogCount,
      adherenceByCategory: summary.applicationPatterns.adherenceByCategory,
    },
    safetyConstraints: summary.safetyConstraints,
    governance: {
      safetyPolicyVersion: summary.governance.safetyPolicyVersion,
      safetyPolicyReviewedAt: summary.governance.safetyPolicyReviewedAt,
      aiPersonalizationAllowed: summary.governance.aiPersonalizationAllowed,
      aiPersonalizationBlockedReason:
        summary.governance.aiPersonalizationBlockedReason,
    },
    skippedCandidates: summary.skippedCandidates.map((candidate) => ({
      productId: candidate.productId,
      brand: candidate.brand ?? null,
      name: candidate.name ?? null,
      category: candidate.category ?? null,
      introductionStatus: candidate.introductionStatus ?? null,
      reason: candidate.reason,
      sourceIds: candidate.sourceIds,
    })),
  };
}

function formatProfileSignalsForPrompt(
  signals: SuggestionContextSummary['profileSignals'],
): unknown {
  if (!signals) return null;
  return {
    safety: {
      pregnancyStatus: signals.safety.pregnancyStatus,
      underDermatologistCare: signals.safety.underDermatologistCare,
      conditions: signals.safety.conditions,
      medications: signals.safety.medications,
      photosensitizingOther: signals.safety.photosensitizingOther,
      recentProcedures: signals.safety.recentProcedures.map((procedure) => ({
        type: procedure.type,
        performedAt: procedure.performedAt,
      })),
    },
    routinePreferences: signals.routinePreferences,
    skinBehavior: signals.skinBehavior,
    shoppingPreferences: signals.shoppingPreferences,
    activeTolerances: signals.activeTolerances.map((tolerance) => ({
      ingredient: tolerance.ingredient,
      tolerance: tolerance.tolerance,
      lastUsed: tolerance.lastUsed,
    })),
  };
}

function formatEnvironmentForPrompt(
  environment: SuggestionContextSummary['environment'],
): unknown {
  if (!environment) return null;
  return {
    status: environment.status,
    provider: environment.provider,
    generatedAt: environment.generatedAt,
    locationPersonalized: environment.locationPersonalized,
    season: environment.season,
    temperatureCelsius: environment.temperatureCelsius,
    temperatureBand: environment.temperatureBand,
    humidity: environment.humidity,
    humidityBand: environment.humidityBand,
    uvIndex: environment.uvIndex,
    uvRisk: environment.uvRisk,
    airQualityIndex: environment.airQualityIndex,
    airQualityRisk: environment.airQualityRisk,
    pm25: environment.pm25,
    pm10: environment.pm10,
    pollenRisk: environment.pollenRisk,
    conditionLabel: environment.conditionLabel,
    waterHardness: environment.waterHardness,
    waterSensitivity: environment.waterSensitivity,
    climateSensitivities: environment.climateSensitivities,
    transitionSignals: environment.transitionSignals,
    confidence: environment.confidence,
    stale: environment.stale,
    sourceIds: environment.sourceIds,
  };
}

function compactPromptValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return trimPromptText(value, SUGGESTION_PROMPT_STRING_MAX_CHARS);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, SUGGESTION_PROMPT_ARRAY_MAX_ITEMS)
      .map((item) => compactPromptValue(item));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    const compacted: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      compacted[key] = compactPromptValue(entryValue);
    }
    return compacted;
  }
  return value;
}

function trimPromptText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return compact.slice(0, maxLength - 1).trimEnd();
}
