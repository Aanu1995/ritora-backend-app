import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmartPicksModule } from '../smart-picks/smart-picks.module';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UsersModule } from '../users/users.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryProduct } from './entities/inventory-product.entity';

@Module({
  imports: [
    CatalogueModule,
    NotificationsModule,
    SmartPicksModule,
    UsersModule,
    TypeOrmModule.forFeature([InventoryProduct, SkinProfile]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
