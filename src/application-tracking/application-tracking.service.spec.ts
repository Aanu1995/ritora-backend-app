import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import { SmartPicksPreparationService } from '../smart-picks/services/smart-picks-preparation.service';
import { User } from '../users/entities/user.entity';
import { ApplicationReactiveRegenerationService } from './application-reactive-regeneration.service';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';
import { ApplicationLogItemInputDto } from './dto/application-log-item.dto';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import { ApplicationLogVersion } from './entities/application-log-version.entity';
import { ApplicationLog } from './entities/application-log.entity';
import { ApplicationTrackingService } from './application-tracking.service';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';

describe('ApplicationTrackingService', () => {
  const logRepo = repo<ApplicationLog>();
  const versionRepo = repo<ApplicationLogVersion>();
  const validation = {
    loadSuggestionForRecord: jest.fn(),
    loadSuggestionForEdit: jest.fn(),
    resolveTarget: jest.fn(),
    buildItemDrafts: jest.fn(),
  } as unknown as jest.Mocked<ApplicationTrackingValidationService>;
  const reactiveRegeneration = {
    queueAfterApplicationChange: jest.fn(),
  } as unknown as jest.Mocked<ApplicationReactiveRegenerationService>;
  const cataloguePhotoStorageService = {
    resolvePublicImageUrls: jest.fn((imageUrls: string[]) => imageUrls),
  } as unknown as jest.Mocked<CataloguePhotoStorageService>;
  const smartPicksPreparation = {
    scheduleForUser: jest.fn(),
  } as unknown as jest.Mocked<SmartPicksPreparationService>;

  let txLogRepo: jest.Mocked<Repository<ApplicationLog>>;
  let txItemRepo: jest.Mocked<Repository<ApplicationLogItem>>;
  let txVersionRepo: jest.Mocked<Repository<ApplicationLogVersion>>;
  let dataSource: DataSource;
  let service: ApplicationTrackingService;

  beforeEach(() => {
    jest.clearAllMocks();
    txLogRepo = repo<ApplicationLog>();
    txItemRepo = repo<ApplicationLogItem>();
    txVersionRepo = repo<ApplicationLogVersion>();
    dataSource = dataSourceWithRepos(txLogRepo, txItemRepo, txVersionRepo);
    service = new ApplicationTrackingService(
      dataSource,
      logRepo,
      versionRepo,
      validation,
      reactiveRegeneration,
      cataloguePhotoStorageService,
      smartPicksPreparation,
    );
  });

  it('records an application log with immutable version snapshot and queues reactive regeneration', async () => {
    const savedLog = applicationLog({ id: 'log-1', editCount: 0 });
    const savedItems = [applicationItem({ id: 'item-1', status: 'skipped' })];
    logRepo.findOne.mockResolvedValue(null);
    validation.loadSuggestionForRecord.mockResolvedValue(suggestion());
    validation.resolveTarget.mockResolvedValue({
      slotId: 'slot-1',
      targetDate: '2026-05-04',
      targetTime: '08:00',
      daypart: 'morning',
    });
    validation.buildItemDrafts.mockResolvedValue([draftItem('skipped')]);
    txLogRepo.create.mockImplementation(
      (value) => ({ ...savedLog, ...value }) as ApplicationLog,
    );
    txLogRepo.save.mockResolvedValue(savedLog);
    txItemRepo.create.mockImplementation(
      (value) => ({ ...savedItems[0], ...value }) as ApplicationLogItem,
    );
    mockSaveArray(txItemRepo).mockResolvedValue(savedItems);
    txVersionRepo.create.mockImplementation(
      (value) => value as ApplicationLogVersion,
    );
    txVersionRepo.save.mockResolvedValue({} as ApplicationLogVersion);
    txLogRepo.findOne.mockResolvedValue({
      ...savedLog,
      items: savedItems,
    } as ApplicationLog);

    const response = await service.record(user(), {
      suggestionInstanceId: 'suggestion-1',
      targetDate: '2026-05-04',
      appliedAt: '2026-05-04T06:15:00.000Z',
      generalNotes: 'Skipped because skin felt warm.',
      items: [itemInput('skipped')],
    });

    expect(response).toEqual(
      expect.objectContaining({
        id: 'log-1',
        suggestionInstanceId: 'suggestion-1',
        editCount: 0,
        hasBeenEdited: false,
      }),
    );
    expect(txVersionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        snapshot: expect.objectContaining({
          version: 1,
          edited_by_user_id: 'user-1',
        }),
      }),
    );
    expect(reactiveRegeneration.queueAfterApplicationChange).toHaveBeenCalled();
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('rejects duplicate records for the same suggestion', async () => {
    validation.loadSuggestionForRecord.mockResolvedValue(suggestion());
    logRepo.findOne.mockResolvedValue(applicationLog({ id: 'existing-log' }));

    await expect(
      service.record(user(), {
        suggestionInstanceId: 'suggestion-1',
        targetDate: '2026-05-04',
        items: [itemInput('applied')],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(smartPicksPreparation.scheduleForUser).not.toHaveBeenCalled();
  });

  it('edits a record, replaces items, increments edit metadata, and versions the change', async () => {
    const existing = applicationLog({ id: 'log-1', editCount: 0 });
    const edited = {
      ...existing,
      edit_count: 1,
      has_been_edited: true,
      edit_reason: 'Corrected substitution',
      last_edited_at: new Date('2026-05-04T09:00:00.000Z'),
      items: [applicationItem({ id: 'item-2', status: 'substituted' })],
    } as ApplicationLog;
    logRepo.findOne.mockResolvedValue(existing);
    validation.loadSuggestionForEdit.mockResolvedValue(suggestion());
    validation.buildItemDrafts.mockResolvedValue([draftItem('substituted')]);
    txLogRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValue(edited);
    mockSaveArray(txItemRepo).mockResolvedValue(edited.items);
    txItemRepo.create.mockImplementation(
      (value) => ({ ...edited.items[0], ...value }) as ApplicationLogItem,
    );
    txLogRepo.save.mockResolvedValue(edited);
    txVersionRepo.create.mockImplementation(
      (value) => value as ApplicationLogVersion,
    );
    txVersionRepo.save.mockResolvedValue({} as ApplicationLogVersion);

    const response = await service.edit(user(), 'log-1', {
      appliedAt: '2026-05-04T08:45:00.000Z',
      generalNotes: 'Updated record.',
      editReason: 'Corrected substitution',
      items: [itemInput('substituted')],
    });

    expect(validation.buildItemDrafts).toHaveBeenCalledWith(
      'user-1',
      [itemInput('substituted')],
      expect.any(Object),
      existing.items,
    );
    expect(txItemRepo.delete).toHaveBeenCalledWith({
      application_log_id: 'log-1',
    });
    expect(response.hasBeenEdited).toBe(true);
    expect(response.editCount).toBe(1);
    expect(txVersionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 2,
        edit_reason: 'Corrected substitution',
      }),
    );
    expect(reactiveRegeneration.queueAfterApplicationChange).toHaveBeenCalled();
    expect(smartPicksPreparation.scheduleForUser).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('protects records from cross-user reads and summarizes tracking analytics', async () => {
    logRepo.findOne.mockResolvedValue(
      applicationLog({ id: 'other-log', userId: 'other-user' }),
    );
    await expect(service.getOne(user(), 'other-log')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    logRepo.find.mockResolvedValue([
      {
        ...applicationLog({ id: 'log-1', editCount: 1 }),
        has_been_edited: true,
        items: [
          applicationItem({ id: 'item-1', status: 'applied' }),
          {
            ...applicationItem({ id: 'item-2', status: 'substituted' }),
            is_ad_hoc: true,
            item_source: 'added_off_shelf',
          },
          applicationItem({ id: 'item-3', status: 'skipped' }),
        ],
      } as ApplicationLog,
    ]);

    const analytics = await service.getAnalytics(user(), {
      from: '2026-05-01',
      to: '2026-05-04',
    });

    expect(analytics).toEqual(
      expect.objectContaining({
        totalLogs: 1,
        editedLogs: 1,
        addedOffShelfCount: 1,
        appliedByCategory: { serum: 1 },
        substitutedByCategory: { serum: 1 },
        skippedByCategory: { serum: 1 },
      }),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    delete: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function dataSourceWithRepos(
  logRepo: Repository<ApplicationLog>,
  itemRepo: Repository<ApplicationLogItem>,
  versionRepo: Repository<ApplicationLogVersion>,
): DataSource {
  const manager = {
    getRepository: (entity: unknown): Repository<ObjectLiteral> => {
      if (entity === ApplicationLog) {
        return logRepo;
      }
      if (entity === ApplicationLogItem) {
        return itemRepo;
      }
      if (entity === ApplicationLogVersion) {
        return versionRepo;
      }
      throw new Error('Unexpected repository token.');
    },
  };
  return {
    transaction: jest.fn(
      (callback: (txManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  } as unknown as DataSource;
}

function mockSaveArray<T extends ObjectLiteral>(
  repository: Repository<T>,
): jest.Mock<Promise<T[]>, [T[]]> {
  return repository.save as unknown as jest.Mock<Promise<T[]>, [T[]]>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function suggestion(): SuggestionInstance {
  return {
    id: 'suggestion-1',
    slot_id: 'slot-1',
    target_date: '2026-05-04',
    target_time: '08:00',
    daypart: 'morning',
    generation_status: 'ready',
  } as unknown as SuggestionInstance;
}

function applicationLog(input: {
  id: string;
  userId?: string;
  editCount?: number;
}): ApplicationLog {
  const now = new Date('2026-05-04T08:00:00.000Z');
  return {
    id: input.id,
    user_id: input.userId ?? 'user-1',
    suggestion_instance_id: 'suggestion-1',
    slot_id: 'slot-1',
    target_date: '2026-05-04',
    target_time: '08:00',
    daypart: 'morning',
    applied_at: now,
    general_notes: 'Recorded.',
    edit_reason: null,
    edit_count: input.editCount ?? 0,
    has_been_edited: false,
    first_recorded_at: now,
    last_edited_at: null,
    created_at: now,
    updated_at: now,
    items: [],
  } as unknown as ApplicationLog;
}

function applicationItem(input: {
  id: string;
  status: 'applied' | 'skipped' | 'substituted';
}): ApplicationLogItem {
  return {
    id: input.id,
    application_log_id: 'log-1',
    step_order: 0,
    suggestion_step_id: 'step-1',
    inventory_product_id: 'product-1',
    substituted_with_product_id:
      input.status === 'substituted' ? 'product-2' : null,
    product_brand_snapshot: 'Ava Lab',
    product_name_snapshot: 'Barrier Serum',
    step_label: 'serum',
    status: input.status,
    is_ad_hoc: false,
    item_source: 'recommended',
    ad_hoc_brand: null,
    ad_hoc_name: null,
    notes: null,
    substitution_reason:
      input.status === 'substituted' ? 'Used gentler product' : null,
    recommended_snapshot: null,
    applied_snapshot: null,
    applied_at: new Date('2026-05-04T08:00:00.000Z'),
  } as unknown as ApplicationLogItem;
}

function draftItem(status: 'applied' | 'skipped' | 'substituted') {
  return {
    stepOrder: 0,
    suggestionStepId: 'step-1',
    inventoryProductId: 'product-1',
    substitutedWithProductId: status === 'substituted' ? 'product-2' : null,
    productBrand: 'Ava Lab',
    productName: 'Barrier Serum',
    stepLabel: 'serum',
    status,
    isAdHoc: false,
    itemSource: 'recommended' as const,
    adHocBrand: null,
    adHocName: null,
    notes: null,
    substitutionReason:
      status === 'substituted' ? 'Used gentler product' : null,
    recommendedSnapshot: null,
    appliedSnapshot: null,
    appliedAt: '2026-05-04T08:00:00.000Z',
  };
}

function itemInput(
  status: 'applied' | 'skipped' | 'substituted',
): ApplicationLogItemInputDto {
  return {
    stepOrder: 0,
    suggestionStepId: 'step-1',
    inventoryProductId: 'product-1',
    substitutedWithProductId: status === 'substituted' ? 'product-2' : null,
    status,
  };
}
