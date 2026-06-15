import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { RoutineMemoryController } from './routine-memory.controller';
import { RoutineMemoryService } from './routine-memory.service';

@Module({
  imports: [
    CatalogueModule,
    TypeOrmModule.forFeature([
      ApplicationLog,
      InventoryProduct,
      RoutineSimplificationEvent,
      SkinJournalEntry,
    ]),
  ],
  controllers: [RoutineMemoryController],
  providers: [RoutineMemoryService],
  exports: [RoutineMemoryService],
})
export class RoutineMemoryModule {}
