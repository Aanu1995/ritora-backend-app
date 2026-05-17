import { Logger } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { DispatchNotificationParams } from '../../notifications/notifications.service.helpers';
import { MAX_STEPS_PER_SLOT } from '../../schedule/dto/schedule.constants';
import { ProductCategory } from '../../shelf/shelf.types';
import {
  SuggestionDaypart,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionGenerationStepOutput } from './suggestion-ai-generator';
import {
  dispatchSuggestionReadyNotification,
  estimateRoutineMinutes,
} from './suggestion-generation-events';
import { SuggestionObservabilityService } from './suggestion-observability.service';

type SuggestionReadyStepPayload = {
  title: string;
  brand: string;
};

describe('suggestion generation notification events', () => {
  it('builds a minimized suggestion-ready template payload from generated steps', async () => {
    const { dispatch, notifications, observability, logger } = harness();
    const steps = [
      step({
        stepOrder: 2,
        productName: null,
        customLabel: 'Face mist',
        productBrand: null,
        waitAfterMinutes: null,
        stepLabel: ProductCategory.Toner,
      }),
      step({
        stepOrder: 1,
        productName: 'Barrier Serum',
        productBrand: 'Ava Lab',
        waitAfterMinutes: 3,
      }),
      step({
        stepOrder: 3,
        productName: null,
        customLabel: null,
        productBrand: null,
        waitAfterMinutes: Number.NaN,
        stepLabel: ProductCategory.SunProtection,
      }),
    ];

    await dispatchSuggestionReadyNotification({
      notifications,
      observability,
      logger,
      userId: 'user-1',
      slotId: 'slot-1',
      targetDate: '2026-05-04',
      targetTime: '08:30:00',
      daypart: SuggestionDaypart.Morning,
      steps,
      suggestionInstanceId: 'suggestion-1',
      jobId: 'job-1',
    });

    const payload = sentPayload(dispatch);
    expect(payload).toEqual({
      slotId: 'slot-1',
      targetDate: '2026-05-04',
      requestSource: SuggestionRequestSource.Scheduled,
      daypart: SuggestionDaypart.Morning,
      slotTime: '08:30',
      stepCount: 3,
      minutes: 9,
      steps: [
        { title: 'Barrier Serum', brand: 'Ava Lab' },
        { title: 'Face mist', brand: '' },
        { title: 'sun protection', brand: '' },
      ],
    });
  });

  it('caps and normalizes step details before storing the notification payload', async () => {
    const { dispatch, notifications, observability, logger } = harness();
    const longTitle = `Cleanser\n${'x'.repeat(240)}`;
    const steps = Array.from({ length: MAX_STEPS_PER_SLOT + 2 }, (_, index) =>
      step({
        stepOrder: index,
        productName: `${longTitle}-${index}`,
        productBrand: `Brand\t${index}`,
      }),
    );

    await dispatchSuggestionReadyNotification({
      notifications,
      observability,
      logger,
      userId: 'user-1',
      slotId: null,
      targetDate: '2026-05-04',
      targetTime: '12:00',
      daypart: SuggestionDaypart.Noon,
      steps,
      suggestionInstanceId: 'suggestion-on-demand-1',
      jobId: 'job-1',
    });

    const payload = sentPayload(dispatch);
    const payloadSteps = routineSteps(payload.steps);
    expect(payload.stepCount).toBe(MAX_STEPS_PER_SLOT + 2);
    expect(payloadSteps).toHaveLength(MAX_STEPS_PER_SLOT);
    expect(payloadSteps[0]?.title).toHaveLength(160);
    expect(hasControlCharacters(payloadSteps[0]?.title ?? '')).toBe(false);
    expect(payloadSteps[0]?.brand).toBe('Brand 0');
  });

  it('ignores invalid wait values when estimating routine duration', () => {
    expect(
      estimateRoutineMinutes([
        step({ waitAfterMinutes: 2 }),
        step({ waitAfterMinutes: Number.NaN }),
        step({ waitAfterMinutes: -4 }),
      ]),
    ).toBe(8);
  });
});

function harness(): {
  dispatch: jest.Mock<Promise<null>, [DispatchNotificationParams]>;
  notifications: NotificationsService;
  observability: SuggestionObservabilityService;
  logger: Logger;
} {
  const dispatch = jest.fn<Promise<null>, [DispatchNotificationParams]>();
  dispatch.mockResolvedValue(null);
  const record = jest.fn<
    ReturnType<SuggestionObservabilityService['record']>,
    Parameters<SuggestionObservabilityService['record']>
  >();
  record.mockResolvedValue(undefined);

  return {
    dispatch,
    notifications: { dispatch } as unknown as NotificationsService,
    observability: { record } as unknown as SuggestionObservabilityService,
    logger: { warn: jest.fn() } as unknown as Logger,
  };
}

function sentPayload(
  dispatch: jest.Mock<Promise<null>, [DispatchNotificationParams]>,
): Record<string, unknown> {
  const payload = dispatch.mock.calls[0]?.[0].payload;
  if (!payload) {
    throw new Error('Missing notification payload.');
  }
  return payload;
}

function routineSteps(value: unknown): SuggestionReadyStepPayload[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected routine steps array.');
  }

  return value.map((item) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.title !== 'string' ||
      typeof item.brand !== 'string'
    ) {
      throw new Error('Expected routine step payload.');
    }
    return { title: item.title, brand: item.brand };
  });
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function step(
  overrides: Partial<SuggestionGenerationStepOutput> = {},
): SuggestionGenerationStepOutput {
  return {
    stepOrder: 0,
    routineStepId: null,
    inventoryProductId: 'product-1',
    productBrand: 'Ava Lab',
    productName: 'Barrier Serum',
    stepLabel: ProductCategory.Serum,
    customLabel: null,
    applicationMethod: 'fingertips',
    quantity: 'pea-size',
    waitAfterMinutes: 0,
    explanation: 'Best fit.',
    routineNote: null,
    provenance: SuggestionStepProvenance.AiAdded,
    chips: [],
    safetyWarnings: [],
    ...overrides,
  };
}
