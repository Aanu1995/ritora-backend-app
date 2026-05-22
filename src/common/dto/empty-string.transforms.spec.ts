import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from '../../auth/dto/login.dto';
import { RecordApplicationDto } from '../../application-tracking/dto/application-log-item.dto';
import { AnalyzeProductsDto } from '../../ingredients/dto/analyze-products.dto';
import { InventoryListQueryDto } from '../../inventory/dto/inventory-list-query.dto';
import { CreateInventoryProductDto } from '../../inventory/dto/create-inventory-product.dto';
import { NotificationListQueryDto } from '../../notifications/dto/notification-list-query.dto';
import { NOTIFICATION_PAGE_DEFAULT_LIMIT } from '../../notifications/notifications.constants';
import {
  ProductCategory,
  ShelfSort,
  ShelfStatFilter,
} from '../../shelf/shelf.types';
import { DEFAULT_SHELF_PAGE_SIZE } from '../../shelf/shelf.constants';
import { UpdatePreferencesDto } from '../../notifications/dto/notification-preference.dto';
import { UpsertEntryDto } from '../../skin-journal/dto/upsert-entry.dto';
import { CreateSkinProfileDto } from '../../skin-profile/dto/create-skin-profile.dto';
import {
  BUDGET_TIERS,
  ETHNICITIES,
  FITZPATRICK_PHOTOTYPES,
  SEX_AT_BIRTH,
  SKIN_CONCERNS,
  SKIN_TONES,
  SKIN_TYPES,
} from '../../skin-profile/dto/skin-profile.constants';
import { CreateOnDemandSuggestionDto } from '../../suggestions/dto/on-demand-suggestion.dto';
import { SuggestionHistoryListQueryDto } from '../../suggestions/dto/suggestion-history.dto';
import {
  StartRoutineBreakDto,
  UpdateRoutineBreakDto,
} from '../../suggestions/dto/suggestion-routine-break.dto';
import { SnoozeRecordingReminderDto } from '../../suggestions/dto/suggestion-today-actions.dto';
import { SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT } from '../../suggestions/suggestions.constants';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('empty-string DTO transforms', () => {
  it('ignores blank optional notification settings instead of failing validation', async () => {
    const dto = plainToInstance(UpdatePreferencesDto, {
      photo_reminder_local_time: '',
      suggestion_lead_time_minutes: '',
      quiet_hours_start: ' ',
      quiet_hours_end: '',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.photo_reminder_local_time).toBeUndefined();
    expect(dto.suggestion_lead_time_minutes).toBeUndefined();
    expect(dto.quiet_hours_start).toBeUndefined();
    expect(dto.quiet_hours_end).toBeUndefined();
  });

  it('normalizes blank list query params back to defaults', async () => {
    const notifications = plainToInstance(NotificationListQueryDto, {
      cursor: '',
      limit: '',
    });
    const shelf = plainToInstance(InventoryListQueryDto, {
      stat: '',
      category: '',
      sort: '',
      cursor: '',
      limit: '',
    });

    const [notificationErrors, shelfErrors] = await Promise.all([
      validate(notifications, validationOptions),
      validate(shelf, validationOptions),
    ]);

    expect(notificationErrors).toHaveLength(0);
    expect(shelfErrors).toHaveLength(0);
    expect(notifications.cursor).toBeUndefined();
    expect(notifications.limit).toBe(NOTIFICATION_PAGE_DEFAULT_LIMIT);
    expect(shelf.stat).toBe(ShelfStatFilter.All);
    expect(shelf.category).toBe('all');
    expect(shelf.sort).toBe(ShelfSort.RecentlyAdded);
    expect(shelf.cursor).toBeUndefined();
    expect(shelf.limit).toBe(DEFAULT_SHELF_PAGE_SIZE);
  });

  it('normalizes blank application record identifiers and timestamps', async () => {
    const dto = plainToInstance(RecordApplicationDto, {
      suggestionInstanceId: '',
      slotId: '',
      targetDate: '2026-05-07',
      targetTime: null,
      appliedAt: '',
      items: [
        {
          stepOrder: 0,
          suggestionStepId: '',
          inventoryProductId: '',
          substitutedWithProductId: '',
          status: 'skipped',
          appliedAt: '',
        },
      ],
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.suggestionInstanceId).toBeNull();
    expect(dto.slotId).toBeNull();
    expect(dto.appliedAt).toBeNull();
    expect(dto.items[0]?.suggestionStepId).toBeNull();
    expect(dto.items[0]?.inventoryProductId).toBeNull();
    expect(dto.items[0]?.substitutedWithProductId).toBeNull();
    expect(dto.items[0]?.appliedAt).toBeNull();
  });

  it('normalizes blank on-demand optional request fields', async () => {
    const dto = plainToInstance(CreateOnDemandSuggestionDto, {
      intent: 'post_workout',
      intensity: '',
      activityAt: '',
      requestId: '',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.intensity).toBeNull();
    expect(dto.activityAt).toBeNull();
    expect(dto.requestId).toBeNull();
  });

  it('normalizes blank history filters so empty query params do not fail', async () => {
    const dto = plainToInstance(SuggestionHistoryListQueryDto, {
      range: '',
      from: '',
      to: '',
      daypart: '',
      mode: '',
      requestSource: '',
      status: '',
      edited: '',
      cursor: '',
      limit: '',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.range).toBeNull();
    expect(dto.from).toBeNull();
    expect(dto.to).toBeNull();
    expect(dto.daypart).toBeNull();
    expect(dto.mode).toBeNull();
    expect(dto.requestSource).toBeNull();
    expect(dto.status).toBeNull();
    expect(dto.edited).toBeUndefined();
    expect(dto.cursor).toBeUndefined();
    expect(dto.limit).toBe(SUGGESTION_HISTORY_PAGE_DEFAULT_LIMIT);
  });

  it('normalizes blank routine break resume dates', async () => {
    const startDto = plainToInstance(StartRoutineBreakDto, { endsAt: '' });
    const updateDto = plainToInstance(UpdateRoutineBreakDto, { endsAt: ' ' });

    const [startErrors, updateErrors] = await Promise.all([
      validate(startDto, validationOptions),
      validate(updateDto, validationOptions),
    ]);

    expect(startErrors).toHaveLength(0);
    expect(updateErrors).toHaveLength(0);
    expect(startDto.endsAt).toBeNull();
    expect(updateDto.endsAt).toBeNull();
  });

  it('normalizes blank suggestion action and ingredient-analysis optionals', async () => {
    const snooze = plainToInstance(SnoozeRecordingReminderDto, {
      suggestionInstanceId: '01K00000000000000000000000',
      minutes: '',
    });
    const ingredients = plainToInstance(AnalyzeProductsDto, {
      productIds: ['product-1'],
      withExplanations: '',
      language: '',
    });

    const [snoozeErrors, ingredientErrors] = await Promise.all([
      validate(snooze, validationOptions),
      validate(ingredients, validationOptions),
    ]);

    expect(snoozeErrors).toHaveLength(0);
    expect(ingredientErrors).toHaveLength(0);
    expect(snooze.minutes).toBeUndefined();
    expect(ingredients.withExplanations).toBeUndefined();
    expect(ingredients.language).toBeUndefined();
  });

  it('normalizes blank multipart journal check-in optionals', async () => {
    const dto = plainToInstance(UpsertEntryDto, {
      overall_feel: '',
      sleep_band: '',
      stress_today: '',
      sun_exposure_today: '',
      cycle_marker: '',
      ratings: {
        oiliness: '',
        dryness: '',
        redness: '',
        breakouts: '',
        texture: '',
        irritation: '',
        sensitivity: '',
      },
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.overall_feel).toBeUndefined();
    expect(dto.sleep_band).toBeUndefined();
    expect(dto.stress_today).toBeUndefined();
    expect(dto.sun_exposure_today).toBeUndefined();
    expect(dto.cycle_marker).toBeUndefined();
    expect(dto.ratings?.oiliness).toBeUndefined();
    expect(dto.ratings?.sensitivity).toBeUndefined();
  });

  it('normalizes blank optional skin-profile fields across nested sections', async () => {
    const dto = plainToInstance(CreateSkinProfileDto, {
      skinType: SKIN_TYPES[0],
      skinTone: SKIN_TONES[0],
      dateOfBirth: '1994-04-12',
      sexAtBirth: SEX_AT_BIRTH[0],
      ethnicity: ETHNICITIES[0],
      currentConcerns: [SKIN_CONCERNS[0]],
      fitzpatrickPhototype: FITZPATRICK_PHOTOTYPES[0],
      primaryGoal: SKIN_CONCERNS[0],
      allowSmartPicks: true,
      budgetTier: BUDGET_TIERS[0],
      countryCode: '',
      sensitivityLevel: '',
      hydrationLevel: '',
      pregnancyStatus: '',
      safetyContext: {
        conditions: '',
        medications: '',
        recent_procedures: '',
      },
      reactionHistory: {
        entries: '',
      },
      concernDetails: {
        per_concern: '',
      },
      skinBehavior: {
        burn_tendency: '',
        tan_tendency: '',
        pih_tendency: '',
        melasma_tendency: '',
        keloid_tendency: '',
        sunscreen_habit: '',
        sunscreen_tolerance: '',
      },
      routinePreferences: {
        pace: '',
        am_minutes: '',
        pm_minutes: '',
        max_active_nights_per_week: '',
        sunscreen_filter: '',
        sunscreen_finish: '',
      },
      lifestyleContext: {
        sleep: '',
        stress: '',
        water_intake: '',
        diet_flags: '',
        smoking: '',
        alcohol: '',
        climate_sensitivities: '',
      },
      shoppingPreferences: {
        ingredient_dislikes: '',
        product_dislikes: '',
        brand_dislikes: '',
        ingredient_ethics: '',
        texture_preferences: '',
      },
      hormonalContext: {
        cycle_pattern: '',
        breakout_pattern: '',
      },
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.countryCode).toBeUndefined();
    expect(dto.sensitivityLevel).toBeUndefined();
    expect(dto.pregnancyStatus).toBeUndefined();
    expect(dto.safetyContext?.conditions).toBeUndefined();
    expect(dto.safetyContext?.recent_procedures).toBeUndefined();
    expect(dto.reactionHistory?.entries).toBeUndefined();
    expect(dto.concernDetails?.per_concern).toBeUndefined();
    expect(dto.skinBehavior?.burn_tendency).toBeUndefined();
    expect(dto.routinePreferences?.am_minutes).toBeUndefined();
    expect(dto.lifestyleContext?.diet_flags).toBeUndefined();
    expect(dto.shoppingPreferences?.texture_preferences).toBeUndefined();
    expect(dto.hormonalContext?.cycle_pattern).toBeUndefined();
  });

  it('normalizes blank optional auth language', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@example.com',
      password: 'Password123!',
      language: '',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.language).toBeUndefined();
  });

  it('normalizes blank shelf optional fields before format and enum validation', async () => {
    const dto = plainToInstance(CreateInventoryProductDto, {
      identity: {
        brand: 'CeraVe',
        name: 'Hydrating Cleanser',
        category: ProductCategory.Cleanser,
        imageUrls: ['https://images.example.com/cleanser.jpg'],
        sizeMl: 236,
        description: 'Gentle cleanser.',
        benefits: ['gentle'],
        suitedFor: ['dry skin'],
        inciIngredients: ['Aqua'],
        inciLastConfirmedAt: '',
      },
      guidance: {
        applicationMethod: '',
        quantity: '',
        steps: ['Apply to damp skin'],
        cautions: [],
        waitMinutes: '',
      },
      manufacturer: {
        supportEmail: '',
        productUrl: '',
        websiteUrl: '',
      },
      userFields: {
        openedAt: '',
        expiresAt: '',
        periodAfterOpeningMonths: '',
        pricePaid: '',
        preferredTimeOfDay: '',
      },
      status: '',
      provenance: '',
    });

    const errors = await validate(dto, validationOptions);

    expect(errors).toHaveLength(0);
    expect(dto.identity.inciLastConfirmedAt).toBeNull();
    expect(dto.guidance.applicationMethod).toBeNull();
    expect(dto.guidance.quantity).toBeNull();
    expect(dto.guidance.waitMinutes).toBeNull();
    expect(dto.manufacturer.supportEmail).toBeNull();
    expect(dto.manufacturer.productUrl).toBeNull();
    expect(dto.manufacturer.websiteUrl).toBeNull();
    expect(dto.userFields.openedAt).toBeNull();
    expect(dto.userFields.expiresAt).toBeNull();
    expect(dto.userFields.periodAfterOpeningMonths).toBeNull();
    expect(dto.userFields.pricePaid).toBeNull();
    expect(dto.userFields.preferredTimeOfDay).toBeNull();
    expect(dto.status).toBeNull();
    expect(dto.provenance).toBeNull();
  });
});
