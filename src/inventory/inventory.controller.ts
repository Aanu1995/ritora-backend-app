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
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES } from '../catalogue/catalogue-photo.constants';
import type { UploadedCatalogueImage } from '../catalogue/catalogue-photo.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
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
        image: {
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
