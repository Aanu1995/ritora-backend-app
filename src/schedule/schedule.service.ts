import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ApplyPresetDto } from './dto/apply-preset.dto';
import { CreateSlotDto } from './dto/create-slot.dto';
import { CreateSlotsDto } from './dto/create-slots.dto';
import { MoveSlotDto } from './dto/move-slot.dto';
import {
  DAYS_OF_WEEK,
  DayOfWeek,
  MAX_STEPS_PER_SLOT,
  SlotMode,
} from './dto/schedule.constants';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import {
  scheduleCustomLabelRequired,
  scheduleMoveConflict,
  scheduleProductsNotOwned,
  scheduleSlotConflict,
  scheduleSlotNotFound,
  scheduleTooManySteps,
} from './schedule.errors';
import {
  compareSlots,
  normaliseTime,
  resolveDayFromTimezone,
  uniqueDays,
} from './schedule.utils';

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(ScheduleSlot)
    private readonly slotsRepository: Repository<ScheduleSlot>,
    @InjectRepository(RoutineStep)
    private readonly stepsRepository: Repository<RoutineStep>,
    @InjectRepository(InventoryProduct)
    private readonly productsRepository: Repository<InventoryProduct>,
    private readonly dataSource: DataSource,
  ) {}

  async getForUser(userId: string): Promise<ScheduleSlot[]> {
    const slots = await this.slotsRepository.find({
      where: { user_id: userId },
      relations: { steps: { product: true } },
    });
    return slots.sort(compareSlots);
  }

  async getTodaysSchedule(
    userId: string,
    day: DayOfWeek,
  ): Promise<ScheduleSlot[]> {
    const slots = await this.slotsRepository.find({
      where: { user_id: userId, day_of_week: day },
      relations: { steps: { product: true } },
    });
    return slots.sort(compareSlots);
  }

  resolveTodayDay(timezoneHeader?: string): DayOfWeek {
    return resolveDayFromTimezone(timezoneHeader);
  }

  async createSlot(userId: string, dto: CreateSlotDto): Promise<ScheduleSlot> {
    const slotTime = normaliseTime(dto.slotTime);
    await this.assertSlotAvailable(userId, dto.dayOfWeek, slotTime);

    const slot = this.slotsRepository.create(
      this.buildSlotData(
        userId,
        dto.dayOfWeek,
        slotTime,
        dto.mode,
        dto.slotNotes,
      ),
    );
    await this.slotsRepository.save(slot);
    return this.loadSlot(userId, slot.id);
  }

  async createSlots(
    userId: string,
    dto: CreateSlotsDto,
  ): Promise<ScheduleSlot[]> {
    const daysOfWeek = uniqueDays(dto.daysOfWeek);
    const slotTime = normaliseTime(dto.slotTime);
    const existing = await this.findExistingSlotsForTime(
      userId,
      daysOfWeek,
      slotTime,
    );
    const existingDays = new Set(existing.map((slot) => slot.day_of_week));
    const missingDays = daysOfWeek.filter((day) => !existingDays.has(day));

    if (missingDays.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ScheduleSlot);
        const nextSlots = missingDays.map((day) =>
          repository.create(
            this.buildSlotData(userId, day, slotTime, dto.mode, dto.slotNotes),
          ),
        );

        await repository.save(nextSlots);
      });
    }

    return this.getForUser(userId);
  }

  async applyEveryDayPreset(
    userId: string,
    dto: ApplyPresetDto,
  ): Promise<ScheduleSlot[]> {
    return this.createSlots(userId, {
      daysOfWeek: [...DAYS_OF_WEEK],
      slotTime: dto.slotTime,
      mode: dto.mode,
      slotNotes: dto.slotNotes,
    });
  }

  async updateSlot(
    userId: string,
    slotId: string,
    dto: UpdateSlotDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);

    if (dto.slotTime !== undefined) {
      const nextTime = normaliseTime(dto.slotTime);
      if (nextTime !== slot.slot_time) {
        await this.assertSlotAvailable(
          userId,
          slot.day_of_week,
          nextTime,
          slot.id,
        );
        slot.slot_time = nextTime;
      }
    }

    if (dto.mode !== undefined) {
      slot.mode = dto.mode;
    }

    if (dto.slotNotes !== undefined) {
      slot.slot_notes = dto.slotNotes ?? null;
    }

    await this.slotsRepository.save(slot);
    return this.loadSlot(userId, slot.id);
  }

  async deleteSlot(userId: string, slotId: string): Promise<void> {
    const slot = await this.findOwnedSlot(userId, slotId);
    await this.slotsRepository.remove(slot);
  }

  async moveSlot(
    userId: string,
    slotId: string,
    dto: MoveSlotDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);
    const toTime = normaliseTime(dto.toTime);

    if (slot.day_of_week === dto.toDay && slot.slot_time === toTime) {
      return this.loadSlot(userId, slot.id);
    }

    const conflict = await this.slotsRepository.findOne({
      where: {
        user_id: userId,
        day_of_week: dto.toDay,
        slot_time: toTime,
      },
    });
    if (conflict && conflict.id !== slot.id) {
      throw scheduleMoveConflict();
    }

    slot.day_of_week = dto.toDay;
    slot.slot_time = toTime;
    await this.slotsRepository.save(slot);
    return this.loadSlot(userId, slot.id);
  }

  async upsertSteps(
    userId: string,
    slotId: string,
    dto: UpsertRoutineStepsDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);

    if (dto.steps.length > MAX_STEPS_PER_SLOT) {
      throw scheduleTooManySteps(MAX_STEPS_PER_SLOT);
    }

    // Validate product ownership for any referenced products.
    const productIds = dto.steps
      .map((s) => s.inventoryProductId)
      .filter((id): id is string => Boolean(id));

    if (productIds.length > 0) {
      const ownedProducts = await this.productsRepository.find({
        where: {
          id: In(productIds),
          user_id: userId,
        },
        select: ['id'],
      });
      const ownedIds = new Set(ownedProducts.map((p) => p.id));
      const foreign = productIds.filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) {
        throw scheduleProductsNotOwned(foreign);
      }
    }

    // Validate custom labels.
    for (const step of dto.steps) {
      if (step.stepLabel === 'custom' && !step.customLabel?.trim()) {
        throw scheduleCustomLabelRequired();
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const stepsRepo = manager.getRepository(RoutineStep);
      await stepsRepo.delete({ slot_id: slot.id });

      const sorted = [...dto.steps].sort((a, b) => a.stepOrder - b.stepOrder);

      for (let i = 0; i < sorted.length; i++) {
        const input = sorted[i];
        const entity = stepsRepo.create({
          slot_id: slot.id,
          step_order: i,
          inventory_product_id: input.inventoryProductId ?? null,
          step_label: input.stepLabel,
          custom_label: input.customLabel ?? null,
          notes: input.notes ?? null,
          optional: input.optional ?? false,
        });
        await stepsRepo.save(entity);
      }
    });

    return this.loadSlot(userId, slot.id);
  }

  private async findOwnedSlot(
    userId: string,
    slotId: string,
  ): Promise<ScheduleSlot> {
    const slot = await this.slotsRepository.findOne({
      where: { id: slotId, user_id: userId },
    });
    if (!slot) {
      throw scheduleSlotNotFound();
    }
    return slot;
  }

  private async loadSlot(
    userId: string,
    slotId: string,
  ): Promise<ScheduleSlot> {
    const slot = await this.slotsRepository.findOne({
      where: { id: slotId, user_id: userId },
      relations: { steps: { product: true } },
    });
    if (!slot) {
      throw scheduleSlotNotFound();
    }
    return slot;
  }

  private async assertSlotAvailable(
    userId: string,
    dayOfWeek: DayOfWeek,
    slotTime: string,
    excludeSlotId?: string,
  ): Promise<void> {
    const conflict = await this.slotsRepository.findOne({
      where: {
        user_id: userId,
        day_of_week: dayOfWeek,
        slot_time: slotTime,
      },
    });

    if (conflict && conflict.id !== excludeSlotId) {
      throw scheduleSlotConflict();
    }
  }

  private buildSlotData(
    userId: string,
    dayOfWeek: DayOfWeek,
    slotTime: string,
    mode?: SlotMode,
    slotNotes?: string | null,
  ) {
    return {
      user_id: userId,
      day_of_week: dayOfWeek,
      slot_time: slotTime,
      mode: mode ?? 'ai',
      slot_notes: slotNotes ?? null,
    };
  }

  private async findExistingSlotsForTime(
    userId: string,
    daysOfWeek: readonly DayOfWeek[],
    slotTime: string,
  ): Promise<ScheduleSlot[]> {
    if (daysOfWeek.length === 0) {
      return [];
    }

    return this.slotsRepository.find({
      where: {
        user_id: userId,
        day_of_week: In([...daysOfWeek]),
        slot_time: slotTime,
      },
    });
  }
}
