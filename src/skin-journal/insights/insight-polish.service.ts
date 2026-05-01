import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  extractOutputText,
  type OpenAiResponsePayload,
} from '../../catalogue/openai-extraction.utils';
import {
  INSIGHTS_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../../common/utils/openai-config';
import {
  SKIN_JOURNAL_INSIGHT_PROMPT_VERSION,
  SKIN_JOURNAL_INSIGHT_POLISH_TIMEOUT_MS,
  SKIN_JOURNAL_INSIGHTS_DEFAULT_MODEL,
} from '../skin-journal.constants';
import { buildInsightsPolishPrompt } from './prompts/insights-polish.prompt';
import type { InsightBlock, InsightCandidate } from './insight-types';
import { KnowledgeBaseService } from './knowledge-base/knowledge-base.service';
import {
  containsUnsafeInsightLanguage,
  validateInsightSourceReferences,
} from './knowledge-base/validators';

const POLISH_RESPONSE_SCHEMA = z.object({
  insights: z.array(
    z.object({
      facts_hash: z.string().min(1),
      headline_text: z.string().min(1).max(220),
      text_blocks: z.array(
        z.object({
          index: z.number().int().min(0),
          text: z.string().min(1).max(420),
        }),
      ),
      selected_caveat_keys: z.array(z.string()).default([]),
    }),
  ),
});

const OPENAI_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'skin_journal_insight_polish',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['insights'],
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'facts_hash',
            'headline_text',
            'text_blocks',
            'selected_caveat_keys',
          ],
          properties: {
            facts_hash: { type: 'string' },
            headline_text: { type: 'string' },
            text_blocks: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'text'],
                properties: {
                  index: { type: 'integer', minimum: 0 },
                  text: { type: 'string' },
                },
              },
            },
            selected_caveat_keys: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;

type PolishOutput = z.infer<typeof POLISH_RESPONSE_SCHEMA>;
type PolishResult = PolishOutput['insights'][number];

interface CachedPolishResult {
  output: PolishResult;
  cacheHit: boolean;
}

interface CachedPolishEntry {
  output: PolishResult;
  expiresAt: number;
}

interface PolishOptions {
  locale: string;
  aiPolishEnabled: boolean;
}

@Injectable()
export class InsightPolishService {
  private readonly logger = new Logger(InsightPolishService.name);
  private readonly cache = new Map<string, CachedPolishEntry>();
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000;
  private readonly cacheMaxEntries = 500;

