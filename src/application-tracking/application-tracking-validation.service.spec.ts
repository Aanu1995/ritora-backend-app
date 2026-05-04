import { BadRequestException, ConflictException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { User } from '../users/entities/user.entity';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';

describe('ApplicationTrackingValidationService', () => {
  const suggestionRepo = mockRepo<SuggestionInstance>();
  const inventoryRepo = mockRepo<InventoryProduct>();
  const slotRepo = mockRepo<ScheduleSlot>();
  const service = new ApplicationTrackingValidationService(
    suggestionRepo,
    inventoryRepo,
    slotRepo,
  );
  const user = { id: 'user-1' } as User;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('derives spoofable target metadata from the suggestion', async () => {
    const target = await service.resolveTarget(
      user,
      {
        suggestionInstanceId: 'suggestion-1',
        slotId: 'spoofed-slot',
        targetDate: '2026-01-01',
        targetTime: '23:59',
        items: [],
      },
      suggestion(),
    );

    expect(target).toEqual({
      slotId: 'slot-1',
      targetDate: '2026-04-29',
      targetTime: '08:00',
      daypart: 'morning',
    });
  });

  it('rejects item product references that do not belong to the user', async () => {
    inventoryRepo.find.mockResolvedValue([]);

    await expect(
      service.buildItemDrafts(
        'user-1',
        [
          {
            stepOrder: 0,
            inventoryProductId: 'foreign-product',
            status: 'applied',
          },
        ],
        null,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires off-shelf products to include brand and name', async () => {
    await expect(
      service.buildItemDrafts(
        'user-1',
        [
          {
            stepOrder: 0,
            status: 'applied',
            isAdHoc: true,
            adHocBrand: 'Only Brand',
          },
        ],
        null,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects suggestions that have not produced a ready recommendation', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      ...suggestion(),
      generation_status: 'failed',
    } as SuggestionInstance);

    await expect(
      service.loadSuggestionForRecord(user, 'suggestion-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('allows existing historical logs to keep editing superseded suggestions', async () => {
    const superseded = {
      ...suggestion(),
      generation_status: 'superseded',
    } as SuggestionInstance;
    suggestionRepo.findOne.mockResolvedValue(superseded);

    await expect(
      service.loadSuggestionForEdit(user, 'suggestion-1'),
    ).resolves.toBe(superseded);
  });
});

function mockRepo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function suggestion(): SuggestionInstance {
  return {
    id: 'suggestion-1',
    user_id: 'user-1',
    slot_id: 'slot-1',
    target_date: '2026-04-29',
    target_time: '08:00',
    daypart: 'morning',
    generation_status: 'ready',
    steps: [
      {
        id: 'step-1',
        suggestion_instance_id: 'suggestion-1',
        inventory_product_id: 'product-1',
        step_label: ProductCategory.Cleanser,
        product: {
          id: 'product-1',
          user_id: 'user-1',
          brand: 'Ava Lab',
          name: 'Gentle Cleanser',
          category: ProductCategory.Cleanser,
          status: ShelfStatus.Active,
          guidance: {},
        } as InventoryProduct,
      } as SuggestionStep,
    ],
  } as SuggestionInstance;
}
