import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  SMART_PICKS_BUDGET_TIERS,
  SMART_PICKS_MODES,
  SmartPicksBudgetTier,
  SmartPicksMode,
  SmartPicksOverview,
} from '../smart-picks.types';

export class SmartPicksOverviewQueryDto {
  @IsOptional()
  @IsIn(SMART_PICKS_MODES)
  mode?: SmartPicksMode;
}

export class UpdateSmartPicksBudgetDto {
  @ApiProperty({ enum: SMART_PICKS_BUDGET_TIERS })
  @IsIn(SMART_PICKS_BUDGET_TIERS)
  budgetTier: SmartPicksBudgetTier;
}

export class SmartPicksOverviewResponseDto {
  @ApiProperty()
  mode: SmartPicksOverview['mode'];

  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  inputsHash: string;

  @ApiProperty()
  recap: SmartPicksOverview['recap'];

  @ApiProperty()
  coverage: SmartPicksOverview['coverage'];

  @ApiProperty()
  priorityGaps: SmartPicksOverview['priorityGaps'];

  @ApiProperty()
  considerGaps: SmartPicksOverview['considerGaps'];

  @ApiProperty()
  covered: SmartPicksOverview['covered'];

  @ApiProperty()
  redundancy: SmartPicksOverview['redundancy'];

  @ApiProperty()
  consentRequired: boolean;

  @ApiProperty()
  skinProfileRequired: boolean;

  @ApiProperty()
  productSuggestionsUnavailable: boolean;

  @ApiProperty()
  productGeneration: SmartPicksOverview['productGeneration'];

  @ApiProperty()
  emptyState: SmartPicksOverview['emptyState'];

  @ApiProperty()
  starterKit: SmartPicksOverview['starterKit'];

  constructor(init: SmartPicksOverview) {
    Object.assign(this, init);
  }
}
