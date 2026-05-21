import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformGlobalRestrictionsService } from '../../platform-controls/platform-global-restrictions.service';
import { PlatformGlobalRestrictionCapability } from '../../platform-controls/platform-global-restrictions';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SUGGESTION_AI_DAILY_USER_COST_LIMIT_USD,
  SUGGESTION_AI_DAILY_USER_GENERATION_LIMIT,
  SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT,
  SuggestionGenerationStatus,
} from '../suggestions.constants';

export type SuggestionAiUsageBlockReason =
  | 'daily_generation_limit'
  | 'daily_regeneration_limit'
  | 'daily_cost_limit'
  | 'platform_global_restriction';

export interface SuggestionAiUsageDecision {
  allowed: boolean;
  blockedReason: SuggestionAiUsageBlockReason | null;
  generationCountToday: number;
  regenerationCountToday: number;
  estimatedCostTodayUsd: number;
}

interface UsageRawRow {
  generation_count_today?: string | number | null;
  regeneration_count_today?: string | number | null;
  estimated_cost_today_usd?: string | number | null;
}

@Injectable()
export class SuggestionAiUsageGuard {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    private readonly platformRestrictions: PlatformGlobalRestrictionsService,
  ) {}

  async evaluate(
    userId: string,
    now = new Date(),
  ): Promise<SuggestionAiUsageDecision> {
    if (
      await this.platformRestrictions.isCapabilityDisabled(
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
      )
    ) {
      return {
        allowed: false,
        blockedReason: 'platform_global_restriction',
        estimatedCostTodayUsd: 0,
        generationCountToday: 0,
        regenerationCountToday: 0,
      };
    }

    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const row = await this.suggestionRepo
      .createQueryBuilder('suggestion')
      .select('COUNT(*)', 'generation_count_today')
      .addSelect(
        `COUNT(*) FILTER (WHERE suggestion.supersedes_id IS NOT NULL)`,
        'regeneration_count_today',
      )
      .addSelect(
        `COALESCE(SUM(suggestion.ai_estimated_cost_usd), 0)`,
        'estimated_cost_today_usd',
      )
      .where('suggestion.user_id = :userId', { userId })
      .andWhere('suggestion.generated_at >= :start', { start })
      .andWhere('suggestion.generation_status IN (:...statuses)', {
        statuses: [
          SuggestionGenerationStatus.Ready,
          SuggestionGenerationStatus.Superseded,
        ],
      })
      .getRawOne<UsageRawRow>();

    const generationCountToday = toNumber(row?.generation_count_today);
    const regenerationCountToday = toNumber(row?.regeneration_count_today);
    const estimatedCostTodayUsd = toNumber(row?.estimated_cost_today_usd);
    const blockedReason = resolveBlockedReason({
      generationCountToday,
      regenerationCountToday,
      estimatedCostTodayUsd,
    });

    return {
      allowed: blockedReason === null,
      blockedReason,
      generationCountToday,
      regenerationCountToday,
      estimatedCostTodayUsd,
    };
  }

  async evaluateRegeneration(
    userId: string,
    now = new Date(),
  ): Promise<SuggestionAiUsageDecision> {
    return this.evaluate(userId, now);
  }
}

function resolveBlockedReason(params: {
  generationCountToday: number;
  regenerationCountToday: number;
  estimatedCostTodayUsd: number;
}): SuggestionAiUsageBlockReason | null {
  if (
    params.generationCountToday >= SUGGESTION_AI_DAILY_USER_GENERATION_LIMIT
  ) {
    return 'daily_generation_limit';
  }
  if (
    params.regenerationCountToday >= SUGGESTION_AI_DAILY_USER_REGENERATION_LIMIT
  ) {
    return 'daily_regeneration_limit';
  }
  if (params.estimatedCostTodayUsd >= SUGGESTION_AI_DAILY_USER_COST_LIMIT_USD) {
    return 'daily_cost_limit';
  }
  return null;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
