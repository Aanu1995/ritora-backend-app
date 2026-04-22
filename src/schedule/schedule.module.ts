import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScheduleSlot, RoutineStep, InventoryProduct]),
  ],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
