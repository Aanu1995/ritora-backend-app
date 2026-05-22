import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { OpenAiExtractorProvider } from '../../catalogue/openai-extractor.provider';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SmartPickProductSuggestion } from '../../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../../smart-picks/entities/smart-pick-snapshot.entity';
import { UserConsentType } from '../../users/user-consent.constants';
import type { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import { AnalysisService } from '../analysis.service';
import { IngredientCatalogService } from '../ingredient-catalog.service';
import {
  AnalysisConfidence,
  type ConflictRule,
  type IngredientDefinition,
  type ProductForAnalysis,
} from '../ingredients.types';
import { MatchingService } from '../matching.service';
import { OpenAiExplanationProvider } from '../openai-explanation.provider';
import { OpenAiProductCheckReviewProvider } from '../openai-product-check-review.provider';
import type { ProductCheckContextService } from '../product-check-context.service';
import { ProductCheckPurchaseGuidanceService } from '../product-check-purchase-guidance.service';
import type { ProductCheckReactionEvidenceService } from '../product-check-reaction-evidence.service';
import {
  ProductCheckContextSignal,
  ProductCheckEvidenceKind,
  ProductCheckPersonalizationLevel,
  type ProductCheckContextSummary,
  type ProductCheckReactionEvidence,
} from '../product-check.types';
import { ProductCheckService } from '../product-check.service';
import { ProductVerdictService } from '../product-verdict.service';
import type { SkinProfileAnalysisContextService } from '../skin-profile-analysis-context.service';
import type { TranslationService } from '../translation.service';

type SeedIngredient = Omit<IngredientDefinition, 'categoryPatterns'> & {
  categoryPatterns?: string[];
};

type SeedConflictRule = Omit<ConflictRule, 'left' | 'right'> & {
  leftCategories?: ConflictRule['left']['categories'];
  leftIngredientSlugs?: ConflictRule['left']['ingredientSlugs'];
  rightCategories?: ConflictRule['right']['categories'];
  rightIngredientSlugs?: ConflictRule['right']['ingredientSlugs'];
};

type SeedPayload = {
  ingredients: SeedIngredient[];
  conflictRules: SeedConflictRule[];
};

export type ProductCheckEvaluationContextCase = {
  skinProfile?: {
    skinType?: string;
    sensitivityLevel?: string;
    reactionTriggers?: string[];
  };
  shelfProducts?: ProductForAnalysis[];
  journalReactionCount?: number;
  suggestionReactionCount?: number;
};

export type ProductCheckEvaluationRuntime = ReturnType<
  typeof createEvaluationRuntime
>;

export function createEvaluationRuntime(configService: ConfigService) {
  const catalog = buildSeedCatalog();
  const matchingService = new MatchingService(catalog);
  const explanationProvider = new OpenAiExplanationProvider(configService);
  const analysisService = new AnalysisService(
    matchingService,
    catalog,
    {
      translateMany: (values: string[]) => Promise.resolve(values),
    } as unknown as TranslationService,
    explanationProvider,
  );

  return {
    analysisService,
    matchingService,
    verdictService: new ProductVerdictService(),
    aiReviewProvider: new OpenAiProductCheckReviewProvider(configService),
    photoExtractorProvider: new OpenAiExtractorProvider(configService),
  };
}

export function buildProductCheckService(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: ProductCheckEvaluationContextCase,
): ProductCheckService {
  const skinProfile = buildSkinProfile(evaluationCase);
  const shelfProducts = (evaluationCase.shelfProducts ?? []).map(
    toInventoryProduct,
  );
  const context = buildContext(evaluationCase, skinProfile);
  const purchaseGuidanceService = new ProductCheckPurchaseGuidanceService(
    {
      find: () => Promise.resolve([]),
    } as unknown as Repository<SmartPickSnapshot>,
    {
      find: () => Promise.resolve([]),
    } as unknown as Repository<SmartPickProductSuggestion>,
    {
      recordDataAccess: () => Promise.resolve(),
    } as unknown as UserDataAccessLogService,
  );

  return new ProductCheckService(
    {
      loadForUser: () => Promise.resolve(skinProfile),
    } as unknown as SkinProfileAnalysisContextService,
    runtime.analysisService,
    runtime.matchingService,
    runtime.verdictService,
    runtime.aiReviewProvider,
    {
      loadForUser: () =>
        Promise.resolve({
          context,
          activeConsentTypes: new Set([
            UserConsentType.SkinProgressProcessing,
            UserConsentType.AiSuggestionProcessing,
          ]),
        }),
    } as unknown as ProductCheckContextService,
    {
      loadForUser: (input: { reactionTriggerIngredients: string[] }) =>
        Promise.resolve(
          buildReactionEvidence(input.reactionTriggerIngredients),
        ),
    } as unknown as ProductCheckReactionEvidenceService,
    purchaseGuidanceService,
    {
      find: () => Promise.resolve(shelfProducts),
    } as unknown as Repository<InventoryProduct>,
  );
}

function buildSkinProfile(
  evaluationCase: ProductCheckEvaluationContextCase,
): SkinProfile | null {
  if (!evaluationCase.skinProfile) return null;
  return Object.assign(new SkinProfile(), {
    skin_type: evaluationCase.skinProfile.skinType ?? null,
    sensitivity_level: evaluationCase.skinProfile.sensitivityLevel ?? null,
    reaction_history: {
      entries: (evaluationCase.skinProfile.reactionTriggers ?? []).map(
        (trigger) => ({ trigger }),
      ),
    },
  });
}

function buildContext(
  evaluationCase: ProductCheckEvaluationContextCase,
  skinProfile: SkinProfile | null,
): ProductCheckContextSummary {
  const usedSignals: ProductCheckContextSignal[] = [];
  if (skinProfile) usedSignals.push(ProductCheckContextSignal.SkinProfile);
  if ((skinProfile?.reaction_history?.entries ?? []).length > 0) {
    usedSignals.push(ProductCheckContextSignal.ReactionHistory);
  }
  if ((evaluationCase.shelfProducts ?? []).length > 0) {
    usedSignals.push(ProductCheckContextSignal.ActiveShelf);
  }
  if ((evaluationCase.journalReactionCount ?? 0) > 0) {
    usedSignals.push(ProductCheckContextSignal.SkinJournal);
  }
  if ((evaluationCase.suggestionReactionCount ?? 0) > 0) {
    usedSignals.push(ProductCheckContextSignal.SuggestionHistory);
  }

  return {
    level:
      usedSignals.length > 0
        ? ProductCheckPersonalizationLevel.Personalized
        : ProductCheckPersonalizationLevel.Educational,
    usedSignals,
    missingSignals: Object.values(ProductCheckContextSignal).filter(
      (signal) => !usedSignals.includes(signal),
    ),
    activeShelfProductCount: evaluationCase.shelfProducts?.length ?? 0,
    recentJournalReactionCount: evaluationCase.journalReactionCount ?? 0,
    recentSuggestionReactionCount: evaluationCase.suggestionReactionCount ?? 0,
  };
}

function buildReactionEvidence(
  reactionTriggerIngredients: string[],
): ProductCheckReactionEvidence[] {
  if (reactionTriggerIngredients.length === 0) return [];
  return [
    {
      kind: ProductCheckEvidenceKind.ProfileReactionTrigger,
      confidence: AnalysisConfidence.High,
      productName: null,
      ingredientNames: reactionTriggerIngredients,
      reactionSignalCount: 0,
      usageDaysLast90: null,
    },
  ];
}

function toInventoryProduct(product: ProductForAnalysis): InventoryProduct {
  return {
    id: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    status: ShelfStatus.Active,
    identity: {
      brand: product.brand,
      name: product.name,
      category: product.category,
      inciIngredients: product.inciIngredients,
    },
  } as InventoryProduct;
}

function buildSeedCatalog(): IngredientCatalogService {
  const seed = readSeedPayload();
  const ingredients = seed.ingredients.map(toIngredientDefinition);
  const rules = seed.conflictRules.map(toConflictRule);
  const bySlug = new Map(ingredients.map((item) => [item.slug, item]));
  const byAlias = new Map<string, IngredientDefinition>();
  const fallbacks: Array<{
    pattern: RegExp;
    ingredient: IngredientDefinition;
  }> = [];

  for (const ingredient of ingredients) {
    for (const alias of ingredient.aliases) byAlias.set(alias, ingredient);
    for (const pattern of ingredient.categoryPatterns) {
      fallbacks.push({ pattern, ingredient });
    }
  }

  return {
    getIngredientBySlug: (slug: string) => bySlug.get(slug),
    getIngredientByAlias: (alias: string) => byAlias.get(alias),
    getCategoryFallbacks: () => fallbacks,
    getConflictRules: () => rules,
    getAllIngredients: () => ingredients,
  } as IngredientCatalogService;
}

function readSeedPayload(): SeedPayload {
  const path = join(__dirname, '..', 'seed', 'ingredients-seed.json');
  return JSON.parse(readFileSync(path, 'utf8')) as SeedPayload;
}

function toIngredientDefinition(seed: SeedIngredient): IngredientDefinition {
  return {
    ...seed,
    categoryPatterns: (seed.categoryPatterns ?? []).map(
      (pattern) => new RegExp(pattern),
    ),
  };
}

function toConflictRule(seed: SeedConflictRule): ConflictRule {
  return {
    code: seed.code,
    severity: seed.severity,
    left: {
      categories: seed.leftCategories,
      ingredientSlugs: seed.leftIngredientSlugs,
    },
    right: {
      categories: seed.rightCategories,
      ingredientSlugs: seed.rightIngredientSlugs,
    },
    descriptionEn: seed.descriptionEn,
    mitigationEn: seed.mitigationEn,
    conditions: seed.conditions,
    onlyWhenVitaminCIsPhSensitive: seed.onlyWhenVitaminCIsPhSensitive,
  };
}
