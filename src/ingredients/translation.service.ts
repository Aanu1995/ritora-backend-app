import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';

const MODEL_ENV_KEY = 'OPENAI_INGREDIENT_EXPLANATION_MODEL';
const SOURCE_LANG_ENV_KEY = 'INGREDIENT_TRANSLATION_SOURCE_LANGUAGE';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_LRU_ENTRIES = 2000;
const MAX_OUTPUT_TOKENS = 220;

type TranslationCacheRow = {
  source_hash: string;
  translated_text: string;
};

/**
 * Runtime translator for ingredient-intelligence strings.
 *
 * The canonical source of truth is the English text stored on
 * ingredient/rule rows. Any other language is produced on demand by the
 * LLM, cached persistently (DB) and in memory (LRU). Failures degrade
 * gracefully to the source.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly lru = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Translate a single string. Returns the source unchanged if the target
   * language is the source language or on any failure.
   */
  async translate(sourceText: string, targetLanguage: string): Promise<string> {
    const target = targetLanguage.toLowerCase();
    const source = this.getSourceLanguage();

    if (target === source || !sourceText.trim()) {
      return sourceText;
    }

    const sourceHash = this.hash(sourceText);
    const lruKey = `${sourceHash}:${target}`;
    const cached = this.lru.get(lruKey);
    if (cached !== undefined) {
      return cached;
    }

    const dbCached = await this.readFromDb(sourceHash, target);
    if (dbCached !== undefined) {
      this.writeLru(lruKey, dbCached);
      return dbCached;
    }

    const translated = await this.callLlm(sourceText, target);
    if (translated === null) {
      return sourceText;
    }

    await this.writeToDb(sourceHash, target, translated);
    this.writeLru(lruKey, translated);
    return translated;
  }

  /**
   * Translate an array of strings in order. Uses cache lookups + batch
   * LLM calls. Same failure semantics as translate().
   */
  async translateMany(
    sourceTexts: string[],
    targetLanguage: string,
  ): Promise<string[]> {
    const target = targetLanguage.toLowerCase();
    const source = this.getSourceLanguage();

    if (target === source) {
      return [...sourceTexts];
    }

    const results = new Array<string>(sourceTexts.length);
    const dbMisses: Array<{ index: number; text: string; sourceHash: string }> =
      [];

    for (let i = 0; i < sourceTexts.length; i += 1) {
      const text = sourceTexts[i];
      if (!text.trim()) {
        results[i] = text;
        continue;
      }
      const sourceHash = this.hash(text);
      const lruKey = `${sourceHash}:${target}`;
      const lruHit = this.lru.get(lruKey);
      if (lruHit !== undefined) {
        results[i] = lruHit;
        continue;
      }

      dbMisses.push({ index: i, text, sourceHash });
    }

    const dbHits =
      dbMisses.length > 0
        ? await this.readManyFromDb(
            dbMisses.map((miss) => miss.sourceHash),
            target,
          )
        : new Map<string, string>();
    const llmMisses: typeof dbMisses = [];

    for (const miss of dbMisses) {
      const translated = dbHits.get(miss.sourceHash);
      if (translated === undefined) {
        llmMisses.push(miss);
        continue;
      }

      this.writeLru(`${miss.sourceHash}:${target}`, translated);
      results[miss.index] = translated;
    }

    if (llmMisses.length > 0) {
      const missesByHash = groupBy(llmMisses, (miss) => miss.sourceHash);
      await Promise.all(
        Array.from(missesByHash.values()).map(async ([firstMiss, ...rest]) => {
          const translated = await this.callLlm(firstMiss.text, target);
          const sameTextMisses = [firstMiss, ...rest];

          if (translated === null) {
            for (const miss of sameTextMisses) {
              results[miss.index] = miss.text;
            }
            return;
          }

          await this.writeToDb(firstMiss.sourceHash, target, translated);
          this.writeLru(`${firstMiss.sourceHash}:${target}`, translated);
          for (const miss of sameTextMisses) {
            results[miss.index] = translated;
          }
        }),
      );
    }

    return results;
  }

  private getSourceLanguage(): string {
    return (
      this.configService.get<string>(SOURCE_LANG_ENV_KEY)?.toLowerCase() || 'en'
    );
  }

  private hash(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  private writeLru(key: string, value: string): void {
    if (this.lru.size >= MAX_LRU_ENTRIES) {
      // JS Maps preserve insertion order — oldest-first eviction.
      const oldest = this.lru.keys().next().value;
      if (oldest !== undefined) {
        this.lru.delete(oldest);
      }
    }
    this.lru.set(key, value);
  }

  private async readFromDb(
    sourceHash: string,
    language: string,
  ): Promise<string | undefined> {
    try {
      const rows = await this.dataSource.query<TranslationCacheRow[]>(
        `SELECT source_hash, translated_text FROM ingredient_translation_cache
         WHERE source_hash = $1 AND language = $2`,
        [sourceHash, language],
      );
      return rows[0]?.translated_text;
    } catch (error) {
      this.logStructured({
        event: 'translation_cache_read_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private async readManyFromDb(
    sourceHashes: string[],
    language: string,
  ): Promise<Map<string, string>> {
    const uniqueHashes = Array.from(new Set(sourceHashes));
    if (uniqueHashes.length === 0) {
      return new Map();
    }

    try {
      const rows = await this.dataSource.query<TranslationCacheRow[]>(
        `SELECT source_hash, translated_text FROM ingredient_translation_cache
         WHERE source_hash = ANY($1) AND language = $2`,
        [uniqueHashes, language],
      );

      return new Map(
        rows.map((row) => [row.source_hash, row.translated_text] as const),
      );
    } catch (error) {
      this.logStructured({
        event: 'translation_cache_read_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return new Map();
    }
  }

  private async writeToDb(
    sourceHash: string,
    language: string,
    translated: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO ingredient_translation_cache
           (source_hash, language, translated_text)
         VALUES ($1,$2,$3)
         ON CONFLICT (source_hash, language) DO UPDATE SET
           translated_text = EXCLUDED.translated_text,
           created_at = now()`,
        [sourceHash, language, translated],
      );
    } catch (error) {
      this.logStructured({
        event: 'translation_cache_write_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async callLlm(
    sourceText: string,
    targetLanguage: string,
  ): Promise<string | null> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logStructured({
        event: 'translation_skipped',
        reason: 'missing_api_key',
      });
      return null;
    }

    const model = this.configService.get<string>(MODEL_ENV_KEY)?.trim();
    if (!model) {
      this.logStructured({
        event: 'translation_skipped',
        reason: 'missing_model_env',
      });
      return null;
    }

    const startedAt = Date.now();

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
          max_output_tokens: MAX_OUTPUT_TOKENS,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: this.systemPrompt(targetLanguage),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    schema: { translation: 'string' },
                    source: sourceText,
                  }),
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        this.logStructured({
          event: 'translation_failed',
          reason: 'http_error',
          status: response.status,
          model,
          durationMs,
        });
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured({
          event: 'translation_failed',
          reason: 'empty_output',
          model,
          durationMs,
        });
        return null;
      }

      const parsed = JSON.parse(extractJsonObject(outputText)) as {
        translation?: unknown;
      };
      if (typeof parsed.translation !== 'string') {
        this.logStructured({
          event: 'translation_failed',
          reason: 'invalid_shape',
          model,
          durationMs,
        });
        return null;
      }

      const trimmed = parsed.translation.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (error) {
      this.logStructured({
        event: 'translation_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
  }

  private systemPrompt(targetLanguage: string): string {
    return `You translate skincare reference text from English to ${targetLanguage}.
- Keep ingredient names (retinol, niacinamide, salicylic acid, etc.) in their original scientific form unless an established local lay name exists.
- Preserve register: calm, professional, non-alarmist, short.
- Do not add new risk information or instructions beyond the source.
- Return only JSON: {"translation": "<translated text>"}`;
  }

  private logStructured(payload: Record<string, unknown>): void {
    this.logger.warn(JSON.stringify(payload));
  }
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
