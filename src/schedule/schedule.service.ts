import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Not, Repository } from 'typeorm';
import {
  resolveDayOfWeekForTimeZone,
  resolveTimeZoneContext,
  type ResolvedTimeZoneContext,
} from '../common/timezone/timezone.utils';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../shelf/shelf.types';
import { ApplyPresetDto } from './dto/apply-preset.dto';
import { CreateSlotDto } from './dto/create-slot.dto';
import { CreateSlotsDto } from './dto/create-slots.dto';
import { MoveSlotDto } from './dto/move-slot.dto';
import { DayOfWeek, MAX_STEPS_PER_SLOT } from './dto/schedule.constants';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import {
  buildEveryDaySlotsInput,
  applySlotUpdatePatch,
  buildRoutineStepWriteData,
  buildScheduleSlotData,
  buildSlotInputForDay,
  collectReferencedProductIds,
  getMissingDays,
  hasMissingCustomLabel,
  type NormalizedCreateSlotsInput,
  normalizeCreateSlotsInput,
  normalizeSlotInput,
} from './schedule.service.utils';
import {
  scheduleCustomLabelRequired,
  scheduleMoveConflict,
  scheduleProductsNotOwned,
  scheduleRequiresProduct,
  scheduleSlotConflict,
  scheduleSlotNotFound,
  scheduleTooManySteps,
} from './schedule.errors';
import { compareSlots, normaliseTime } from './schedule.utils';

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
    return this.findSlotsForUser(userId);
  }

  async getTodaysSchedule(
    userId: string,
    day: DayOfWeek,
  ): Promise<ScheduleSlot[]> {
    return this.findSlotsForUser(userId, { day_of_week: day });
  }

  resolveEffectiveTimeZone(
    savedTimeZone?: string | null,
    requestTimeZone?: string,
  ): string {
    return this.resolveTimeZoneContext(savedTimeZone, requestTimeZone).timeZone;
  }

  resolveTimeZoneContext(
    savedTimeZone?: string | null,
    requestTimeZone?: string,
  ): ResolvedTimeZoneContext {
    return resolveTimeZoneContext(savedTimeZone, requestTimeZone);
  }

  resolveTodayDay(
    savedTimeZone?: string | null,
    requestTimeZone?: string,
  ): DayOfWeek {
    return resolveDayOfWeekForTimeZone(
      this.resolveTimeZoneContext(savedTimeZone, requestTimeZone).timeZone,
    );
  }

  async createSlot(userId: string, dto: CreateSlotDto): Promise<ScheduleSlot> {
    const slotInput = normalizeSlotInput(dto);
    await this.assertUserHasSchedulableProduct(userId);
    await this.assertSlotAvailable(
      userId,
      slotInput.dayOfWeek,
      slotInput.slotTime,
    );

    const slot = this.slotsRepository.create(
      buildScheduleSlotData(userId, slotInput),
    );
    await this.slotsRepository.save(slot);
    return this.loadSlot(userId, slot.id);
  }

  async createSlots(
    userId: string,
    dto: CreateSlotsDto,
  ): Promise<ScheduleSlot[]> {
    const slotInput = normalizeCreateSlotsInput(dto);
    await this.assertUserHasSchedulableProduct(userId);
    const existing = await this.findExistingSlotsForTime(
      userId,
      slotInput.daysOfWeek,
      slotInput.slotTime,
    );
    const existingDays = new Set(existing.map((slot) => slot.day_of_week));
    const missingDays = getMissingDays(slotInput.daysOfWeek, existingDays);

    await this.createMissingSlots(userId, missingDays, slotInput);

    return this.getForUser(userId);
  }

  async applyEveryDayPreset(
    userId: string,
    dto: ApplyPresetDto,
  ): Promise<ScheduleSlot[]> {
    return this.createSlots(userId, buildEveryDaySlotsInput(dto));
  }

  async updateSlot(
    userId: string,
    slotId: string,
    dto: UpdateSlotDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);
    await this.assertUserHasSchedulableProduct(userId);

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

    applySlotUpdatePatch(slot, dto);

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
    await this.assertUserHasSchedulableProduct(userId);
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
    await this.assertUserHasSchedulableProduct(userId);

    if (dto.steps.length > MAX_STEPS_PER_SLOT) {
      throw scheduleTooManySteps(MAX_STEPS_PER_SLOT);
    }

    await this.assertProductsOwned(userId, dto.steps);
    this.assertCustomLabels(dto.steps);
    await this.replaceSteps(slot.id, dto.steps);

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
    const slot = await this.slotsRepository.findOne(
      this.buildSlotQuery({
        id: slotId,
        user_id: userId,
      }),
    );
    if (!slot) {
      throw scheduleSlotNotFound();
    }
    return slot;
  }

  private findSlotsForUser(
    userId: string,
    where: FindOptionsWhere<ScheduleSlot> = {},
  ): Promise<ScheduleSlot[]> {
    return this.slotsRepository
      .find(this.buildSlotQuery({ user_id: userId, ...where }))
      .then((slots) => slots.sort(compareSlots));
  }

  private buildSlotQuery(where: FindOptionsWhere<ScheduleSlot>) {
    return {
      where,
      relations: { steps: { product: true } },
    } as const;
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

  private async createMissingSlots(
    userId: string,
    missingDays: readonly DayOfWeek[],
    slotInput: NormalizedCreateSlotsInput,
  ): Promise<void> {
    if (missingDays.length === 0) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ScheduleSlot);
      const nextSlots = missingDays.map((dayOfWeek) =>
        repository.create(
          buildScheduleSlotData(
            userId,
            buildSlotInputForDay(dayOfWeek, slotInput),
          ),
        ),
      );

      await repository.save(nextSlots);
    });
  }

  private async assertUserHasSchedulableProduct(userId: string): Promise<void> {
    const productCount = await this.productsRepository.count({
      where: {
        user_id: userId,
        status: Not(ShelfStatus.Archived),
      },
    });

    if (productCount === 0) {
      throw scheduleRequiresProduct();
    }
  }

  private async assertProductsOwned(
    userId: string,
    steps: UpsertRoutineStepsDto['steps'],
  ): Promise<void> {
    const referencedProductIds = collectReferencedProductIds(steps);

    if (referencedProductIds.length === 0) {
      return;
    }

    const ownedProducts = await this.productsRepository.find({
      where: {
        id: In(referencedProductIds),
        user_id: userId,
      },
      select: ['id'],
    });
    const ownedIds = new Set(ownedProducts.map((product) => product.id));
    const foreignProductIds = referencedProductIds.filter(
      (productId) => !ownedIds.has(productId),
    );

    if (foreignProductIds.length > 0) {
      throw scheduleProductsNotOwned(foreignProductIds);
    }
  }

  private assertCustomLabels(steps: UpsertRoutineStepsDto['steps']): void {
    if (hasMissingCustomLabel(steps)) {
      throw scheduleCustomLabelRequired();
    }
  }

  private async replaceSteps(
    slotId: string,
    steps: UpsertRoutineStepsDto['steps'],
  ): Promise<void> {
    const stepWriteData = buildRoutineStepWriteData(slotId, steps);

    await this.dataSource.transaction(async (manager) => {
      const stepsRepository = manager.getRepository(RoutineStep);
      await stepsRepository.delete({ slot_id: slotId });

      if (stepWriteData.length === 0) {
        return;
      }

      const stepEntities = stepWriteData.map((step) =>
        stepsRepository.create(step),
      );

      await stepsRepository.save(stepEntities);
    });
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
