import { ApiProperty } from '@nestjs/swagger';
import {
  toDateOnlyString,
  toIsoString,
  toTimeOnlyString,
} from '../../common/utils/date';
import { ProductImageUrlResolverOptions } from '../../inventory/product-image-url-resolver';
import {
  SuggestionGenerationContext,
  SuggestionInstance,
} from '../entities/suggestion-instance.entity';
import { SuggestionProductScore } from '../suggestion-context.types';
import { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import {
  SUGGESTION_DAYPARTS,
  SUGGESTION_GENERATION_STATUSES,
  SUGGESTION_MODES,
  SUGGESTION_REQUEST_SOURCES,
  SuggestionDaypart,
  SuggestionEvidenceSourceJson,
  SuggestionExplanationJson,
  SuggestionGapActionKind,
  SuggestionGapRecommendationResponseJson,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestSource as SuggestionRequestSourceValue,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
  SuggestionSafetyFlagJson,
} from '../suggestions.constants';
import { getSuggestionEvidenceSources } from '../services/suggestion-evidence-sources';
import { applyGapRecommendationActions } from '../services/suggestion-gap-actions';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import { SuggestionStepResponseDto } from './suggestion-step-response.dto';

const INGREDIENT_LIST_MISSING_WARNING = 'ingredient list missing';

export class SuggestionProductDataQualityDto {
  @ApiProperty()
  verifiedCount: number;

  @ApiProperty()
  partialCount: number;

  @ApiProperty()
  insufficientCount: number;

  @ApiProperty({ type: [String] })
  warnings: string[];
}

export class SuggestionInstanceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  slotId: string | null;

  @ApiProperty({ enum: SUGGESTION_REQUEST_SOURCES })
  requestSource: SuggestionRequestSource;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  requestContext: SuggestionRequestContextJson | null;

  @ApiProperty()
  targetDate: string;

  @ApiProperty()
  targetTime: string;

  @ApiProperty({ enum: SUGGESTION_DAYPARTS })
  daypart: SuggestionDaypart;

  @ApiProperty({ enum: SUGGESTION_MODES })
  mode: SuggestionMode;

  @ApiProperty({ enum: SUGGESTION_GENERATION_STATUSES })
  generationStatus: SuggestionGenerationStatus;

  @ApiProperty()
  visibleAt: string;

  @ApiProperty({ nullable: true })
  generatedAt: string | null;

  @ApiProperty({ nullable: true })
  aiModel: string | null;

  @ApiProperty({ nullable: true })
  aiPromptVersion: string | null;

  @ApiProperty()
  hasReactionSignal: boolean;

  @ApiProperty()
  simplifiedForReaction: boolean;

  @ApiProperty({ nullable: true })
  rationaleHeadline: string | null;

  @ApiProperty({ nullable: true })
  explanation: SuggestionExplanationJson | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  gapRecommendations: SuggestionGapRecommendationResponseJson[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  safetyFlags: SuggestionSafetyFlagJson[];

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  inputTrace: SuggestionGenerationContext | null;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  environmentSummary: EnvironmentContextSummary | null;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  evidenceSources: SuggestionEvidenceSourceJson[];

  @ApiProperty({ type: SuggestionProductDataQualityDto })
  productDataQuality: SuggestionProductDataQualityDto;

  @ApiProperty({ type: [SuggestionStepResponseDto] })
  steps: SuggestionStepResponseDto[];

  @ApiProperty({ nullable: true })
  applicationLogId: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromEntity(
    instance: SuggestionInstance,
    options: {
      applicationLogId?: string | null;
      gapActionByKey?: ReadonlyMap<string, SuggestionGapActionKind>;
    } & ProductImageUrlResolverOptions = {},
  ): SuggestionInstanceResponseDto {
    const dto = new SuggestionInstanceResponseDto();
    dto.id = instance.id;
    dto.slotId = instance.slot_id;
    dto.requestSource =
      instance.request_source ?? SuggestionRequestSourceValue.Scheduled;
    dto.requestContext = instance.request_context ?? null;
    dto.targetDate = toDateOnlyString(instance.target_date);
    dto.targetTime = toTimeOnlyString(instance.target_time);
    dto.daypart = instance.daypart;
    dto.mode = instance.mode;
    dto.generationStatus = instance.generation_status;
    dto.visibleAt = toIsoString(instance.visible_at);
    dto.generatedAt = instance.generated_at
      ? toIsoString(instance.generated_at)
      : null;
    dto.aiModel = instance.ai_model;
    dto.aiPromptVersion = instance.ai_prompt_version;
    dto.hasReactionSignal = instance.has_reaction_signal;
    dto.simplifiedForReaction = instance.simplified_for_reaction;
    dto.rationaleHeadline = instance.ai_explanation?.headline ?? null;
    dto.explanation = instance.ai_explanation;
    dto.gapRecommendations = applyGapRecommendationActions(
      instance.gap_recommendations,
      options.gapActionByKey,
    );
    dto.safetyFlags = instance.safety_flags ?? [];
    dto.inputTrace = instance.generation_context ?? null;
    dto.environmentSummary = instance.generation_context?.environment ?? null;
    dto.evidenceSources =
      instance.generation_context?.evidenceSources ??
      getSuggestionEvidenceSources([
        ...(instance.safety_flags ?? []).flatMap(
          (flag) => flag.sourceIds ?? [],
        ),
        ...(instance.gap_recommendations ?? []).flatMap(
          (gap) => gap.sourceIds ?? [],
        ),
      ]);
    dto.productDataQuality = buildProductDataQualityDto(instance);
    dto.steps = (instance.steps ?? [])
      .slice()
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => SuggestionStepResponseDto.fromEntity(step, options));
    dto.applicationLogId = options.applicationLogId ?? null;
    dto.createdAt = toIsoString(instance.created_at);
    dto.updatedAt = toIsoString(instance.updated_at);
    return dto;
  }
}

