import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { CatalogueService } from './catalogue.service';
import { ResolveCandidateDto } from './dto/resolve-candidate.dto';
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

  @Post('extract-from-images')
  @Throttle(catalogueThrottle)
  @UseInterceptors(
    FilesInterceptor(
      'images',
      6,
      {
        limits: {
          fileSize: 10 * 1024 * 1024,
          files: 6,
        },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images', 'heroImageIndex'],
      properties: {
        heroImageIndex: {
          type: 'integer',
          minimum: 0,
        },
        images: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  async extractFromImages(
    @UploadedFiles() files: UploadedCatalogueImage[],
    @Body('heroImageIndex') heroImageIndexValue: string | undefined,
    @Req() request: Request,
  ): Promise<ResolvedLookupResponseDto | null> {
    const publicBaseUrl = `${request.protocol}://${request.get('host')}`;
    const normalizedHeroImageIndex = heroImageIndexValue?.trim() ?? '';
    const heroImageIndex = Number(normalizedHeroImageIndex);

    if (
      !Number.isInteger(heroImageIndex) ||
      normalizedHeroImageIndex !== String(heroImageIndex)
    ) {
      throw new BadRequestException('Invalid heroImageIndex');
    }

    return this.catalogueService.extractFromImages(
      files ?? [],
      heroImageIndex,
      publicBaseUrl,
    );
  }

  @Get('barcode/:barcode')
  @Throttle(catalogueThrottle)
  async resolveBarcode(
    @Param('barcode') barcode: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.catalogueService.resolveBarcodeForScan(barcode);
  }

  @Post('resolve-url')
  @Throttle(catalogueThrottle)
  async resolveUrl(
    @Body() dto: ResolveUrlDto,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.catalogueService.resolveUrl(dto.url);
  }

  @Post('resolve-candidate')
  @Throttle(catalogueThrottle)
  async resolveCandidate(
    @Body() dto: ResolveCandidateDto,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.catalogueService.resolveCandidate(dto);
  }
}
