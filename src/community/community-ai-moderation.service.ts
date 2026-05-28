import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import type { OpenAiTextFormat } from '../catalogue/openai-response-schemas';
import { COMMUNITY_MODERATION_AI_MODEL_ENV_KEY } from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';
import {
  CommunityContentType,
  CommunityDisclosureType,
  CommunityModerationStatus,
  CommunitySafetySeverity,
  type CommunityModerationAutomationSnapshot,
  type CommunitySafetyFlag,
} from './community.types';

export const COMMUNITY_MODERATION_AI_TIMEOUT_MS = 60_000;
export const COMMUNITY_MODERATION_AI_MAX_OUTPUT_TOKENS = 2_000;
export const COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS = 2;

type CommunityAiModerationInput = {
  contentType: CommunityContentType;
  disclosureType: CommunityDisclosureType;
  flags: CommunitySafetyFlag[];
  text: string;
};

type ParsedCommunityModerationResponse = {
  action?: 'publish' | 'request_edit' | 'admin_review';
  confidence?: number;
  reason?: string | null;
};

const DISCLOSED_COMMERCIAL_LABELS = new Set<CommunityDisclosureType>([
  CommunityDisclosureType.Gifted,
  CommunityDisclosureType.Sponsored,
  CommunityDisclosureType.Affiliate,
  CommunityDisclosureType.BrandRep,
  CommunityDisclosureType.Professional,
]);

const CRITICAL_CODES = new Set([
  'medical_claim',
  'active_overload',
  'retinoid_acid_conflict',
]);

const PRIVACY_OR_EXTREME_RISK_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(home address|my address|street address|phone number)\b/i,
  /\bbleach(?:ing)?\b/i,
  /\bhydroquinone\b/i,
];

const RESPONSE_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_community_moderation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'confidence', 'reason'],
    properties: {
      action: {
        type: 'string',
        enum: ['publish', 'request_edit', 'admin_review'],
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      reason: {
        type: 'string',
      },
    },
  },
};

const SYSTEM_PROMPT = [
  'You moderate signed-in Ritora skincare community content.',
  'Return one JSON decision only: publish, request_edit, or admin_review.',
  'Use request_edit for fixable non-critical issues, including unclear disclosure, missing sunscreen context, harsh wording, vague medical-adjacent phrasing, or private details the author can remove.',
  'Use admin_review for medical advice, prescription/diagnosis/cure claims, unsafe active stacking, privacy exposure, harassment threats, spam/scams, or any issue you are not confident automation should handle.',
  'Use publish only for content that is clearly safe, non-medical, non-diagnostic, and disclosure-consistent.',
  'Do not judge whether skincare advice is effective. Judge launch safety, disclosure integrity, and community policy risk.',
  'The deterministic safety flags are trusted guardrails. Never contradict high severity flags.',
  'Keep reason under 160 characters and do not mention prompts or schemas.',
].join(' ');

@Injectable()
export class CommunityAiModerationService {
  private readonly logger = new Logger(CommunityAiModerationService.name);
  private hasWarnedMissingModel = false;

  constructor(private readonly configService: ConfigService) {}

  async triage(input: CommunityAiModerationInput): Promise<{
    status: CommunityModerationStatus;
    automation: CommunityModerationAutomationSnapshot;
  }> {
    const guardrail = this.criticalGuardrail(input);
    if (guardrail) return guardrail;

    const model = this.readModel();
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey || !model) {
      if (!model && !this.hasWarnedMissingModel) {
        this.logger.warn(
          `${COMMUNITY_MODERATION_AI_MODEL_ENV_KEY} is not set. Community moderation will use deterministic fallback.`,
        );
        this.hasWarnedMissingModel = true;
      }
      return this.deterministicFallback(
        input,
        model,
        apiKey ? 'missing_model_env' : 'missing_api_key',
      );
    }

