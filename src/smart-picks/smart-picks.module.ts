import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnvironmentIntelligenceModule } from '../environment-intelligence/environment-intelligence.module';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionObservabilityEvent } from '../suggestions/entities/suggestion-observability-event.entity';
import { SuggestionObservabilityService } from '../suggestions/services/suggestion-observability.service';
import { SmartPickProductSuggestion } from './entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from './entities/smart-pick-snapshot.entity';
import { SmartPicksAiGenerator } from './services/smart-picks-ai-generator';
import { SmartPicksContextBuilder } from './services/smart-picks-context-builder';
import { SmartPicksCoverageService } from './services/smart-picks-coverage.service';
import { SmartPicksOverviewService } from './services/smart-picks-overview.service';
import { SmartPicksProductPerformanceService } from './services/smart-picks-product-performance.service';
import { SmartPicksRedundancyService } from './services/smart-picks-redundancy.service';
import { SmartPicksWishlistService } from './services/smart-picks-wishlist.service';
import { SmartPicksController } from './smart-picks.controller';

@Module({
  imports: [
    ConfigModule,
    EnvironmentIntelligenceModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      SmartPickSnapshot,
      SmartPickProductSuggestion,
      SuggestionGapAction,
      SuggestionObservabilityEvent,
      SkinProfile,
      InventoryProduct,
      ApplicationLog,
      SkinJournalEntry,
    ]),
  ],
  providers: [
    SmartPicksAiGenerator,
    SmartPicksContextBuilder,
    SmartPicksCoverageService,
    SmartPicksOverviewService,
    SmartPicksProductPerformanceService,
    SmartPicksRedundancyService,
    SmartPicksWishlistService,
    SuggestionObservabilityService,
  ],
  controllers: [SmartPicksController],
})
export class SmartPicksModule {}