  constructor(
    private readonly configService: ConfigService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  async polish(
    candidates: InsightCandidate[],
    options: PolishOptions,
  ): Promise<InsightCandidate[]> {
    if (!this.shouldRun(options) || candidates.length === 0) {
      return this.dropUnverifiedAiSourcedCandidates(candidates);
    }

    const cacheable: InsightCandidate[] = [];
    const outputByHash = new Map<string, CachedPolishResult>();
    for (const candidate of candidates) {
      const cached = this.getCachedPolish(candidate, options.locale);
      if (cached) {
        outputByHash.set(candidate.metadata.facts_hash, {
          output: cached,
          cacheHit: true,
        });
      } else {
        cacheable.push(candidate);
      }
    }

    if (cacheable.length > 0) {
      const output = await this.requestPolish(cacheable, options.locale);
      if (output) {
        for (const insight of output.insights) {
          const candidate = cacheable.find(
            (item) => item.metadata.facts_hash === insight.facts_hash,
          );
          if (!candidate) {
            continue;
          }
          this.setCachedPolish(candidate, options.locale, insight);
          outputByHash.set(insight.facts_hash, {
            output: insight,
            cacheHit: false,
          });
        }
      }
    }

    return candidates
      .map((candidate) =>
        this.applyPolish(
          candidate,
          outputByHash.get(candidate.metadata.facts_hash),
        ),
      )
      .filter((candidate) => this.shouldReturnCandidate(candidate));
  }

  promptVersion(): string {
    return SKIN_JOURNAL_INSIGHT_PROMPT_VERSION;
  }

  private shouldRun(options: PolishOptions): boolean {
    if (!options.aiPolishEnabled) {
      return false;
    }
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    return !!apiKey;
  }

  private async requestPolish(
    candidates: InsightCandidate[],
    locale: string,
  ): Promise<PolishOutput | null> {
    const startedAt = Date.now();
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return null;
    }
    const model = this.currentModel();
    const timeoutMs = SKIN_JOURNAL_INSIGHT_POLISH_TIMEOUT_MS;

    const sourcesByInsight: Record<
      string,
      ReturnType<KnowledgeBaseService['resolveMany']>
    > = {};
    for (const candidate of candidates) {
      sourcesByInsight[candidate.metadata.facts_hash] =
        this.knowledgeBase.resolveMany(candidate.referenced_kb_ids);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            {
              role: 'system',
              content:
                'You polish skincare journal insights into safe localized user-facing copy. Return JSON matching the schema.',
            },
            {
              role: 'user',
              content: buildInsightsPolishPrompt({
                locale,
                candidates,
                sourcesByInsight,
              }),
            },
          ],
          max_output_tokens: 1200,
          text: {
            verbosity: 'low',
            format: OPENAI_RESPONSE_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(
          `Insight polish failed with status ${response.status}`,
        );
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const text = extractOutputText(payload);
      if (!text) {
        return null;
      }
      const parsed = POLISH_RESPONSE_SCHEMA.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.logger.warn('Insight polish response failed schema validation');
        return null;
      }
      this.applyRequestMetadata(candidates, {
        model,
        durationMs: Date.now() - startedAt,
      });
      return parsed.data;
    } catch (error) {
      this.logger.warn(
        `Insight polish failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private applyRequestMetadata(
    candidates: InsightCandidate[],
    metadata: { model: string; durationMs: number },
  ) {
    for (const candidate of candidates) {
      candidate.metadata.model = metadata.model;
      candidate.metadata.prompt_version = this.promptVersion();
      candidate.metadata.duration_ms = metadata.durationMs;
    }
  }

  private applyPolish(
    candidate: InsightCandidate,
    result: CachedPolishResult | undefined,
  ): InsightCandidate {
    if (!result) {
      return candidate;
    }
    const { output } = result;
    const sources = this.knowledgeBase.resolveMany(candidate.referenced_kb_ids);
    const outputText = [
      output.headline_text,
      ...output.text_blocks.map((block) => block.text),
    ].join(' ');
    const validation = validateInsightSourceReferences(
      {
        text: outputText,
        urls: this.extractUrls(outputText),
        organizations: sources
          .filter((source) => outputText.includes(source.organization))
          .map((source) => source.organization),
      },
      sources,
    );
    if (!validation.ok || containsUnsafeInsightLanguage(outputText)) {
      return candidate;
    }

    const blocks = candidate.blocks.map((block, index): InsightBlock => {
      if (block.type !== 'text') {
        return block;
      }
      const polished = output.text_blocks.find((item) => item.index === index);
      return polished ? { ...block, text: polished.text } : block;
    });

    return {
      ...candidate,
      headline: { ...candidate.headline, text: output.headline_text },
      blocks,
      metadata: {
        ...candidate.metadata,
        source:
          candidate.metadata.source === 'ai_sourced'
            ? 'ai_sourced'
            : 'ai_polished',
        cache_hit: result.cacheHit,
      },
    };
  }

  private extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)]+/g);
    return matches ?? [];
  }

  private shouldReturnCandidate(candidate: InsightCandidate): boolean {
    if (candidate.metadata.source !== 'ai_sourced') {
      return true;
    }

    return !!candidate.headline.text;
  }

  private dropUnverifiedAiSourcedCandidates(
    candidates: InsightCandidate[],
  ): InsightCandidate[] {
    return candidates.filter((candidate) =>
      this.shouldReturnCandidate(candidate),
    );
  }

  private getCachedPolish(
    candidate: InsightCandidate,
    locale: string,
  ): PolishResult | null {
    const key = this.cacheKey(candidate, locale);
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.output;
  }

  private setCachedPolish(
    candidate: InsightCandidate,
    locale: string,
    output: PolishResult,
  ): void {
    this.cache.set(this.cacheKey(candidate, locale), {
      output,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    while (this.cache.size > this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  private cacheKey(candidate: InsightCandidate, locale: string): string {
    return JSON.stringify({
      locale,
      factsHash: candidate.metadata.facts_hash,
      model: this.currentModel(),
      promptVersion: this.promptVersion(),
    });
  }

  private currentModel(): string {
    return (
      readFeatureOpenAiModel(
        this.configService,
        INSIGHTS_AI_MODEL_ENV_KEY,
        SKIN_JOURNAL_INSIGHTS_DEFAULT_MODEL,
      ) ?? SKIN_JOURNAL_INSIGHTS_DEFAULT_MODEL
    );
  }
}
