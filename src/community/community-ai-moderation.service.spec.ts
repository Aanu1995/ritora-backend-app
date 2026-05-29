import type { ConfigService } from '@nestjs/config';
import { OPENAI_REASONING_EFFORT } from '../common/utils/openai-request-options';
import { CommunityAiModerationService } from './community-ai-moderation.service';
import {
  CommunityContentType,
  CommunityDisclosureType,
  CommunityModerationStatus,
  CommunitySafetySeverity,
} from './community.types';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as ConfigService;
}

function openAiResponse(body: Record<string, unknown>): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('CommunityAiModerationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps critical safety flags in the admin queue without calling the LLM', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: 'sk-test',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Routine,
      disclosureType: CommunityDisclosureType.Ordinary,
      flags: [
        {
          code: 'medical_claim',
          severity: CommunitySafetySeverity.High,
          message: 'Medical claim detected.',
        },
      ],
      text: 'This cured my acne.',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe(CommunityModerationStatus.PendingReview);
    expect(result.automation.handledBy).toBe('admin');
    expect(result.automation.critical).toBe(true);
  });

  it('calls OpenAI for non-critical content and applies the structured decision', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      openAiResponse({
        output_text: JSON.stringify({
          action: 'request_edit',
          confidence: 0.88,
          reason: 'Disclosure is unclear.',
        }),
      }),
    );
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: 'sk-test',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      flags: [
        {
          code: 'possible_undisclosed_sponsorship',
          severity: CommunitySafetySeverity.Medium,
          message: 'Possible sponsorship language.',
        },
      ],
      text: 'Use my code for a discount.',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body;
    if (typeof body !== 'string') throw new Error('Expected string body');
    const requestBody = JSON.parse(body) as {
      max_output_tokens: number;
      reasoning: { effort: string };
    };
    expect(requestBody.max_output_tokens).toBe(2_000);
    expect(requestBody.reasoning).toEqual({ effort: OPENAI_REASONING_EFFORT });
    expect(result.status).toBe(CommunityModerationStatus.NeedsEdit);
    expect(result.automation.provider).toBe('openai');
    expect(result.automation.reason).toBe('Disclosure is unclear.');
  });

  it('retries malformed structured output before using fallback moderation', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        openAiResponse({
          output_text: '{"action":"request_edit","confidence":0.91,"reason":"',
        }),
      )
      .mockResolvedValueOnce(
        openAiResponse({
          output_text: JSON.stringify({
            action: 'request_edit',
            confidence: 0.91,
            reason: 'Disclosure needs a matching label.',
          }),
        }),
      );
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: 'sk-test',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      flags: [
        {
          code: 'possible_undisclosed_sponsorship',
          severity: CommunitySafetySeverity.Medium,
          message: 'Possible sponsorship language.',
        },
      ],
      text: 'Use my code for a discount.',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(CommunityModerationStatus.NeedsEdit);
    expect(result.automation.provider).toBe('openai');
    expect(result.automation.fallbackReason).toBeNull();
    expect(result.automation.reason).toBe('Disclosure needs a matching label.');
  });

  it('does not let the LLM publish against deterministic guardrails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      openAiResponse({
        output_text: JSON.stringify({
          action: 'publish',
          confidence: 0.91,
          reason: 'Looks fine.',
        }),
      }),
    );
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: 'sk-test',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      flags: [
        {
          code: 'possible_undisclosed_sponsorship',
          severity: CommunitySafetySeverity.Medium,
          message: 'Possible sponsorship language.',
        },
      ],
      text: 'Use my code for a discount.',
    });

    expect(result.status).toBe(CommunityModerationStatus.NeedsEdit);
    expect(result.automation.reason).toContain('Deterministic guardrail');
  });

  it('keeps fixable medium-risk flags out of the admin queue when the LLM over-escalates', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      openAiResponse({
        output_text: JSON.stringify({
          action: 'admin_review',
          confidence: 0.98,
          reason: 'Possible hostile wording.',
        }),
      }),
    );
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: 'sk-test',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      flags: [
        {
          code: 'possible_harassment',
          severity: CommunitySafetySeverity.Medium,
          message: 'Possible harassment language.',
        },
      ],
      text: 'This product felt greasy and the wording needs editing.',
    });

    expect(result.status).toBe(CommunityModerationStatus.NeedsEdit);
    expect(result.automation.action).toBe('request_edit');
    expect(result.automation.handledBy).toBe('automation');
    expect(result.automation.reason).toContain('Deterministic guardrail');
  });

  it('falls back deterministically when OpenAI is not configured', async () => {
    const service = new CommunityAiModerationService(
      config({
        OPENAI_API_KEY: '',
        COMMUNITY_MODERATION_AI_MODEL: 'gpt-5-mini',
      }),
    );

    const result = await service.triage({
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Sponsored,
      flags: [],
      text: 'Sponsored review, clearly labeled.',
    });

    expect(result.status).toBe(CommunityModerationStatus.Published);
    expect(result.automation.provider).toBe('deterministic_fallback');
    expect(result.automation.fallbackReason).toBe('missing_api_key');
  });
});
