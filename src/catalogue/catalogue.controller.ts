import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CatalogueService } from './catalogue.service';
import { CatalogueSearchQueryDto } from './dto/catalogue-search-query.dto';
import { CatalogueSuggestionResponseDto } from './dto/catalogue-suggestion-response.dto';
import { ResolveUrlDto } from './dto/resolve-url.dto';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';

const catalogueThrottle = {
  default: {
    ttl: 60000,
    limit: process.env.NODE_ENV === 'test' ? 100 : 30,
  },
};

@ApiTags('catalogue')
@Controller('catalogue/products')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  @Get('search')
  @Throttle(catalogueThrottle)
  @ApiOkResponse({ type: CatalogueSuggestionResponseDto, isArray: true })
  async search(@Query() query: CatalogueSearchQueryDto) {
    return this.catalogueService.search(query);
  }

  @Get('barcode/:barcode')
  @Throttle(catalogueThrottle)
  async resolveBarcode(
    @Param('barcode') barcode: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.catalogueService.resolveBarcode(barcode);
  }

  @Post('resolve-url')
  @Throttle(catalogueThrottle)
  async resolveUrl(
    @Body() dto: ResolveUrlDto,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.catalogueService.resolveUrl(dto.url);
  }
}
