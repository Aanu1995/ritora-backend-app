import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThan, type FindManyOptions } from 'typeorm';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import { TimedMemoryCache } from '../catalogue/catalogue-memory-cache';
import { hashStableValue } from '../catalogue/catalogue-cache-key.utils';
import {
  INGREDIENT_ANALYSIS_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';
import {
  cleanClassificationTokens,
  INGREDIENT_CLASSIFICATION_CONTRACT_VERSION,
  INGREDIENT_CLASSIFICATION_REQUEST_CATEGORY_VALUES,
  INGREDIENT_CLASSIFICATION_REQUEST_SEVERITY_VALUES,
  INGREDIENT_CLASSIFICATION_RESPONSE_FORMAT,
  INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY,
  ingredientClassificationSystemPrompt,
  sanitizeClassifications,
  type ParsedIngredientClassificationResponse,
} from './ingredient-classifier-contract';
import type {
  IngredientClassification,
  IngredientClassifierInput,
  IngredientClassifierPort,
} from './ingredient-classifier.port';
import { IngredientAiClassificationCacheEntry } from './entities/ingredient-ai-classification-cache-entry.entity';
import {
  IngredientAnalysisAiMetricOperation,
  IngredientAnalysisAiMetricStatus,
  type IngredientAnalysisAiUsage,
  normalizeIngredientAnalysisAiUsage,
  recordIngredientAnalysisAiUsageMetric,
} from './ingredient-analysis-ai-usage-metrics';

export const OPENAI_INGREDIENT_CLASSIFIER_REQUEST_TIMEOUT_MS = 60_000;
export const MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST = 50;

const DEFAULT_MODEL = 'gpt-5-mini';
const MEMORY_CLASSIFICATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STORED_CLASSIFICATION_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CLASSIFICATION_CACHE_MAX_ENTRIES = 1000;

type CacheHitQueryBuilder = {
  update(
    entity: typeof IngredientAiClassificationCacheEntry,
  ): CacheHitQueryBuilder;
  set(values: {
    hit_count?: () => string;
    last_used_at?: () => string;
    updated_at?: () => string;
  }): CacheHitQueryBuilder;
  where(
    query: string,
    parameters: { cacheKeys: string[] },
  ): CacheHitQueryBuilder;
  execute(): Promise<unknown>;
};

type IngredientClassificationCacheRepository = {
  find(
    options: FindManyOptions<IngredientAiClassificationCacheEntry>,
  ): Promise<IngredientAiClassificationCacheEntry[]>;
  create(
    entry: Partial<IngredientAiClassificationCacheEntry>,
  ): IngredientAiClassificationCacheEntry;
  upsert(
    entries: IngredientAiClassificationCacheEntry[],
    conflictPaths: string[],
  ): Promise<unknown>;
  createQueryBuilder(): CacheHitQueryBuilder;
};

@Injectable()
export class OpenAiIngredientClassifierProvider implements IngredientClassifierPort {
  private readonly logger = new Logger(OpenAiIngredientClassifierProvider.name);
  private readonly cache = new TimedMemoryCache<IngredientClassification[]>({
    ttlMs: MEMORY_CLASSIFICATION_CACHE_TTL_MS,
    maxEntries: CLASSIFICATION_CACHE_MAX_ENTRIES,
    shouldCacheValue: (value) => value.length > 0,
  });
  private hasWarnedMissingApiKey = false;
  private hasWarnedMetricWriteFailure = false;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectRepository(IngredientAiClassificationCacheEntry)
    private readonly cacheRepository?: IngredientClassificationCacheRepository,
    @Optional()
    private readonly dataSource?: DataSource,
  ) {}

  warnIfMisconfigured(): void {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logger.warn(
        `OPENAI_API_KEY is not set. Ingredient analysis will return insufficient data for ingredients that require AI classification.`,
      );
    }
  }

  async classify(
    input: IngredientClassifierInput,
  ): Promise<IngredientClassification[]> {
    const tokens = cleanClassificationTokens(input.tokens);
    if (tokens.length === 0) {
      return [];
    }

    const model = this.readModel();
    const cachedClassifications = await this.readCachedClassifications(
      tokens,
      model,
    );
    const missingTokens = tokens.filter(
      (token) => !cachedClassifications.has(normalizeTokenKey(token)),
    );

    if (missingTokens.length === 0) {
      return classificationsInRequestOrder(tokens, cachedClassifications);
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      if (!this.hasWarnedMissingApiKey) {
        this.logStructured('warn', {
          event: 'ingredient_classification_skipped',
          reason: 'missing_api_key',
          cachedTokenCount: cachedClassifications.size,
          missingTokenCount: missingTokens.length,
        });
        this.hasWarnedMissingApiKey = true;
      }
      return classificationsInRequestOrder(tokens, cachedClassifications);
    }

    const fetchedClassifications = await this.classifyMissingTokens({
      apiKey,
      model,
      tracking: input.tracking,
      tokens: missingTokens,
    });
    await this.writeClassificationsToCache(fetchedClassifications, model);

    const mergedClassifications = new Map(cachedClassifications);
    for (const classification of fetchedClassifications) {
      mergedClassifications.set(
        normalizeTokenKey(classification.rawToken),
        classification,
      );
    }

    return classificationsInRequestOrder(tokens, mergedClassifications);
  }

  private async classifyMissingTokens(input: {
    apiKey: string;
    model: string;
    tracking?: IngredientClassifierInput['tracking'];
    tokens: string[];
  }): Promise<IngredientClassification[]> {
    const chunkClassifications = await Promise.all(
      chunkTokens(
        input.tokens,
        MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST,
      ).map((chunk) => {
        const cacheKey = hashStableValue('ingredient-analysis-classifier:v2', {
          contractVersion: INGREDIENT_CLASSIFICATION_CONTRACT_VERSION,
          model: input.model,
          tokens: chunk,
        });
        return this.cache.getOrCreate(cacheKey, () =>
          this.classifyWithOpenAi({ ...input, tokens: chunk }),
        );
      }),
    );

    return chunkClassifications.flat();
  }

  private async readCachedClassifications(
    tokens: string[],
    model: string,
  ): Promise<Map<string, IngredientClassification>> {
    if (!this.cacheRepository) {
      return new Map();
    }

    const cacheKeysByToken = new Map(
      tokens.map((token) => [token, cacheKeyForToken(token, model)]),
    );
    const cacheKeys = Array.from(cacheKeysByToken.values());
    if (cacheKeys.length === 0) {
      return new Map();
    }

    try {
      const rows = await this.cacheRepository.find({
        where: {
          cache_key: In(cacheKeys),
          expires_at: MoreThan(new Date()),
        },
      });
      const classifications = new Map<string, IngredientClassification>();

      for (const row of rows) {
        const requestedToken =
          tokenForCacheKey(cacheKeysByToken, row.cache_key) ??
          row.classification.rawToken ??
          row.normalized_token;
        if (!requestedToken) {
          continue;
        }

        classifications.set(
          normalizeTokenKey(requestedToken),
          hydrateCachedClassification(row, requestedToken),
        );
      }

      await this.markCacheHits(rows.map((row) => row.cache_key));
      return classifications;
    } catch (error) {
      this.logStructured('warn', {
        event: 'ingredient_classification_cache_read_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return new Map();
    }
  }

  private async markCacheHits(cacheKeys: string[]): Promise<void> {
    if (!this.cacheRepository || cacheKeys.length === 0) {
      return;
    }

    try {
      await this.cacheRepository
        .createQueryBuilder()
        .update(IngredientAiClassificationCacheEntry)
        .set({
          hit_count: () => '"hit_count" + 1',
          last_used_at: () => 'now()',
          updated_at: () => 'now()',
        })
        .where('cache_key IN (:...cacheKeys)', { cacheKeys })
        .execute();
    } catch (error) {
      this.logStructured('warn', {
        event: 'ingredient_classification_cache_hit_update_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async writeClassificationsToCache(
    classifications: IngredientClassification[],
    model: string,
  ): Promise<void> {
    const repository = this.cacheRepository;
    if (!repository || classifications.length === 0) {
      return;
    }

    const expiresAt = new Date(Date.now() + STORED_CLASSIFICATION_CACHE_TTL_MS);
    const entries = classifications.map((classification) => {
      const normalizedToken = normalizeTokenKey(classification.rawToken);
      return repository.create({
        cache_key: cacheKeyForToken(classification.rawToken, model),
        normalized_token: normalizedToken.slice(0, 120),
        normalized_token_hash: tokenHash(normalizedToken),
        model,
        contract_version: INGREDIENT_CLASSIFICATION_CONTRACT_VERSION,
        classification,
        confidence: classification.confidence.toFixed(3),
        category: classification.category,
        overlap_severity: classification.overlapSeverity,
        expires_at: expiresAt,
        last_used_at: null,
      });
    });

    try {
      await repository.upsert(entries, ['cache_key']);
    } catch (error) {
      this.logStructured('warn', {
        event: 'ingredient_classification_cache_write_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async classifyWithOpenAi(input: {
    apiKey: string;
    model: string;
    tracking?: IngredientClassifierInput['tracking'];
    tokens: string[];
  }): Promise<IngredientClassification[]> {
    const startedAt = Date.now();

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          store: false,
          max_output_tokens: 1800,
          ...openAiRepeatabilityRequestOptions(input.model),
          text: {
            verbosity: 'low',
            format: INGREDIENT_CLASSIFICATION_RESPONSE_FORMAT,
          },
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: ingredientClassificationSystemPrompt(),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    tokens: input.tokens,
                    allowedCategories:
                      INGREDIENT_CLASSIFICATION_REQUEST_CATEGORY_VALUES,
                    unknownCategory: INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY,
                    severityValues:
                      INGREDIENT_CLASSIFICATION_REQUEST_SEVERITY_VALUES,
                  }),
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(
          OPENAI_INGREDIENT_CLASSIFIER_REQUEST_TIMEOUT_MS,
        ),
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        this.logStructured('warn', {
          event: 'ingredient_classification_failed',
          reason: 'http_error',
          status: response.status,
          model: input.model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model: input.model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage: null,
        });
        return [];
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const usage = normalizeIngredientAnalysisAiUsage(payload.usage);
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured('warn', {
          event: 'ingredient_classification_failed',
          reason: 'empty_output',
          model: input.model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model: input.model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage,
        });
        return [];
      }

      let parsed: ParsedIngredientClassificationResponse;
      try {
        parsed = JSON.parse(
          extractJsonObject(outputText),
        ) as ParsedIngredientClassificationResponse;
      } catch (error) {
        this.logStructured('warn', {
          event: 'ingredient_classification_failed',
          reason: 'invalid_output',
          message: error instanceof Error ? error.message : 'Unknown error',
          model: input.model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model: input.model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage,
        });
        return [];
      }

      const classifications = sanitizeClassifications({
        parsed: parsed.classifications,
        requestedTokens: input.tokens,
      });
      await this.recordMetric({
        durationMs,
        model: input.model,
        status: IngredientAnalysisAiMetricStatus.Completed,
        tracking: input.tracking,
        usage,
      });

      this.logger.log(
        JSON.stringify({
          event: 'ingredient_classification_completed',
          model: input.model,
          durationMs,
          requestedTokenCount: input.tokens.length,
          classifiedTokenCount: classifications.length,
        }),
      );

      return classifications;
    } catch (error) {
      this.logStructured('warn', {
        event: 'ingredient_classification_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model: input.model,
        durationMs: Date.now() - startedAt,
      });
      await this.recordMetric({
        durationMs: Date.now() - startedAt,
        model: input.model,
        status: IngredientAnalysisAiMetricStatus.Failed,
        tracking: input.tracking,
        usage: null,
      });
      return [];
    }
  }

  private async recordMetric(input: {
    durationMs: number;
    model: string;
    status: IngredientAnalysisAiMetricStatus;
    tracking?: IngredientClassifierInput['tracking'];
    usage: IngredientAnalysisAiUsage | null;
  }): Promise<void> {
    const recorded = await recordIngredientAnalysisAiUsageMetric(
      this.dataSource,
      this.logger,
      {
        durationMs: input.durationMs,
        model: input.model,
        operation: IngredientAnalysisAiMetricOperation.Classification,
        status: input.status,
        tracking: input.tracking,
        usage: input.usage,
      },
      { logFailure: !this.hasWarnedMetricWriteFailure },
    );
    if (!recorded) {
      this.hasWarnedMetricWriteFailure = true;
    }
  }

  private readModel(): string {
    return (
      readFeatureOpenAiModel(
        this.configService,
        INGREDIENT_ANALYSIS_AI_MODEL_ENV_KEY,
        DEFAULT_MODEL,
      ) ?? DEFAULT_MODEL
    );
  }

  private logStructured(
    level: 'warn' | 'error',
    payload: Record<string, unknown>,
  ): void {
    const message = JSON.stringify(payload);
    if (level === 'error') {
      this.logger.error(message);
    } else {
      this.logger.warn(message);
    }
  }
}

function chunkTokens(tokens: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < tokens.length; index += size) {
    chunks.push(tokens.slice(index, index + size));
  }

  return chunks;
}

function classificationsInRequestOrder(
  tokens: string[],
  classifications: ReadonlyMap<string, IngredientClassification>,
): IngredientClassification[] {
  return tokens.flatMap((token) => {
    const classification = classifications.get(normalizeTokenKey(token));
    return classification ? [classification] : [];
  });
}

function hydrateCachedClassification(
  row: IngredientAiClassificationCacheEntry,
  requestedToken: string,
): IngredientClassification {
  return {
    ...row.classification,
    rawToken: requestedToken,
  };
}

function tokenForCacheKey(
  cacheKeysByToken: ReadonlyMap<string, string>,
  cacheKey: string,
): string | null {
  for (const [token, candidateCacheKey] of cacheKeysByToken) {
    if (candidateCacheKey === cacheKey) {
      return token;
    }
  }

  return null;
}

function cacheKeyForToken(token: string, model: string): string {
  return hashStableValue('ingredient-classification-cache:v1', {
    contractVersion: INGREDIENT_CLASSIFICATION_CONTRACT_VERSION,
    model,
    normalizedToken: normalizeTokenKey(token),
  });
}

function tokenHash(normalizedToken: string): string {
  return hashStableValue('ingredient-normalized-token:v1', normalizedToken);
}

function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
