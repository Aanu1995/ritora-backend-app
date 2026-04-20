import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogueController } from './catalogue.controller';
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
    CatalogueSourceRuleService,
    CataloguePhotoStorageService,
    CatalogueService,
    OfficialPageProvider,
    OpenAiExtractorProvider,
  ],
  exports: [CatalogueService],
})
export class CatalogueModule {}
