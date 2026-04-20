import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogueController } from './catalogue.controller';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { CatalogueService } from './catalogue.service';
import { CatalogueSourceRule } from './entities/catalogue-source-rule.entity';
import { CatalogueProduct } from './entities/catalogue-product.entity';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';
import { OpenBeautyFactsProvider } from './open-beauty-facts.provider';
import { ProductPageDiscoveryProvider } from './product-page-discovery.provider';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogueProduct, CatalogueSourceRule])],
  controllers: [CatalogueController],
  providers: [
    CatalogueSourceRuleService,
    CataloguePhotoStorageService,
    CatalogueService,
    OpenBeautyFactsProvider,
    OfficialPageProvider,
    OpenAiExtractorProvider,
    ProductPageDiscoveryProvider,
  ],
  exports: [CatalogueService],
})
export class CatalogueModule {}
