import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../common/utils/date';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { deriveSuggestionDaypart } from '../suggestions/services/suggestion-helpers';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionGenerationStatus } from '../suggestions/suggestions.constants';
import { User } from '../users/entities/user.entity';
import {
  ApplicationLogItemInputDto,
  RecordApplicationDto,
} from './dto/application-log-item.dto';
import {
  collectApplicationItemProductIds,
  resolveApplicationItemDrafts,
  ResolvedApplicationItemInput,
} from './application-item-draft.resolver';
import { ApplicationDaypart } from './application-tracking.constants';
import { ApplicationLogItem } from './entities/application-log-item.entity';

@Injectable()
export class ApplicationTrackingValidationService {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
  ) {}

  async loadSuggestionForRecord(
    user: User,
    suggestionInstanceId: string | null,
  ): Promise<SuggestionInstance | null> {
    if (!suggestionInstanceId) return null;
    const suggestion = await this.loadOwnedSuggestion(
      user,
      suggestionInstanceId,
    );
    if (
      suggestion.generation_status === SuggestionGenerationStatus.Superseded
    ) {
      throw new ConflictException(
        'This suggestion has been superseded. Record the current suggestion instead.',
      );
    }
    if (suggestion.generation_status !== SuggestionGenerationStatus.Ready) {
      throw new ConflictException('This suggestion is not ready to record.');
    }
    return suggestion;
  }

  async loadSuggestionForEdit(
    user: User,
    suggestionInstanceId: string | null,
  ): Promise<SuggestionInstance | null> {
    if (!suggestionInstanceId) return null;
    return this.loadOwnedSuggestion(user, suggestionInstanceId);
  }

  async resolveTarget(
    user: User,
    payload: RecordApplicationDto,
    suggestion: SuggestionInstance | null,
  ): Promise<ApplicationTarget> {
    if (suggestion) {
      return {
        slotId: suggestion.slot_id,
        targetDate: toDateOnlyString(suggestion.target_date),
        targetTime: toTimeOnlyString(suggestion.target_time),
        daypart: suggestion.daypart,
      };
    }
    const slot = payload.slotId
      ? await this.slotRepo.findOne({
          where: { id: payload.slotId, user_id: user.id, deleted_at: IsNull() },
        })
      : null;
    if (payload.slotId && !slot) {
      throw new NotFoundException('Schedule slot not found.');
    }
    const targetTime = payload.targetTime ?? slot?.slot_time ?? null;
    return {
      slotId: slot?.id ?? payload.slotId ?? null,
      targetDate: toDateOnlyString(payload.targetDate),
      targetTime: targetTime ? toTimeOnlyString(targetTime) : null,
      daypart: targetTime ? deriveSuggestionDaypart(targetTime) : null,
    };
  }

  async buildItemDrafts(
    userId: string,
    items: ApplicationLogItemInputDto[],
    suggestion: SuggestionInstance | null,
    existingItems: ApplicationLogItem[] = [],
  ): Promise<ResolvedApplicationItemInput[]> {
    if (!items?.length) {
      throw new BadRequestException(
        'At least one applied, skipped, or substituted item is required.',
      );
    }
    const productById = await this.loadProductMap(
      userId,
      collectApplicationItemProductIds(items, existingItems),
    );
    return resolveApplicationItemDrafts({
      items,
      suggestionSteps: suggestion?.steps ?? [],
      productById,
      existingItems,
    });
  }

  private async loadProductMap(
    userId: string,
    ids: string[],
  ): Promise<Map<string, InventoryProduct>> {
    const products = ids.length
      ? await this.inventoryRepo.find({
          where: { user_id: userId, id: In(ids) },
        })
      : [];
    const productById = new Map(
      products.map((product) => [product.id, product]),
    );
    for (const id of ids) {
      if (!productById.has(id)) {
        throw new BadRequestException(
          'One or more product references are invalid.',
        );
      }
    }
    return productById;
  }

  private async loadOwnedSuggestion(
    user: User,
    suggestionInstanceId: string,
  ): Promise<SuggestionInstance> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionInstanceId },
      relations: ['steps', 'steps.product'],
    });
    if (!suggestion) {
      throw new NotFoundException('Suggestion not found.');
    }
    if (suggestion.user_id !== user.id) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }
    return suggestion;
  }
}

export type ApplicationTarget = {
  slotId: string | null;
  targetDate: string;
  targetTime: string | null;
  daypart: ApplicationDaypart | null;
};
