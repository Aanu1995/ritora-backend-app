import { Injectable } from '@nestjs/common';
import {
  CommunityDisclosureType,
  CommunityModerationStatus,
  CommunitySafetySeverity,
  type CommunityRoutineStepSnapshot,
  type CommunitySafetyFlag,
} from './community.types';

const CLAIM_PATTERNS = [
  /\bcure[sd]?\b/i,
  /\btreats?\b/i,
  /\bdiagnos(?:e|is|ed)\b/i,
  /\bprescri(?:be|ption|bed)\b/i,
  /\bantibiotic\b/i,
  /\bsteroid\b/i,
];

const SPONSOR_PATTERNS = [
  /\baffiliate\b/i,
  /\bcommission\b/i,
  /\bdiscount code\b/i,
  /\buse my code\b/i,
  /\bsponsored\b/i,
  /\bgifted\b/i,
];

const HARASSMENT_PATTERNS = [/\bstupid\b/i, /\bugly\b/i, /\bidiot\b/i];
const SPAM_OR_MODERATION_MANIPULATION_PATTERNS = [
  /\bignore (?:all )?(?:previous|above|moderation|system) instructions\b/i,
  /\b(output|return|mark|set) (?:this )?(?:as )?publish(?:ed)?\b/i,
  /\btelegram\b/i,
  /\bwhats\s?app\b/i,
  /\bdm me\b/i,
  /\bbuy now\b/i,
  /\bcrypto\b/i,
  /\bmiracle\b/i,
];
const EXFOLIANT_CATEGORIES = new Set(['exfoliant', 'toner', 'treatment']);
const RETINOID_WORDS = ['retinol', 'retinoid', 'tretinoin', 'adapalene'];
const ACID_WORDS = ['aha', 'bha', 'glycolic', 'lactic', 'salicylic', 'acid'];

@Injectable()
export class CommunitySafetyService {
  scanText(text: string | null | undefined): CommunitySafetyFlag[] {
    const value = text ?? '';
    const flags: CommunitySafetyFlag[] = [];

    if (CLAIM_PATTERNS.some((pattern) => pattern.test(value))) {
      flags.push({
        code: 'medical_claim',
        severity: CommunitySafetySeverity.High,
        message:
          'This content includes diagnosis, cure, prescription, or treatment language and needs review.',
      });
    }

    if (SPONSOR_PATTERNS.some((pattern) => pattern.test(value))) {
      flags.push({
        code: 'possible_undisclosed_sponsorship',
        severity: CommunitySafetySeverity.Medium,
        message:
          'This content may mention sponsorship, gifted products, or affiliate incentives.',
      });
    }

    if (HARASSMENT_PATTERNS.some((pattern) => pattern.test(value))) {
      flags.push({
        code: 'possible_harassment',
        severity: CommunitySafetySeverity.Medium,
        message: 'This content may include personal attacks or harassment.',
      });
    }

    if (
      SPAM_OR_MODERATION_MANIPULATION_PATTERNS.some((pattern) =>
        pattern.test(value),
      )
    ) {
      flags.push({
        code: 'possible_spam_or_moderation_manipulation',
        severity: CommunitySafetySeverity.Medium,
        message:
          'This content may include spam, off-platform contact, or moderation-manipulation language.',
      });
    }

    return flags;
  }

  scanRoutine(steps: CommunityRoutineStepSnapshot[]): CommunitySafetyFlag[] {
    const flags: CommunitySafetyFlag[] = [];
    const searchable = steps
      .map((step) =>
        [step.productBrand, step.productName, step.category, step.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      )
      .join(' ');

    const activeStepCount = steps.filter(
      (step) =>
        EXFOLIANT_CATEGORIES.has(step.category) ||
        ACID_WORDS.some((word) => this.stepContains(step, word)),
    ).length;
    const hasRetinoid = RETINOID_WORDS.some((word) =>
      searchable.includes(word),
    );
    const hasAcid = ACID_WORDS.some((word) => searchable.includes(word));
    const hasSunscreen = steps.some((step) =>
      ['sun-protection', 'sunscreen', 'spf'].includes(step.category),
    );

    if (activeStepCount >= 3) {
      flags.push({
        code: 'active_overload',
        severity: CommunitySafetySeverity.High,
        message:
          'This routine appears to stack several active or exfoliating steps.',
      });
    }

    if (hasRetinoid && hasAcid) {
      flags.push({
        code: 'retinoid_acid_conflict',
        severity: CommunitySafetySeverity.High,
        message:
          'This routine combines retinoid-style and acid-style actives and needs review.',
      });
    }

    if ((hasRetinoid || hasAcid) && !hasSunscreen) {
      flags.push({
        code: 'missing_sunscreen',
        severity: CommunitySafetySeverity.Medium,
        message:
          'This routine includes photosensitizing-style actives but no sunscreen step.',
      });
    }

    return flags;
  }

  resolveStatus(input: {
    disclosureType: CommunityDisclosureType;
    flags: CommunitySafetyFlag[];
  }): CommunityModerationStatus {
    if (
      input.flags.some(
        (flag) =>
          flag.severity === CommunitySafetySeverity.High ||
          flag.code === 'possible_undisclosed_sponsorship',
      )
    ) {
      return CommunityModerationStatus.PendingReview;
    }

    if (
      input.disclosureType === CommunityDisclosureType.Sponsored ||
      input.disclosureType === CommunityDisclosureType.Affiliate ||
      input.disclosureType === CommunityDisclosureType.BrandRep
    ) {
      return CommunityModerationStatus.PendingReview;
    }

    return CommunityModerationStatus.Published;
  }

  private stepContains(
    step: CommunityRoutineStepSnapshot,
    word: string,
  ): boolean {
    return [step.productBrand, step.productName, step.category, step.notes]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(word);
  }
}
