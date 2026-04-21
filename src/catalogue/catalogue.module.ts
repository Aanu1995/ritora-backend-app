import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogueController } from './catalogue.controller';
import { CataloguePhotoProcessorService } from './catalogue-photo-processor.service';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { CatalogueService } from './catalogue.service';
import { CatalogueSourceRule } from './entities/catalogue-source-rule.entity';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';

@Module({
  imports: [TypeOrmModule.forFeature([CatalogueSourceRule])],
  controllers: [CatalogueController],
  providers: [
    CataloguePhotoProcessorService,
    CatalogueSourceRuleService,
    CataloguePhotoStorageService,
    CatalogueService,
    OfficialPageProvider,
    OpenAiExtractorProvider,
  ],
  exports: [CataloguePhotoStorageService, CatalogueService],
})
export class CatalogueModule {}
