import { DataSource, Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleService } from './schedule.service';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import type { DayOfWeek, SlotMode, StepLabel } from './dto/schedule.constants';

type MockRepo<T> = {
  create: jest.Mock<T, [Partial<T>]>;
  delete: jest.Mock<Promise<void>, [unknown]>;
  find: jest.Mock<Promise<T[]>, [unknown?]>;
  findOne: jest.Mock<Promise<T | null>, [unknown?]>;
  remove: jest.Mock<Promise<void>, [T]>;
  save: jest.Mock<Promise<T | T[]>, [T | T[]]>;
};

function createRepo<T>(): MockRepo<T> {
  return {
    create: jest.fn((value: Partial<T>) => value as T),
    delete: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
    save: jest.fn(async (value: T | T[]) => value),
  };
}

function buildSlot(overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    id: 'slot-1',
    user_id: 'user-1',
    day_of_week: 'mon' as DayOfWeek,
    slot_time: '08:00:00',
    mode: 'ai' as SlotMode,
    slot_notes: null,
    created_at: new Date('2026-04-17T00:00:00.000Z'),
    updated_at: new Date('2026-04-17T00:00:00.000Z'),
    user: null as never,
    steps: [],
    ...overrides,
    generateId: jest.fn(),
  } as ScheduleSlot;
}

describe('ScheduleService', () => {
  let service: ScheduleService;
  let slotsRepository: MockRepo<ScheduleSlot>;
  let stepsRepository: MockRepo<RoutineStep>;
  let productsRepository: MockRepo<InventoryProduct>;

  beforeEach(() => {
    slotsRepository = createRepo<ScheduleSlot>();
    stepsRepository = createRepo<RoutineStep>();
    productsRepository = createRepo<InventoryProduct>();

    const dataSource = {
      transaction: jest.fn(
        async (
          work: (manager: {
            getRepository: (
              entity: unknown,
            ) => Repository<ScheduleSlot> | Repository<RoutineStep>;
          }) => Promise<unknown>,
        ) =>
          work({
            getRepository: (entity: unknown) => {
              if (entity === ScheduleSlot) {
                return slotsRepository as unknown as Repository<ScheduleSlot>;
              }
              return stepsRepository as unknown as Repository<RoutineStep>;
            },
          }),
      ),
    } as unknown as DataSource;

    service = new ScheduleService(
      slotsRepository as unknown as Repository<ScheduleSlot>,
      stepsRepository as unknown as Repository<RoutineStep>,
      productsRepository as unknown as Repository<InventoryProduct>,
      dataSource,
    );
  });

  it('creates multiple days in one batch, deduplicates the input, and skips existing slots', async () => {
    const monday = buildSlot({
      id: 'slot-mon',
      day_of_week: 'mon' as DayOfWeek,
    });
    const wednesday = buildSlot({
      id: 'slot-wed',
      day_of_week: 'wed' as DayOfWeek,
    });

    slotsRepository.find
      .mockResolvedValueOnce([monday])
      .mockResolvedValueOnce([monday, wednesday]);
    slotsRepository.create.mockImplementation((value) =>
      buildSlot({
        id: 'slot-wed',
        day_of_week: value.day_of_week ?? ('wed' as DayOfWeek),
        slot_time: value.slot_time ?? '08:00:00',
        mode: value.mode ?? ('ai' as SlotMode),
      }),
    );

    const result = await service.createSlots('user-1', {
      daysOfWeek: ['mon' as DayOfWeek, 'wed' as DayOfWeek, 'wed' as DayOfWeek],
      slotTime: '08:00',
      mode: 'ai' as SlotMode,
    });

    expect(slotsRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        day_of_week: 'wed',
        slot_time: '08:00:00',
      }),
    ]);
    expect(result.map((slot) => slot.day_of_week)).toEqual(['mon', 'wed']);
  });

  it('prefers the saved timezone over the request timezone', () => {
    expect(
      service.resolveEffectiveTimeZone('Europe/Stockholm', 'America/New_York'),
    ).toBe('Europe/Stockholm');
  });

  it('hides non-owned slots behind a not-found error code', async () => {
    slotsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updateSlot('user-1', 'slot-missing', {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'SCHEDULE_SLOT_NOT_FOUND',
      }),
    });
  });

  it('rejects foreign shelf products with a schedule-specific error code', async () => {
    slotsRepository.findOne.mockResolvedValue(buildSlot());
    productsRepository.find.mockResolvedValue([]);

    await expect(
      service.upsertSteps('user-1', 'slot-1', {
        steps: [
          {
            stepOrder: 0,
            inventoryProductId: 'product-1',
            stepLabel: 'cleanser' as StepLabel,
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'SCHEDULE_PRODUCTS_NOT_OWNED',
      }),
    });
  });

  it('requires a custom label for custom steps with a stable error code', async () => {
    slotsRepository.findOne.mockResolvedValue(buildSlot());

    await expect(
      service.upsertSteps('user-1', 'slot-1', {
        steps: [
          {
            stepOrder: 0,
            inventoryProductId: null,
            stepLabel: 'custom' as StepLabel,
          },
        ],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'SCHEDULE_CUSTOM_LABEL_REQUIRED',
      }),
    });
  });
});