function buildProductDataQualityDto(
  instance: SuggestionInstance,
): SuggestionProductDataQualityDto {
  const scores = visibleProductScores(instance);
  const liveIngredientAvailability = liveIngredientAvailabilityByProductId(
    instance.steps ?? [],
  );
  const dto = new SuggestionProductDataQualityDto();
  dto.verifiedCount = scores.filter(
    (score) => score.dataQuality === 'verified',
  ).length;
  dto.partialCount = scores.filter(
    (score) => score.dataQuality === 'partial',
  ).length;
  dto.insufficientCount = scores.filter(
    (score) => score.dataQuality === 'insufficient',
  ).length;
  dto.warnings = Array.from(
    new Set(
      scores
        .flatMap((score) =>
          productScopedWarnings(score, liveIngredientAvailability),
        )
        .map((warning) => warning.trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);
  return dto;
}

function visibleProductScores(
  instance: SuggestionInstance,
): SuggestionProductScore[] {
  const scores = instance.generation_context?.productScores ?? [];
  const suggestedProductIds = new Set(
    (instance.steps ?? [])
      .map((step) => step.inventory_product_id)
      .filter((productId): productId is string => Boolean(productId)),
  );
  if (suggestedProductIds.size === 0) return scores;
  return scores.filter((score) => suggestedProductIds.has(score.productId));
}

function liveIngredientAvailabilityByProductId(
  steps: SuggestionStep[],
): ReadonlyMap<string, boolean> {
  const productIngredientsById = new Map<string, boolean>();
  for (const step of steps) {
    const productId = step.inventory_product_id;
    if (!productId || !step.product) continue;
    const hasIngredients = (step.product.identity?.inciIngredients ?? []).some(
      (ingredient) => ingredient.trim().length > 0,
    );
    if (hasIngredients || !productIngredientsById.has(productId)) {
      productIngredientsById.set(productId, hasIngredients);
    }
  }
  return productIngredientsById;
}

function productScopedWarnings(
  score: SuggestionProductScore,
  liveIngredientAvailability: ReadonlyMap<string, boolean>,
): string[] {
  const hasLiveIngredientList =
    liveIngredientAvailability.get(score.productId) === true;
  return (score.dataQualityWarnings ?? [])
    .map((warning) => warning.trim())
    .filter(Boolean)
    .filter(
      (warning) =>
        !(hasLiveIngredientList && warning === INGREDIENT_LIST_MISSING_WARNING),
    )
    .map((warning) => `${productWarningLabel(score)}: ${warning}`);
}

function productWarningLabel(score: SuggestionProductScore): string {
  const label = [score.brand, score.name]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' ');
  return label || score.productId;
}
