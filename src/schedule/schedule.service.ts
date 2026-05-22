import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import {
  resolveDayOfWeekForTimeZone,
  resolveTimeZoneContext,
  type ResolvedTimeZoneContext,
} from '../common/timezone/timezone.utils';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ApplyPresetDto } from './dto/apply-preset.dto';
import { CreateSlotDto } from './dto/create-slot.dto';
import { CreateSlotsDto } from './dto/create-slots.dto';
import { MoveSlotDto } from './dto/move-slot.dto';
import { DayOfWeek } from './dto/schedule.constants';
import { UpdateSlotDto } from './dto/update-slot.dto';
import { UpsertRoutineStepsDto } from './dto/upsert-routine-steps.dto';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { ScheduleSuggestionCoordinator } from './schedule-suggestion-coordinator.service';
import {
  buildEveryDaySlotsInput,
  applySlotUpdatePatch,
  assertUserHasSchedulableProduct,
  buildScheduleSlotData,
  buildSlotInputForDay,
  getMissingDays,
  assertRoutineStepsSchedulable,
  isUniqueConstraintError,
  type NormalizedCreateSlotsInput,
  normalizeCreateSlotsInput,
  normalizeSlotInput,
  replaceRoutineSteps,
} from './schedule.service.utils';
import {
  scheduleMoveConflict,
  scheduleSlotConflict,
  scheduleSlotNotFound,
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
    private readonly suggestionCoordinator: ScheduleSuggestionCoordinator,
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
    await assertUserHasSchedulableProduct(this.productsRepository, userId);
    await assertRoutineStepsSchedulable(
      this.productsRepository,
      userId,
      slotInput.steps,
    );
    await this.assertSlotAvailable(
      userId,
      slotInput.dayOfWeek,
      slotInput.slotTime,
    );

    try {
      const slot = await this.dataSource.transaction(async (manager) => {
        const slotRepository = manager.getRepository(ScheduleSlot);
        const savedSlot = await slotRepository.save(
          slotRepository.create(buildScheduleSlotData(userId, slotInput)),
        );
        await replaceRoutineSteps(
          manager.getRepository(RoutineStep),
          savedSlot.id,
          slotInput.steps,
        );
        return savedSlot;
      });
      return this.loadSlot(userId, slot.id);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw scheduleSlotConflict();
      throw error;
    }
  }

  async createSlots(
    userId: string,
    dto: CreateSlotsDto,
  ): Promise<ScheduleSlot[]> {
    const slotInput = normalizeCreateSlotsInput(dto);
    await assertUserHasSchedulableProduct(this.productsRepository, userId);
    await assertRoutineStepsSchedulable(
      this.productsRepository,
      userId,
      slotInput.steps,
    );
    const existing = await this.findExistingSlotsForTime(
      userId,
      slotInput.daysOfWeek,
      slotInput.slotTime,
    );
    const existingDays = new Set(existing.map((slot) => slot.day_of_week));
    const missingDays = getMissingDays(slotInput.daysOfWeek, existingDays);

    try {
      await this.createMissingSlots(userId, missingDays, slotInput);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw scheduleSlotConflict();
      throw error;
    }

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
    await assertUserHasSchedulableProduct(this.productsRepository, userId);

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

    try {
      await this.slotsRepository.save(slot);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw scheduleSlotConflict();
      throw error;
    }
    const updatedSlot = await this.loadSlot(userId, slot.id);
    await this.suggestionCoordinator.handleSlotChanged(userId, updatedSlot);
    return updatedSlot;
  }

  async deleteSlot(userId: string, slotId: string): Promise<void> {
    const slot = await this.findOwnedSlot(userId, slotId);
    await this.suggestionCoordinator.handleSlotRemoved(userId, slot);
    slot.deleted_at = new Date();
    await this.slotsRepository.save(slot);
  }

  async moveSlot(
    userId: string,
    slotId: string,
    dto: MoveSlotDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);
    await assertUserHasSchedulableProduct(this.productsRepository, userId);
    const toTime = normaliseTime(dto.toTime);

    if (slot.day_of_week === dto.toDay && slot.slot_time === toTime) {
      return this.loadSlot(userId, slot.id);
    }

    const conflict = await this.slotsRepository.findOne({
      where: {
        user_id: userId,
        day_of_week: dto.toDay,
        slot_time: toTime,
        deleted_at: IsNull(),
      },
    });
    if (conflict && conflict.id !== slot.id) {
      throw scheduleMoveConflict();
    }

    slot.day_of_week = dto.toDay;
    slot.slot_time = toTime;
    try {
      await this.slotsRepository.save(slot);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw scheduleMoveConflict();
      throw error;
    }
    const updatedSlot = await this.loadSlot(userId, slot.id);
    await this.suggestionCoordinator.handleSlotChanged(userId, updatedSlot);
    return updatedSlot;
  }

  async upsertSteps(
    userId: string,
    slotId: string,
    dto: UpsertRoutineStepsDto,
  ): Promise<ScheduleSlot> {
    const slot = await this.findOwnedSlot(userId, slotId);
    await assertUserHasSchedulableProduct(this.productsRepository, userId);

    await assertRoutineStepsSchedulable(
      this.productsRepository,
      userId,
      dto.steps,
    );
    await this.replaceSteps(slot.id, dto.steps);

    const updatedSlot = await this.loadSlot(userId, slot.id);
    await this.suggestionCoordinator.handleSlotChanged(userId, updatedSlot);
    return updatedSlot;
  }

  private async findOwnedSlot(
    userId: string,
    slotId: string,
  ): Promise<ScheduleSlot> {
    const slot = await this.slotsRepository.findOne({
      where: { id: slotId, user_id: userId, deleted_at: IsNull() },
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
        deleted_at: IsNull(),
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
      .find(
        this.buildSlotQuery({
          ...where,
          user_id: userId,
          deleted_at: IsNull(),
        }),
      )
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
        deleted_at: IsNull(),
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

      const savedSlots = await repository.save(nextSlots);
      const stepsRepository = manager.getRepository(RoutineStep);
      for (const slot of savedSlots) {
        await replaceRoutineSteps(stepsRepository, slot.id, slotInput.steps);
      }
    });
  }

  private async replaceSteps(
    slotId: string,
    steps: UpsertRoutineStepsDto['steps'],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await replaceRoutineSteps(
        manager.getRepository(RoutineStep),
        slotId,
        steps,
      );
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
        deleted_at: IsNull(),
      },
    });
  }
}
