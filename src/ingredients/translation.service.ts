import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { translateWithOpenAi } from './translation-llm';

const SOURCE_LANG_ENV_KEY = 'INGREDIENT_TRANSLATION_SOURCE_LANGUAGE';
const MAX_LRU_ENTRIES = 2000;
const TRANSLATION_BATCH_SIZE = 20;
const TRANSLATION_CONCURRENCY = 2;

type TranslationCacheRow = {
  source_hash: string;
  translated_text: string;
};

type TranslationMiss = {
  index: number;
  text: string;
  sourceHash: string;
};

type TranslationGroup = {
  sourceHash: string;
  text: string;
  misses: TranslationMiss[];
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

    const translated = await translateWithOpenAi(
      this.configService,
      [sourceText],
      target,
      (payload) => this.logStructured(payload),
    );
    const firstTranslation = translated?.[0];
    if (!firstTranslation) {
      return sourceText;
    }

    await this.writeToDb(sourceHash, target, firstTranslation);
    this.writeLru(lruKey, firstTranslation);
    return firstTranslation;
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
      const groups: TranslationGroup[] = Array.from(missesByHash.entries()).map(
        ([sourceHash, misses]) => ({
          sourceHash,
          text: misses[0].text,
          misses,
        }),
      );
      const chunks = chunkArray(groups, TRANSLATION_BATCH_SIZE);

      await runWithConcurrency(
        chunks,
        TRANSLATION_CONCURRENCY,
        async (chunk) => {
          const translated = await translateWithOpenAi(
            this.configService,
            chunk.map((group) => group.text),
            target,
            (payload) => this.logStructured(payload),
          );

          if (!translated || translated.length !== chunk.length) {
            for (const group of chunk) {
              this.applyTranslationFallback(results, group);
            }
            return;
          }

          await Promise.all(
            chunk.map(async (group, index) => {
              const value = translated[index].trim();
              if (!value) {
                this.applyTranslationFallback(results, group);
                return;
              }

              await this.writeToDb(group.sourceHash, target, value);
              this.writeLru(`${group.sourceHash}:${target}`, value);
              for (const miss of group.misses) {
                results[miss.index] = value;
              }
            }),
          );
        },
      );
    }

    return results;
  }

  private applyTranslationFallback(
    results: string[],
    group: TranslationGroup,
  ): void {
    for (const miss of group.misses) {
      results[miss.index] = miss.text;
    }
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

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await task(items[currentIndex]);
      }
    }),
  );
}
