import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  normalizeLanguage,
  resolveRequestLanguage,
} from '../common/i18n/i18n';
import { AnalyzeProductsDto } from './dto/analyze-products.dto';
import { IngredientsService } from './ingredients.service';
import type { AnalysisResult } from './ingredients.types';

const isTest = process.env.NODE_ENV === 'test';

/**
 * `/ingredients/analyze` is the only endpoint. It runs in two modes:
 *   - Focus: `{ focusProductId }` → educational `actives[]` payload for the
 *     product-detail Ingredients tab.
 *   - Multi: `{ productIds }` → full conflict/overlap/layering analysis for
 *     the set of products in a routine. This is the primitive that future
 *     Today's Suggestion will use.
 *
 * The old `GET /ingredients/shelf-summary` endpoint is intentionally
 * removed — it modelled "all shelf products used together," which is never
 * actually true.
 */
const analyzeThrottle = {
  default: {
    ttl: 60_000,
    limit: isTest ? 1000 : 20,
  },
};

@ApiTags('ingredients')
@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @Throttle(analyzeThrottle)
  @ApiOkResponse({ description: 'Ingredient analysis result' })
  analyze(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Body() dto: AnalyzeProductsDto,
  ): Promise<AnalysisResult> {
    const language = dto.language
      ? normalizeLanguage(dto.language)
      : resolveRequestLanguage(request);

    return this.ingredientsService.analyzeForUser(
      userId,
      dto,
      language,
    );
  }
}
