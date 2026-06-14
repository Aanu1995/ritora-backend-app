import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { RoutineReviewController } from './routine-review.controller';
import { RoutineReviewService } from './routine-review.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApplicationLog,
      InventoryProduct,
      RoutineSimplificationEvent,
      SkinJournalEntry,
      SkinProfile,
    ]),
  ],
  controllers: [RoutineReviewController],
  providers: [RoutineReviewService],
})
export class RoutineReviewModule {}
