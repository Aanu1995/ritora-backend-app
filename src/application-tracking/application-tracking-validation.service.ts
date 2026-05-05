import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../common/utils/date';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { deriveSuggestionDaypart } from '../suggestions/services/suggestion-helpers';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { User } from '../users/entities/user.entity';
import {
  ApplicationLogItemInputDto,
  RecordApplicationDto,
} from './dto/application-log-item.dto';
import {
  ApplicationItemProductSnapshot,
  ApplicationItemSource,
} from './application-tracking.constants';
import type { ApplicationDaypart } from './application-tracking.constants';

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
    if (suggestion.generation_status === 'superseded') {
      throw new ConflictException(
        'This suggestion has been superseded. Record the current suggestion instead.',
      );
    }
    if (suggestion.generation_status !== 'ready') {
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
          where: { id: payload.slotId, user_id: user.id },
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
  ): Promise<ResolvedApplicationItemInput[]> {
    if (!items?.length) {
      throw new BadRequestException(
        'At least one applied, skipped, or substituted item is required.',
      );
    }
    const stepById = new Map<string, SuggestionStep>(
      (suggestion?.steps ?? []).map((step) => [step.id, step]),
    );
    const productById = await this.loadProductMap(userId, items);
    return items.map((item, index) =>
      resolveItemDraft(item, index, stepById, productById),
    );
  }

  private async loadProductMap(
    userId: string,
    items: ApplicationLogItemInputDto[],
  ): Promise<Map<string, InventoryProduct>> {
    const ids = Array.from(
      new Set(
        items.flatMap((item) =>
          [item.inventoryProductId, item.substitutedWithProductId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    );
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

export type ResolvedApplicationItemInput = ApplicationLogItemInputDto & {
  productBrand: string | null;
  productName: string | null;
  stepLabel: string | null;
  isAdHoc: boolean;
  adHocBrand: string | null;
  adHocName: string | null;
  inventoryProductId: string | null;
  substitutedWithProductId: string | null;
  itemSource: ApplicationItemSource;
  substitutionReason: string | null;
  recommendedSnapshot: ApplicationItemProductSnapshot | null;
  appliedSnapshot: ApplicationItemProductSnapshot | null;
};

function resolveItemDraft(
  item: ApplicationLogItemInputDto,
  index: number,
  stepById: Map<string, SuggestionStep>,
  productById: Map<string, InventoryProduct>,
): ResolvedApplicationItemInput {
  const suggestionStep = item.suggestionStepId
    ? (stepById.get(item.suggestionStepId) ?? null)
    : null;
  if (item.suggestionStepId && !suggestionStep) {
    throw new BadRequestException(
      'Suggestion step does not belong to this suggestion.',
    );
  }
  const product = item.inventoryProductId
    ? (productById.get(item.inventoryProductId) ?? null)
    : null;
  const substitutedProduct = item.substitutedWithProductId
    ? (productById.get(item.substitutedWithProductId) ?? null)
    : null;
  const isAdHoc = item.isAdHoc ?? false;
  validateItemShape(item, isAdHoc, product, substitutedProduct, suggestionStep);

  const sourceProduct = product ?? suggestionStep?.product ?? null;
  const itemSource = resolveItemSource(item, suggestionStep);
  return {
    ...item,
    stepOrder: item.stepOrder ?? index,
    inventoryProductId: product?.id ?? item.inventoryProductId ?? null,
    substitutedWithProductId: substitutedProduct?.id ?? null,
    productBrand:
      sourceProduct?.brand ?? item.productBrand ?? item.adHocBrand ?? null,
    productName:
      sourceProduct?.name ?? item.productName ?? item.adHocName ?? null,
    stepLabel: suggestionStep?.step_label ?? item.stepLabel ?? null,
    isAdHoc,
    adHocBrand: item.adHocBrand?.trim() || null,
    adHocName: item.adHocName?.trim() || null,
    itemSource,
    substitutionReason: item.substitutionReason ?? null,
    recommendedSnapshot: suggestionStep
      ? {
          product_id: suggestionStep.inventory_product_id,
          brand:
            suggestionStep.product_brand_snapshot ??
            suggestionStep.product?.brand ??
            null,
          name:
            suggestionStep.product_name_snapshot ??
            suggestionStep.product?.name ??
            null,
          step_label: suggestionStep.step_label,
          routine_step_id: suggestionStep.routine_step_id,
          suggestion_step_id: suggestionStep.id,
          provenance: suggestionStep.provenance,
        }
      : null,
    appliedSnapshot: buildAppliedSnapshot(
      item,
      sourceProduct,
      substitutedProduct,
      suggestionStep,
    ),
  };
}

function resolveItemSource(
  item: ApplicationLogItemInputDto,
  suggestionStep: SuggestionStep | null,
): ApplicationItemSource {
  if (item.isAdHoc) return 'added_off_shelf';
  if (
    !suggestionStep &&
    (item.inventoryProductId || item.substitutedWithProductId)
  ) {
    return 'added_shelf';
  }
  return 'recommended';
}

function buildAppliedSnapshot(
  item: ApplicationLogItemInputDto,
  sourceProduct: InventoryProduct | null,
  substitutedProduct: InventoryProduct | null,
  suggestionStep: SuggestionStep | null,
): ApplicationItemProductSnapshot | null {
  if (item.status === 'substituted' && item.isAdHoc) {
    return {
      product_id: null,
      brand: item.adHocBrand ?? null,
      name: item.adHocName ?? null,
      step_label: item.stepLabel ?? suggestionStep?.step_label ?? null,
      routine_step_id: suggestionStep?.routine_step_id ?? null,
      suggestion_step_id: suggestionStep?.id ?? null,
      provenance: 'added_off_shelf',
    };
  }
  const product = substitutedProduct ?? sourceProduct;
  if (product) {
    return {
      product_id: product.id,
      brand: product.brand,
      name: product.name,
      step_label: suggestionStep?.step_label ?? item.stepLabel ?? null,
      routine_step_id: suggestionStep?.routine_step_id ?? null,
      suggestion_step_id: suggestionStep?.id ?? null,
      provenance: suggestionStep?.provenance ?? null,
    };
  }
  if (item.isAdHoc) {
    return {
      product_id: null,
      brand: item.adHocBrand ?? null,
      name: item.adHocName ?? null,
      step_label: item.stepLabel ?? null,
      routine_step_id: null,
      suggestion_step_id: suggestionStep?.id ?? null,
      provenance: 'added_off_shelf',
    };
  }
  return null;
}

function validateItemShape(
  item: ApplicationLogItemInputDto,
  isAdHoc: boolean,
  product: InventoryProduct | null,
  substitutedProduct: InventoryProduct | null,
  suggestionStep: SuggestionStep | null,
): void {
  if (isAdHoc && (!item.adHocBrand?.trim() || !item.adHocName?.trim())) {
    throw new BadRequestException(
      'Off-shelf products require both brand and name.',
    );
  }
  if (
    item.status === 'substituted' &&
    !substitutedProduct &&
    !(isAdHoc && item.adHocBrand?.trim() && item.adHocName?.trim())
  ) {
    throw new BadRequestException(
      'Substituted items require a shelf product or an off-shelf brand and name.',
    );
  }
  if (!isAdHoc && !product && !suggestionStep) {
    throw new BadRequestException(
      'Logged items must reference a suggestion step, shelf product, or off-shelf product.',
    );
  }
}
