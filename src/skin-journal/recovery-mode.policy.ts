import {
  RecoveryPhaseValue,
  RecoveryReturnStepValue,
  RecoveryTriggerSourceValue,
  type ReactionReportPayload,
  type ReactionReportSeverity,
  type ReactionReportSymptom,
  type RecoveryPhase,
  type RecoveryReturnStep,
  type RecoveryTriggerSource,
} from './skin-journal.constants';

const RECOVERY_BARRIER_SYMPTOMS = [
  'burning',
  'stinging',
  'tightness',
  'peeling',
  'redness',
] as const satisfies readonly ReactionReportSymptom[];

const RECOVERY_BARRIER_SYMPTOM_SET: ReadonlySet<ReactionReportSymptom> =
  new Set(RECOVERY_BARRIER_SYMPTOMS);

export type RecoveryModeStart = {
  phase: RecoveryPhase;
  trigger_source: RecoveryTriggerSource;
  trigger_symptoms: ReactionReportSymptom[];
  trigger_severity: ReactionReportSeverity | null;
  active_overuse: boolean;
  review_after: Date | null;
  exit_eligible_at: Date | null;
  return_step: RecoveryReturnStep;
};

export function shouldStartRecoveryModeFromReactionReport(
  report: ReactionReportPayload | null | undefined,
): boolean {
  if (!report) {
    return false;
  }

  if ((report.red_flags?.length ?? 0) > 0) {
    return true;
  }

  if (!report.symptoms.length) {
    return false;
  }

  if (report.severity === 'moderate' || report.severity === 'severe') {
    return true;
  }

  return normalizeRecoveryTriggerSymptoms(report.symptoms).length > 0;
}

export function buildRecoveryModeStart(
  report: ReactionReportPayload,
  now = new Date(),
): RecoveryModeStart {
  const triggerSeverity = resolveRecoverySeverity(report);
  const exitWindowDays = recoveryExitWindowDays(triggerSeverity);

  return {
    phase: RecoveryPhaseValue.Stabilize,
    trigger_source: RecoveryTriggerSourceValue.ReactionReport,
    trigger_symptoms: normalizeRecoveryTriggerSymptoms(report.symptoms),
    trigger_severity: triggerSeverity,
    active_overuse: report.suspected_trigger === 'active_ingredient',
    review_after: addDays(now, 3),
    exit_eligible_at: addDays(now, exitWindowDays),
    return_step: RecoveryReturnStepValue.NotStarted,
  };
}

export function buildPhotoAnalysisRecoveryModeStart(
  severity: ReactionReportSeverity,
  now = new Date(),
): RecoveryModeStart {
  const exitWindowDays = recoveryExitWindowDays(severity);

  return {
    phase: RecoveryPhaseValue.Stabilize,
    trigger_source: RecoveryTriggerSourceValue.PhotoAnalysis,
    trigger_symptoms: [],
    trigger_severity: severity,
    active_overuse: false,
    review_after: addDays(now, 3),
    exit_eligible_at: addDays(now, exitWindowDays),
    return_step: RecoveryReturnStepValue.NotStarted,
  };
}

export function normalizeRecoveryTriggerSymptoms(
  symptoms: readonly ReactionReportSymptom[] | null | undefined,
): ReactionReportSymptom[] {
  const unique = new Set<ReactionReportSymptom>();
  for (const symptom of symptoms ?? []) {
    if (RECOVERY_BARRIER_SYMPTOM_SET.has(symptom)) {
      unique.add(symptom);
    }
  }
  return Array.from(unique);
}

function resolveRecoverySeverity(
  report: ReactionReportPayload,
): ReactionReportSeverity {
  return (report.red_flags?.length ?? 0) > 0 ? 'severe' : report.severity;
}

function recoveryExitWindowDays(severity: ReactionReportSeverity): number {
  if (severity === 'severe') {
    return 7;
  }
  if (severity === 'moderate') {
    return 5;
  }
  return 3;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
