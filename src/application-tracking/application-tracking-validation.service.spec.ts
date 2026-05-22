import { BadRequestException, ConflictException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { User } from '../users/entities/user.entity';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';
import { ApplicationLogItem } from './entities/application-log-item.entity';

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

  it('allows application logs for on-demand suggestions without a slot id', async () => {
    const target = await service.resolveTarget(
      user,
      {
        suggestionInstanceId: 'suggestion-1',
        targetDate: '2026-01-01',
        items: [],
      },
      {
        ...suggestion(),
        slot_id: null,
        request_source: 'on_demand',
        target_time: '12:15',
        daypart: 'noon',
      } as SuggestionInstance,
    );

    expect(target).toEqual({
      slotId: null,
      targetDate: '2026-04-29',
      targetTime: '12:15',
      daypart: 'noon',
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

  it('keeps off-shelf substitutions as the applied source of truth', async () => {
    inventoryRepo.find.mockResolvedValue([]);

    const [draft] = await service.buildItemDrafts(
      'user-1',
      [
        {
          stepOrder: 0,
          suggestionStepId: 'step-1',
          status: 'substituted',
          isAdHoc: true,
          adHocBrand: 'Plain Lab',
          adHocName: 'Recovery Balm',
          substitutionReason: 'Skin felt dry.',
        },
      ],
      suggestion(),
    );

    expect(draft.recommendedSnapshot).toEqual(
      expect.objectContaining({
        product_id: 'product-1',
        brand: 'Ava Lab',
        name: 'Gentle Cleanser',
      }),
    );
    expect(draft.appliedSnapshot).toEqual(
      expect.objectContaining({
        product_id: null,
        brand: 'Plain Lab',
        name: 'Recovery Balm',
        suggestion_step_id: 'step-1',
        provenance: 'added_off_shelf',
      }),
    );
    expect(draft.substitutionReason).toBe('Skin felt dry.');
  });

  it('records a provided suggestion from step snapshots after the product is deleted', async () => {
    inventoryRepo.find.mockResolvedValue([]);

    const [draft] = await service.buildItemDrafts(
      'user-1',
      [
        {
          stepOrder: 0,
          suggestionStepId: 'step-1',
          inventoryProductId: 'deleted-product-1',
          status: 'applied',
        },
      ],
      suggestionWithDeletedProduct(),
    );

    expect(draft.inventoryProductId).toBeNull();
    expect(draft.productBrand).toBe('Ava Lab');
    expect(draft.productName).toBe('Gentle Cleanser');
    expect(draft.recommendedSnapshot).toEqual(
      expect.objectContaining({
        product_id: null,
        brand: 'Ava Lab',
        name: 'Gentle Cleanser',
      }),
    );
    expect(draft.appliedSnapshot).toEqual(
      expect.objectContaining({
        product_id: null,
        brand: 'Ava Lab',
        name: 'Gentle Cleanser',
        suggestion_step_id: 'step-1',
      }),
    );
  });

  it('preserves a historical substitution snapshot when the shelf product was deleted before edit', async () => {
    inventoryRepo.find.mockResolvedValue([]);

    const [draft] = await service.buildItemDrafts(
      'user-1',
      [
        {
          stepOrder: 0,
          suggestionStepId: 'step-1',
          substitutedWithProductId: 'deleted-substitution',
          status: 'substituted',
        },
      ],
      suggestion(),
      [
        {
          step_order: 0,
          suggestion_step_id: 'step-1',
          substituted_with_product_id: null,
          applied_snapshot: {
            product_id: 'deleted-substitution',
            brand: 'Plain Lab',
            name: 'Recovery Balm',
            step_label: 'cleanser',
            suggestion_step_id: 'step-1',
            provenance: 'added_shelf',
          },
        } as ApplicationLogItem,
      ],
    );

    expect(draft.substitutedWithProductId).toBeNull();
    expect(draft.appliedSnapshot).toEqual(
      expect.objectContaining({
        product_id: 'deleted-substitution',
        brand: 'Plain Lab',
        name: 'Recovery Balm',
      }),
    );
  });

  it('preserves a deleted substitution snapshot when the edit payload no longer has a product id', async () => {
    inventoryRepo.find.mockResolvedValue([]);

    const [draft] = await service.buildItemDrafts(
      'user-1',
      [
        {
          stepOrder: 0,
          suggestionStepId: 'step-1',
          substitutedWithProductId: null,
          status: 'substituted',
        },
      ],
      suggestion(),
      [
        {
          step_order: 0,
          suggestion_step_id: 'step-1',
          status: 'substituted',
          substituted_with_product_id: null,
          applied_snapshot: {
            product_id: 'deleted-substitution',
            brand: 'Plain Lab',
            name: 'Recovery Balm',
            step_label: 'cleanser',
            suggestion_step_id: 'step-1',
            provenance: 'added_shelf',
          },
        } as ApplicationLogItem,
      ],
    );

    expect(draft.substitutedWithProductId).toBeNull();
    expect(draft.appliedSnapshot).toEqual(
      expect.objectContaining({
        product_id: 'deleted-substitution',
        brand: 'Plain Lab',
        name: 'Recovery Balm',
      }),
    );
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
    request_source: 'scheduled',
    request_context: null,
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

function suggestionWithDeletedProduct(): SuggestionInstance {
  return {
    ...suggestion(),
    steps: [
      {
        id: 'step-1',
        suggestion_instance_id: 'suggestion-1',
        inventory_product_id: null,
        product_brand_snapshot: 'Ava Lab',
        product_name_snapshot: 'Gentle Cleanser',
        step_label: ProductCategory.Cleanser,
        product: null,
      } as SuggestionStep,
    ],
  } as SuggestionInstance;
}
