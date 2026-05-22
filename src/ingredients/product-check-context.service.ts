import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import type { ProductForAnalysis } from './ingredients.types';
import {
  ProductCheckContextSignal,
  ProductCheckPersonalizationLevel,
  type ProductCheckContextSummary,
} from './product-check.types';

const RECENT_CONTEXT_LIMIT = 5;
const PRODUCT_CHECK_CONTEXT_CONSENTS = [
  UserConsentType.SkinProgressProcessing,
  UserConsentType.AiSuggestionProcessing,
] as const;

export type ProductCheckUserContext = {
  context: ProductCheckContextSummary;
  activeConsentTypes: ReadonlySet<UserConsentType>;
};

@Injectable()
export class ProductCheckContextService {
  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly skinJournalEntries: Repository<SkinJournalEntry>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionInstances: Repository<SuggestionInstance>,
    @InjectRepository(UserConsent)
    private readonly consents: Repository<UserConsent>,
    private readonly dataAccessLogService: UserDataAccessLogService,
  ) {}

  async loadForUser(input: {
    userId: string;
    skinProfile: SkinProfile | null;
    activeShelfProducts: ProductForAnalysis[];
  }): Promise<ProductCheckUserContext> {
    const activeConsentTypes = await this.findActiveConsentTypes(input.userId);
    const context = await this.loadContextSummary({
      ...input,
      activeConsentTypes,
    });

    return { context, activeConsentTypes };
  }

  private async loadContextSummary(input: {
    userId: string;
    skinProfile: SkinProfile | null;
    activeShelfProducts: ProductForAnalysis[];
    activeConsentTypes: ReadonlySet<UserConsentType>;
  }): Promise<ProductCheckContextSummary> {
    const [journalEntries, suggestionHistory] = await Promise.all([
      input.activeConsentTypes.has(UserConsentType.SkinProgressProcessing)
        ? this.loadRecentJournalEntries(input.userId)
        : Promise.resolve([]),
      input.activeConsentTypes.has(UserConsentType.AiSuggestionProcessing)
        ? this.loadRecentSuggestionHistory(input.userId)
        : Promise.resolve([]),
    ]);
    const journalReactionCount = journalEntries.filter(
      (entry) => entry.has_reaction_signal,
    ).length;
    const suggestionReactionCount = suggestionHistory.filter(
      (suggestion) =>
        suggestion.has_reaction_signal || suggestion.simplified_for_reaction,
    ).length;

    await this.recordContextAccess({
      userId: input.userId,
      journalEntryCount: journalEntries.length,
      suggestionHistoryCount: suggestionHistory.length,
    });

    const usedSignals = resolveUsedSignals({
      skinProfile: input.skinProfile,
      activeShelfProducts: input.activeShelfProducts,
      journalEntryCount: journalEntries.length,
      suggestionHistoryCount: suggestionHistory.length,
    });

    return {
      level:
        usedSignals.length > 0
          ? ProductCheckPersonalizationLevel.Personalized
          : ProductCheckPersonalizationLevel.Educational,
      usedSignals,
      missingSignals: resolveMissingSignals(usedSignals),
      activeShelfProductCount: input.activeShelfProducts.length,
      recentJournalReactionCount: journalReactionCount,
      recentSuggestionReactionCount: suggestionReactionCount,
    };
  }

  private async recordContextAccess(input: {
    userId: string;
    journalEntryCount: number;
    suggestionHistoryCount: number;
  }): Promise<void> {
    await Promise.all([
      input.journalEntryCount > 0
        ? this.dataAccessLogService.recordDataAccess(
            input.userId,
            [UserConsentType.SkinProgressProcessing],
            UserDataAccessPurpose.SkinJournalRead,
          )
        : Promise.resolve(),
      input.suggestionHistoryCount > 0
        ? this.dataAccessLogService.recordDataAccess(
            input.userId,
            [UserConsentType.AiSuggestionProcessing],
            UserDataAccessPurpose.RecommendationAnalysis,
          )
        : Promise.resolve(),
    ]);
  }

  private async loadRecentJournalEntries(
    userId: string,
  ): Promise<SkinJournalEntry[]> {
    return this.skinJournalEntries.find({
      select: { id: true, has_reaction_signal: true },
      where: { user_id: userId },
      order: { entry_date: 'DESC' },
      take: RECENT_CONTEXT_LIMIT,
    });
  }

  private async loadRecentSuggestionHistory(
    userId: string,
  ): Promise<SuggestionInstance[]> {
    return this.suggestionInstances.find({
      select: {
        id: true,
        has_reaction_signal: true,
        simplified_for_reaction: true,
      },
      where: { user_id: userId },
      order: { target_date: 'DESC' },
      take: RECENT_CONTEXT_LIMIT,
    });
  }

  private async findActiveConsentTypes(
    userId: string,
  ): Promise<Set<UserConsentType>> {
    const consents = await this.consents.find({
      where: {
        user_id: userId,
        consent_type: In([...PRODUCT_CHECK_CONTEXT_CONSENTS]),
        granted: true,
        revoked_at: IsNull(),
      },
    });

    return new Set(consents.map((consent) => consent.consent_type));
  }
}

function resolveUsedSignals(input: {
  skinProfile: SkinProfile | null;
  activeShelfProducts: ProductForAnalysis[];
  journalEntryCount: number;
  suggestionHistoryCount: number;
}): ProductCheckContextSignal[] {
  const signals: ProductCheckContextSignal[] = [];

  if (input.skinProfile) {
    signals.push(ProductCheckContextSignal.SkinProfile);
  }

  if ((input.skinProfile?.reaction_history?.entries ?? []).length > 0) {
    signals.push(ProductCheckContextSignal.ReactionHistory);
  }

  if (input.activeShelfProducts.length > 0) {
    signals.push(ProductCheckContextSignal.ActiveShelf);
  }

  if (input.journalEntryCount > 0) {
    signals.push(ProductCheckContextSignal.SkinJournal);
  }

  if (input.suggestionHistoryCount > 0) {
    signals.push(ProductCheckContextSignal.SuggestionHistory);
  }

  return signals;
}

function resolveMissingSignals(
  usedSignals: ProductCheckContextSignal[],
): ProductCheckContextSignal[] {
  const used = new Set(usedSignals);
  return Object.values(ProductCheckContextSignal).filter(
    (signal) => !used.has(signal),
  );
}
