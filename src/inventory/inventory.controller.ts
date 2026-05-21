import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
  CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD,
  CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
} from '../catalogue/catalogue-photo.constants';
import type { UploadedCatalogueImage } from '../catalogue/catalogue-photo.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { createValidationException } from '../common/validation/validation-exception';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { CreateInventoryProductDto } from './dto/create-inventory-product.dto';
import { InventoryListQueryDto } from './dto/inventory-list-query.dto';
import { InventoryProductResponseDto } from './dto/inventory-product-response.dto';
import { ProductIdListDto } from './dto/product-id-list.dto';
import { UpdateInventoryProductDto } from './dto/update-inventory-product.dto';
import { UploadInventoryProductImageResponseDto } from './dto/upload-inventory-product-image-response.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@Controller('inventory/products')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stats')
  getStats(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone?: string,
  ) {
    return this.inventoryService.getStats(userId, timeZone, requestTimeZone);
  }

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone: string | undefined,
    @Query() query: InventoryListQueryDto,
  ) {
    return this.inventoryService.list(userId, query, timeZone, requestTimeZone);
  }

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.create(userId, dto);
  }

  @Post('with-image')
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableImageUpload,
  )
  @UseGuards(UserRestrictionGuard)
  @UseInterceptors(
    FileInterceptor(CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD, {
      limits: {
        fileSize: CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
        files: 1,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD,
        CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD,
      ],
      properties: {
        [CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD]: {
          type: 'string',
          description: 'JSON encoded CreateInventoryProductDto',
        },
        [CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD]: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  createWithImage(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: UploadedCatalogueImage | undefined,
    @Body(CATALOGUE_PRODUCT_DRAFT_UPLOAD_FIELD) rawProduct: string | undefined,
  ): Promise<InventoryProductResponseDto> {
    if (!file) {
      throw new BadRequestException('Product image is required');
    }

    return this.inventoryService.createWithProductImage(
      userId,
      this.parseMultipartProductDraft(rawProduct),
      file,
    );
  }

  @Post('upload-image')
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableImageUpload,
  )
  @UseGuards(UserRestrictionGuard)
  @UseInterceptors(
    FileInterceptor(CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD, {
      limits: {
        fileSize: CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
        files: 1,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        [CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD]: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadImage(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: UploadedCatalogueImage | undefined,
  ): Promise<UploadInventoryProductImageResponseDto> {
    if (!file) {
      throw new BadRequestException('Product image is required');
    }

    const imageUrl = await this.inventoryService.uploadProductImage(
      userId,
      file,
    );
    return UploadInventoryProductImageResponseDto.fromImageUrl(imageUrl);
  }

  private parseMultipartProductDraft(
    rawProduct: string | undefined,
  ): CreateInventoryProductDto {
    if (!rawProduct) {
      throw new BadRequestException('Product payload is required');
    }

    let parsedProduct: unknown;
    try {
      parsedProduct = JSON.parse(rawProduct) as unknown;
    } catch {
      throw new BadRequestException('Product payload must be valid JSON');
    }

    const dto = plainToInstance(CreateInventoryProductDto, parsedProduct);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      throw createValidationException(errors);
    }

    return dto;
  }

  @Post(':id/upload-image')
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableImageUpload,
  )
  @UseGuards(UserRestrictionGuard)
  @UseInterceptors(
    FileInterceptor(CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD, {
      limits: {
        fileSize: CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
        files: 1,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        [CATALOGUE_PRODUCT_IMAGE_UPLOAD_FIELD]: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadImageToProduct(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @UploadedFile() file: UploadedCatalogueImage | undefined,
  ): Promise<InventoryProductResponseDto> {
    if (!file) {
      throw new BadRequestException('Product image is required');
    }

    return this.inventoryService.uploadAndAttachProductImage(userId, id, file);
  }

  @Post('bulk/archive')
  @HttpCode(HttpStatus.OK)
  async archiveMany(
    @CurrentUser('id') userId: string,
    @Body() dto: ProductIdListDto,
  ): Promise<void> {
    await this.inventoryService.archiveMany(userId, dto.ids);
  }

  @Post('bulk/restore')
  @HttpCode(HttpStatus.OK)
  async restoreMany(
    @CurrentUser('id') userId: string,
    @Body() dto: ProductIdListDto,
  ): Promise<void> {
    await this.inventoryService.restoreMany(userId, dto.ids);
  }

  @Post('bulk/mark-finished')
  @HttpCode(HttpStatus.OK)
  async markFinishedMany(
    @CurrentUser('id') userId: string,
    @Body() dto: ProductIdListDto,
  ): Promise<void> {
    await this.inventoryService.markFinishedMany(userId, dto.ids);
  }

  @Post('bulk-delete')
  @HttpCode(HttpStatus.OK)
  async removeMany(
    @CurrentUser('id') userId: string,
    @Body() dto: ProductIdListDto,
  ): Promise<void> {
    await this.inventoryService.removeMany(userId, dto.ids);
  }

  @Get(':id')
  getOne(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.getOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryProductDto,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.update(userId, id, dto);
  }

  @Post(':id/archive')
  archive(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.archive(userId, id);
  }

  @Post(':id/restore')
  restore(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.restore(userId, id);
  }

  @Post(':id/mark-finished')
  markFinished(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<InventoryProductResponseDto> {
    return this.inventoryService.markFinished(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.inventoryService.remove(userId, id);
  }
}
