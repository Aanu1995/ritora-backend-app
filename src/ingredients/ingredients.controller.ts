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
import { normalizeLanguage, resolveRequestLanguage } from '../common/i18n/i18n';
import { AnalyzeProductsDto } from './dto/analyze-products.dto';
import { CheckProductDto } from './dto/check-product.dto';
import { ProductCompareProductsDto } from './dto/compare-products.dto';
import { IngredientsService } from './ingredients.service';
import type { AnalysisResult } from './ingredients.types';
import { ProductCompareService } from './product-compare.service';
import type { ProductCompareResponse } from './product-compare.types';
import { ProductCheckService } from './product-check.service';
import type { ProductCheckResponse } from './product-check.types';

const isTest = process.env.NODE_ENV === 'test';

const analyzeThrottle = {
  default: {
    ttl: 60_000,
    limit: isTest ? 1000 : 20,
  },
};

@ApiTags('ingredients')
@Controller('ingredients')
export class IngredientsController {
  constructor(
    private readonly ingredientsService: IngredientsService,
    private readonly productCheckService: ProductCheckService,
    private readonly productCompareService: ProductCompareService,
  ) {}

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

    return this.ingredientsService.analyzeForUser(userId, dto, language);
  }

  @Post('check-product')
  @HttpCode(HttpStatus.OK)
  @Throttle(analyzeThrottle)
  @ApiOkResponse({ description: 'Ephemeral product check result' })
  checkProduct(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Body() dto: CheckProductDto,
  ): Promise<ProductCheckResponse> {
    const language = dto.language
      ? normalizeLanguage(dto.language)
      : resolveRequestLanguage(request);

    return this.productCheckService.checkForUser(userId, dto, language);
  }

  @Post('compare-products')
  @HttpCode(HttpStatus.OK)
  @Throttle(analyzeThrottle)
  @ApiOkResponse({ description: 'Ephemeral product comparison result' })
  compareProducts(
    @CurrentUser('id') userId: string,
    @Req() request: Request,
    @Body() dto: ProductCompareProductsDto,
  ): Promise<ProductCompareResponse> {
    const language = dto.language
      ? normalizeLanguage(dto.language)
      : resolveRequestLanguage(request);

    return this.productCompareService.compareForUser(userId, dto, language);
  }
}