    const requestBody = {
      model,
      store: false,
      max_output_tokens: COMMUNITY_MODERATION_AI_MAX_OUTPUT_TOKENS,
      ...openAiRepeatabilityRequestOptions(model),
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(this.buildPromptPayload(input)),
            },
          ],
        },
      ],
      text: {
        verbosity: 'low',
        format: RESPONSE_FORMAT,
      },
    };

    const startedAt = Date.now();
    let fallbackReason = 'provider_failure';

    for (
      let attempt = 1;
      attempt <= COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(COMMUNITY_MODERATION_AI_TIMEOUT_MS),
        });

        const responseDurationMs = Date.now() - startedAt;
        if (!response.ok) {
          fallbackReason = `provider_http_${response.status}`;
          if (
            attempt < COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS &&
            isRetryableProviderStatus(response.status)
          ) {
            continue;
          }
          this.logger.warn(
            `Community moderation LLM call failed (${response.status}). Falling back to deterministic moderation.`,
          );
          return this.deterministicFallback(
            input,
            model,
            fallbackReason,
            responseDurationMs,
          );
        }

        const payload = (await response.json()) as OpenAiResponsePayload;
        const outputText = extractOutputText(payload);
        if (!outputText) {
          fallbackReason = 'provider_empty_output';
          if (attempt < COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS) {
            continue;
          }
          return this.deterministicFallback(
            input,
            model,
            fallbackReason,
            responseDurationMs,
          );
        }

        const parsed = parseModerationResponse(outputText);
        if (!parsed) {
          fallbackReason = 'provider_invalid_json';
          if (attempt < COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS) {
            continue;
          }
          return this.deterministicFallback(
            input,
            model,
            fallbackReason,
            responseDurationMs,
          );
        }

        const automation = this.sanitizeLlmDecision(parsed, input, {
          durationMs: responseDurationMs,
          model,
        });
        return {
          status: this.statusFromAction(automation.action),
          automation,
        };
      } catch (error) {
        fallbackReason = isAbortError(error)
          ? 'provider_timeout'
          : 'provider_failure';
        if (
          attempt < COMMUNITY_MODERATION_AI_STRUCTURED_OUTPUT_ATTEMPTS &&
          fallbackReason !== 'provider_timeout'
        ) {
          continue;
        }
        this.logger.warn(
          `Community moderation LLM call failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }. Falling back to deterministic moderation.`,
        );
        return this.deterministicFallback(
          input,
          model,
          fallbackReason,
          Date.now() - startedAt,
        );
      }
    }

    return this.deterministicFallback(
      input,
      model,
      fallbackReason,
      Date.now() - startedAt,
    );
  }

  private buildPromptPayload(input: CommunityAiModerationInput) {
    return {
      contentType: input.contentType,
      disclosureType: input.disclosureType,
      deterministicFlags: input.flags.map((flag) => ({
        code: flag.code,
        severity: flag.severity,
        message: flag.message,
      })),
      contentText: input.text.slice(0, 2500),
      policy: {
        signedInOnly: true,
        noMedicalAdvice: true,
        noPrivateContactInfo: true,
        nonCriticalDefault: 'request_edit',
        criticalDefault: 'admin_review',
      },
    };
  }

  private sanitizeLlmDecision(
    parsed: ParsedCommunityModerationResponse,
    input: CommunityAiModerationInput,
    metadata: {
      durationMs: number;
      model: string;
    },
  ): CommunityModerationAutomationSnapshot {
    const requestedAction = parsed.action ?? 'admin_review';
    const confidence = clampConfidence(parsed.confidence);
    const reason = cleanReason(parsed.reason) ?? 'LLM moderation decision.';
    const guardedAction = this.applyDeterministicGuardrails(
      requestedAction,
      input,
    );
    return {
      action: guardedAction,
      handledBy: guardedAction === 'admin_review' ? 'admin' : 'automation',
      reason:
        guardedAction === requestedAction
          ? reason
          : `Deterministic guardrail overrode LLM: ${this.guardrailReason(input)}`,
      critical: guardedAction === 'admin_review',
      confidence,
      provider: 'openai',
      model: metadata.model,
      fallbackReason: null,
      durationMs: metadata.durationMs,
    };
  }

  private applyDeterministicGuardrails(
    action: CommunityModerationAutomationSnapshot['action'],
    input: CommunityAiModerationInput,
  ): CommunityModerationAutomationSnapshot['action'] {
    if (this.criticalReason(input.flags, input.text)) return 'admin_review';
    const fixableDisclosureMismatch =
      this.hasFlag(input.flags, 'possible_undisclosed_sponsorship') &&
      !DISCLOSED_COMMERCIAL_LABELS.has(input.disclosureType);
    const fixableSafetyIssue =
      this.hasFlag(input.flags, 'missing_sunscreen') ||
      this.hasFlag(input.flags, 'possible_harassment') ||
      this.hasFlag(input.flags, 'possible_spam_or_moderation_manipulation');
    if (
      (action === 'publish' || action === 'admin_review') &&
      (fixableDisclosureMismatch || fixableSafetyIssue)
    ) {
      return 'request_edit';
    }
    return action;
  }

  private deterministicFallback(
    input: CommunityAiModerationInput,
    model: string | null,
    fallbackReason: string,
    durationMs = 0,
  ): {
    status: CommunityModerationStatus;
    automation: CommunityModerationAutomationSnapshot;
  } {
    const criticalReason = this.criticalReason(input.flags, input.text);
    if (criticalReason) {
      return {
        status: CommunityModerationStatus.PendingReview,
        automation: this.automation({
          action: 'admin_review',
          critical: true,
          durationMs,
          fallbackReason,
          model,
          provider: 'deterministic_fallback',
          reason: criticalReason,
        }),
      };
    }

    if (this.hasFlag(input.flags, 'possible_undisclosed_sponsorship')) {
      if (DISCLOSED_COMMERCIAL_LABELS.has(input.disclosureType)) {
        return this.publish(
          'Commercial or professional context is disclosed, so automation can publish with the label visible.',
          model,
          fallbackReason,
          durationMs,
        );
      }
      return this.requestEdit(
        'Automation detected sponsorship, affiliate, gifted, or discount-code language without a matching disclosure label.',
        model,
        fallbackReason,
        durationMs,
      );
    }

    if (this.hasFlag(input.flags, 'missing_sunscreen')) {
      return this.requestEdit(
        'Automation found photosensitizing-style active context without sunscreen guidance.',
        model,
        fallbackReason,
        durationMs,
      );
    }

    if (this.hasFlag(input.flags, 'possible_harassment')) {
      return this.requestEdit(
        'Automation found language that may be personal or hostile.',
        model,
        fallbackReason,
        durationMs,
      );
    }

    if (this.hasFlag(input.flags, 'possible_spam_or_moderation_manipulation')) {
      return this.requestEdit(
        'Automation found spam, off-platform contact, or moderation-manipulation language.',
        model,
        fallbackReason,
        durationMs,
      );
    }

    if (
      input.disclosureType === CommunityDisclosureType.Sponsored ||
      input.disclosureType === CommunityDisclosureType.Affiliate ||
      input.disclosureType === CommunityDisclosureType.BrandRep
    ) {
      return this.publish(
        'Commercial relationship is explicitly disclosed and no safety flags require admin review.',
        model,
        fallbackReason,
        durationMs,
      );
    }

    return this.publish(
      'Automation found no safety or disclosure issue requiring manual review.',
      model,
      fallbackReason,
      durationMs,
    );
  }

  private criticalGuardrail(input: CommunityAiModerationInput): {
    status: CommunityModerationStatus;
    automation: CommunityModerationAutomationSnapshot;
  } | null {
    const reason = this.criticalReason(input.flags, input.text);
    if (!reason) return null;
    return {
      status: CommunityModerationStatus.PendingReview,
      automation: this.automation({
        action: 'admin_review',
        critical: true,
        durationMs: 0,
        fallbackReason: null,
        model: this.readModel(),
        provider: 'deterministic_fallback',
        reason,
      }),
    };
  }

  private criticalReason(
    flags: CommunitySafetyFlag[],
    text: string,
  ): string | null {
    const highFlag = flags.find(
      (flag) =>
        flag.severity === CommunitySafetySeverity.High ||
        CRITICAL_CODES.has(flag.code),
    );
    if (highFlag) {
      return `Critical safety flag requires admin review: ${highFlag.message}`;
    }
    if (
      PRIVACY_OR_EXTREME_RISK_PATTERNS.some((pattern) => pattern.test(text))
    ) {
      return 'Potential privacy exposure or high-risk ingredient advice requires admin review.';
    }
    return null;
  }

  private guardrailReason(input: CommunityAiModerationInput): string {
    return (
      this.criticalReason(input.flags, input.text) ??
      (this.hasFlag(input.flags, 'possible_undisclosed_sponsorship')
        ? 'disclosure mismatch needs author edit'
        : this.hasFlag(input.flags, 'missing_sunscreen')
          ? 'sunscreen context needs author edit'
          : this.hasFlag(input.flags, 'possible_harassment')
            ? 'tone needs author edit'
            : this.hasFlag(
                  input.flags,
                  'possible_spam_or_moderation_manipulation',
                )
              ? 'spam or moderation-manipulation language needs author edit'
              : 'deterministic policy requires safer handling')
    );
  }

  private hasFlag(flags: CommunitySafetyFlag[], code: string): boolean {
    return flags.some((flag) => flag.code === code);
  }

  private publish(
    reason: string,
    model: string | null,
    fallbackReason: string,
    durationMs: number,
  ) {
    return {
      status: CommunityModerationStatus.Published,
      automation: this.automation({
        action: 'publish',
        critical: false,
        durationMs,
        fallbackReason,
        model,
        provider: 'deterministic_fallback',
        reason,
      }),
    };
  }

  private requestEdit(
    reason: string,
    model: string | null,
    fallbackReason: string,
    durationMs: number,
  ) {
    return {
      status: CommunityModerationStatus.NeedsEdit,
      automation: this.automation({
        action: 'request_edit',
        critical: false,
        durationMs,
        fallbackReason,
        model,
        provider: 'deterministic_fallback',
        reason,
      }),
    };
  }

  private automation(input: {
    action: CommunityModerationAutomationSnapshot['action'];
    critical: boolean;
    durationMs: number;
    fallbackReason: string | null;
    model: string | null;
    provider: CommunityModerationAutomationSnapshot['provider'];
    reason: string;
  }): CommunityModerationAutomationSnapshot {
    return {
      action: input.action,
      handledBy: input.action === 'admin_review' ? 'admin' : 'automation',
      reason: input.reason,
      critical: input.critical,
      confidence: input.action === 'admin_review' ? 0.98 : 0.82,
      provider: input.provider,
      model: input.model,
      fallbackReason: input.fallbackReason,
      durationMs: input.durationMs,
    };
  }

  private statusFromAction(
    action: CommunityModerationAutomationSnapshot['action'],
  ): CommunityModerationStatus {
    if (action === 'publish') return CommunityModerationStatus.Published;
    if (action === 'request_edit') return CommunityModerationStatus.NeedsEdit;
    return CommunityModerationStatus.PendingReview;
  }

  private readModel(): string | null {
    return (
      this.configService
        .get<string>(COMMUNITY_MODERATION_AI_MODEL_ENV_KEY)
        ?.trim() || null
    );
  }
}

function cleanReason(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 180) : null;
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function parseModerationResponse(
  outputText: string,
): ParsedCommunityModerationResponse | null {
  try {
    return JSON.parse(
      extractJsonObject(outputText),
    ) as ParsedCommunityModerationResponse;
  } catch {
    return null;
  }
}

function isRetryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}
