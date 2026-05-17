import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import { ProductImageUrlResolverOptions } from '../inventory/product-image-url-resolver';
import { User } from '../users/entities/user.entity';
import {
  EditApplicationDto,
  RecordApplicationDto,
} from './dto/application-log-item.dto';
import {
  ApplicationTrackingAnalyticsDto,
  ApplicationLogResponseDto,
  ApplicationLogVersionResponseDto,
} from './dto/application-log-response.dto';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import { ApplicationLogVersion } from './entities/application-log-version.entity';
import { ApplicationLog } from './entities/application-log.entity';
import { createApplicationLogItems } from './application-log-item.mapper';
import type { ApplicationItemDraft } from './application-log-item.mapper';
import {
  buildApplicationLogSnapshot,
  incrementCount,
  isUniqueConstraintError,
} from './application-tracking.helpers';
import { ApplicationReactiveRegenerationService } from './application-reactive-regeneration.service';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';
import { SmartPicksPreparationService } from '../smart-picks/services/smart-picks-preparation.service';
import { SkinJournalService } from '../skin-journal/skin-journal.service';

@Injectable()
export class ApplicationTrackingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ApplicationLog)
    private readonly logRepo: Repository<ApplicationLog>,
    @InjectRepository(ApplicationLogVersion)
    private readonly versionRepo: Repository<ApplicationLogVersion>,
    private readonly validation: ApplicationTrackingValidationService,
    private readonly reactiveRegeneration: ApplicationReactiveRegenerationService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
    @Optional()
    private readonly smartPicksPreparation?: SmartPicksPreparationService,
    @Optional()
    private readonly skinJournal?: SkinJournalService,
  ) {}

  async record(
    user: User,
    payload: RecordApplicationDto,
  ): Promise<ApplicationLogResponseDto> {
    const suggestion = await this.validation.loadSuggestionForRecord(
      user,
      payload.suggestionInstanceId ?? null,
    );

    if (payload.suggestionInstanceId) {
      const existing = await this.logRepo.findOne({
        where: {
          user_id: user.id,
          suggestion_instance_id: payload.suggestionInstanceId,
        },
      });
      if (existing) {
        throw new ConflictException(
          'This suggestion already has an application record. Use the edit endpoint to amend it.',
        );
      }
    }
    const target = await this.validation.resolveTarget(
      user,
      payload,
      suggestion,
    );
    const itemDrafts = await this.validation.buildItemDrafts(
      user.id,
      payload.items,
      suggestion,
    );

    const response = await this.createLogTransaction(
      user,
      payload,
      target,
      itemDrafts,
    );
    await this.reactiveRegeneration.queueAfterApplicationChange(user, response);
    await this.markInsightInputsDirty(user.id);
    this.scheduleSmartPicksPreparation(user.id);
    return response;
  }

  async edit(
    user: User,
    logId: string,
    payload: EditApplicationDto,
  ): Promise<ApplicationLogResponseDto> {
    const log = await this.logRepo.findOne({
      where: { id: logId },
      relations: ['items'],
    });
    if (!log) {
      throw new NotFoundException('Application record not found.');
    }
    if (log.user_id !== user.id) {
      throw new ForbiddenException(
        'Application record belongs to another user.',
      );
    }
    const suggestion = log.suggestion_instance_id
      ? await this.validation.loadSuggestionForEdit(
          user,
          log.suggestion_instance_id,
        )
      : null;
    const itemDrafts = await this.validation.buildItemDrafts(
      user.id,
      payload.items,
      suggestion,
      log.items ?? [],
    );

    const response = await this.dataSource.transaction(async (manager) => {
      const logRepo = manager.getRepository(ApplicationLog);
      const itemRepo = manager.getRepository(ApplicationLogItem);
      const versionRepo = manager.getRepository(ApplicationLogVersion);

      const lockedLog = await logRepo.findOne({
        where: { id: log.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedLog) {
        throw new NotFoundException('Application record not found.');
      }
      if (lockedLog.user_id !== user.id) {
        throw new ForbiddenException(
          'Application record belongs to another user.',
        );
      }

      await itemRepo.delete({ application_log_id: lockedLog.id });

      const items = createApplicationLogItems(
        itemRepo,
        lockedLog.id,
        itemDrafts,
      );
      const savedItems = await itemRepo.save(items);

      const now = new Date();
      lockedLog.applied_at =
        payload.appliedAt !== undefined
          ? payload.appliedAt
            ? new Date(payload.appliedAt)
            : null
          : lockedLog.applied_at;
      lockedLog.general_notes =
        payload.generalNotes !== undefined
          ? payload.generalNotes
          : lockedLog.general_notes;
      lockedLog.edit_reason = payload.editReason ?? null;
      lockedLog.edit_count = lockedLog.edit_count + 1;
      lockedLog.has_been_edited = true;
      lockedLog.last_edited_at = now;
      const savedLog = await logRepo.save(lockedLog);

      const nextVersion = lockedLog.edit_count + 1;
      const snapshot = buildApplicationLogSnapshot(
        savedLog,
        savedItems,
        nextVersion,
        user.id,
        payload.editReason ?? null,
      );
      await versionRepo.save(
        versionRepo.create({
          application_log_id: savedLog.id,
          version: nextVersion,
          snapshot,
          edited_by_user_id: user.id,
          edit_reason: payload.editReason ?? null,
        }),
      );

      const fresh = await logRepo.findOne({
        where: { id: savedLog.id },
        relations: ['items', 'items.product', 'items.substituted_with_product'],
      });
      return ApplicationLogResponseDto.fromEntity(
        fresh!,
        this.productImageOptions(),
      );
    });
    await this.reactiveRegeneration.queueAfterApplicationChange(user, response);
    await this.markInsightInputsDirty(user.id);
    this.scheduleSmartPicksPreparation(user.id);
    return response;
  }

  private scheduleSmartPicksPreparation(userId: string): void {
    this.smartPicksPreparation?.scheduleForUser(userId);
  }

  private async markInsightInputsDirty(userId: string): Promise<void> {
    await this.skinJournal?.markProductOrRoutineInsightsDirty(userId);
  }

  async getOne(user: User, logId: string): Promise<ApplicationLogResponseDto> {
    const log = await this.logRepo.findOne({
      where: { id: logId },
      relations: ['items', 'items.product', 'items.substituted_with_product'],
    });
    if (!log) throw new NotFoundException('Application record not found.');
    if (log.user_id !== user.id) {
      throw new ForbiddenException(
        'Application record belongs to another user.',
      );
    }
    return ApplicationLogResponseDto.fromEntity(
      log,
      this.productImageOptions(),
    );
  }

  async getVersions(
    user: User,
    logId: string,
  ): Promise<ApplicationLogVersionResponseDto[]> {
    const log = await this.logRepo.findOne({ where: { id: logId } });
    if (!log) throw new NotFoundException('Application record not found.');
    if (log.user_id !== user.id) {
      throw new ForbiddenException(
        'Application record belongs to another user.',
      );
    }
    const versions = await this.versionRepo.find({
      where: { application_log_id: logId },
      order: { version: 'ASC' },
    });
    return versions.map((v) => ApplicationLogVersionResponseDto.fromEntity(v));
  }

  async getAnalytics(
    user: User,
    query: { from?: string; to?: string },
  ): Promise<ApplicationTrackingAnalyticsDto> {
    const toDate = query.to ?? new Date().toISOString().slice(0, 10);
    const fromDate =
      query.from ??
      new Date(new Date(`${toDate}T00:00:00Z`).getTime() - 29 * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const logs = await this.logRepo.find({
      where: {
        user_id: user.id,
        target_date: Between(fromDate, toDate),
      },
      relations: ['items'],
    });
    const analytics = new ApplicationTrackingAnalyticsDto();
    analytics.totalLogs = logs.length;
    analytics.editedLogs = logs.filter((log) => log.has_been_edited).length;
    analytics.addedOffShelfCount = 0;
    analytics.skippedByCategory = {};
    analytics.substitutedByCategory = {};
    analytics.appliedByCategory = {};
    for (const log of logs) {
      for (const item of log.items ?? []) {
        const category = item.step_label ?? 'unknown';
        if (item.is_ad_hoc || item.item_source === 'added_off_shelf') {
          analytics.addedOffShelfCount += 1;
        }
        if (item.status === 'skipped') {
          incrementCount(analytics.skippedByCategory, category);
        }
        if (item.status === 'substituted')
          incrementCount(analytics.substitutedByCategory, category);
        if (item.status === 'applied') {
          incrementCount(analytics.appliedByCategory, category);
        }
      }
    }
    return analytics;
  }

  private async createLogTransaction(
    user: User,
    payload: RecordApplicationDto,
    target: {
      slotId: string | null;
      targetDate: string;
      targetTime: string | null;
      daypart: ApplicationLog['daypart'];
    },
    itemDrafts: ApplicationItemDraft[],
  ): Promise<ApplicationLogResponseDto> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const logRepo = manager.getRepository(ApplicationLog);
        const itemRepo = manager.getRepository(ApplicationLogItem);
        const versionRepo = manager.getRepository(ApplicationLogVersion);

        const now = new Date();
        const log = logRepo.create({
          user_id: user.id,
          suggestion_instance_id: payload.suggestionInstanceId ?? null,
          slot_id: target.slotId,
          target_date: target.targetDate,
          target_time: target.targetTime,
          daypart: target.daypart,
          applied_at: payload.appliedAt ? new Date(payload.appliedAt) : now,
          general_notes: payload.generalNotes ?? null,
          edit_reason: null,
          edit_count: 0,
          has_been_edited: false,
          first_recorded_at: now,
          last_edited_at: null,
        });
        const savedLog = await logRepo.save(log);

        const items = createApplicationLogItems(
          itemRepo,
          savedLog.id,
          itemDrafts,
        );
        const savedItems = await itemRepo.save(items);

        const snapshot = buildApplicationLogSnapshot(
          savedLog,
          savedItems,
          1,
          user.id,
          null,
        );
        await versionRepo.save(
          versionRepo.create({
            application_log_id: savedLog.id,
            version: 1,
            snapshot,
            edited_by_user_id: user.id,
            edit_reason: null,
          }),
        );

        const fresh = await logRepo.findOne({
          where: { id: savedLog.id },
          relations: [
            'items',
            'items.product',
            'items.substituted_with_product',
          ],
        });
        return ApplicationLogResponseDto.fromEntity(
          fresh!,
          this.productImageOptions(),
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'This suggestion already has an application record. Use the edit endpoint to amend it.',
        );
      }
      throw error;
    }
  }

  private productImageOptions(): ProductImageUrlResolverOptions {
    return {
      resolveProductImageUrls: (imageUrls) =>
        this.cataloguePhotoStorageService.resolvePublicImageUrls(imageUrls),
    };
  }
}
