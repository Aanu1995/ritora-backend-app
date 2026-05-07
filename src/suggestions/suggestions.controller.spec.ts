import { Request, Response } from 'express';
import { User } from '../users/entities/user.entity';
import { UserConsentType } from '../users/user-consent.constants';
import { SuggestionConsentService } from './services/suggestion-consent.service';
import { SuggestionOnDemandService } from './services/suggestion-on-demand.service';
import { SuggestionsService } from './services/suggestions.service';
import { SuggestionTodayActionService } from './services/suggestion-today-action.service';
import { RoutineBreakService } from './services/routine-break.service';
import { SuggestionsController } from './suggestions.controller';

describe('SuggestionsController', () => {
  const service = {
    getTodaysSuggestion: jest.fn(),
    getHistory: jest.fn(),
    exportHistoryCsv: jest.fn(),
    getHistoryDay: jest.fn(),
    getSuggestion: jest.fn(),
    regenerateSuggestion: jest.fn(),
  } as unknown as jest.Mocked<SuggestionsService>;
  const consentService = {
    evaluate: jest.fn(),
    updateAiSuggestionConsent: jest.fn(),
  } as unknown as jest.Mocked<SuggestionConsentService>;
  const todayActionService = {
    useNormalRoutineForToday: jest.fn(),
    recordGapAction: jest.fn(),
    snoozeRecordingReminder: jest.fn(),
  } as unknown as jest.Mocked<SuggestionTodayActionService>;
  const routineBreakService = {
    getBreakState: jest.fn(),
    startBreak: jest.fn(),
    resumeActiveBreak: jest.fn(),
    updateBreak: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const onDemandService = {
    create: jest.fn(),
    retryFailed: jest.fn(),
  } as unknown as jest.Mocked<SuggestionOnDemandService>;
  const controller = new SuggestionsController(
    service,
    consentService,
    todayActionService,
    routineBreakService,
    onDemandService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the x-time-zone header through for today and history endpoints', async () => {
    service.getTodaysSuggestion.mockResolvedValue({
      date: '2026-05-04',
    } as never);
    service.getHistory.mockResolvedValue({ days: [] } as never);
    service.getHistoryDay.mockResolvedValue({ date: '2026-05-03' } as never);
    const request = requestWithTimeZone(' Europe/Stockholm ');

    await controller.getTodaysSuggestion(user(), request);
    await controller.getHistory(user(), request, { daypart: 'morning' });
    service.exportHistoryCsv.mockResolvedValue({
      fileName: 'ritora-history-2026-04-27-to-2026-05-03.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'Date\n',
    });
    const response = responseMock();
    await controller.exportHistory(
      user(),
      request,
      { daypart: 'morning' },
      response,
    );
    await controller.getHistoryDay(user(), request, '2026-05-03');

    expect(service.getTodaysSuggestion).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
    );
    expect(service.getHistory).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
      { daypart: 'morning' },
    );
    expect(service.exportHistoryCsv).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
      { daypart: 'morning' },
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/csv; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="ritora-history-2026-04-27-to-2026-05-03.csv"',
    );
    expect(service.getHistoryDay).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
      '2026-05-03',
    );
  });

  it('uses null for missing timezone headers and delegates single suggestion actions', async () => {
    service.getTodaysSuggestion.mockResolvedValue({
      date: '2026-05-04',
    } as never);
    service.getSuggestion.mockResolvedValue({ id: 'suggestion-1' } as never);
    service.regenerateSuggestion.mockResolvedValue({
      id: 'replacement-1',
    } as never);
    const request = requestWithTimeZone(null);

    await controller.getTodaysSuggestion(user(), request);
    await controller.getOne(user(), 'suggestion-1');
    await controller.regenerate(user(), 'suggestion-1', undefined as never);

    expect(service.getTodaysSuggestion).toHaveBeenCalledWith(user(), null);
    expect(service.getSuggestion).toHaveBeenCalledWith(user(), 'suggestion-1');
    expect(service.regenerateSuggestion).toHaveBeenCalledWith(
      user(),
      'suggestion-1',
      {},
    );
  });

  it('reads and updates explicit AI suggestion consent', async () => {
    consentService.evaluate.mockResolvedValue({
      aiPersonalizationAllowed: true,
      canReadSensitiveContext: false,
      blockedReason: 'sensitive_recommendation_context_consent_missing',
      grantedAt: new Date('2026-05-07T09:00:00.000Z'),
      activeSensitiveConsentTypes: [],
    });
    consentService.updateAiSuggestionConsent.mockResolvedValue({
      aiPersonalizationAllowed: true,
      canReadSensitiveContext: true,
      blockedReason: null,
      grantedAt: new Date('2026-05-07T09:05:00.000Z'),
      activeSensitiveConsentTypes: [UserConsentType.HealthContextProcessing],
    });
    const request = { ip: '127.0.0.1' } as Request;

    await expect(controller.getAiConsent(user())).resolves.toEqual({
      granted: true,
      grantedAt: '2026-05-07T09:00:00.000Z',
      canReadSensitiveContext: false,
      blockedReason: 'sensitive_recommendation_context_consent_missing',
      activeSensitiveConsentTypes: [],
    });
    await expect(
      controller.updateAiConsent(user(), request, { granted: true }),
    ).resolves.toEqual({
      granted: true,
      grantedAt: '2026-05-07T09:05:00.000Z',
      canReadSensitiveContext: true,
      blockedReason: null,
      activeSensitiveConsentTypes: [UserConsentType.HealthContextProcessing],
    });

    expect(consentService.updateAiSuggestionConsent).toHaveBeenCalledWith(
      'user-1',
      true,
      '127.0.0.1',
    );
  });

  it('delegates Today-owned normal routine and gap actions', async () => {
    todayActionService.useNormalRoutineForToday.mockResolvedValue({
      targetDate: '2026-05-04',
      expiresAt: '2026-05-04T21:59:59.999Z',
      reactionEntryId: 'entry-1',
    });
    todayActionService.recordGapAction.mockResolvedValue({
      suggestionInstanceId: 'suggestion-1',
      ingredientOrCategory: 'Vitamin C serum',
      normalizedKey: 'vitamin-c-serum',
      action: 'saved',
    });
    todayActionService.snoozeRecordingReminder.mockResolvedValue({
      suggestionInstanceId: 'suggestion-1',
      snoozedUntil: '2026-05-04T11:00:00.000Z',
    });
    const request = requestWithTimeZone('Europe/Stockholm');

    await controller.useNormalRoutineForToday(user(), request);
    await controller.recordGapAction(user(), {
      suggestionInstanceId: 'suggestion-1',
      ingredientOrCategory: 'Vitamin C serum',
      action: 'saved',
    });
    await controller.snoozeRecordingReminder(user(), {
      suggestionInstanceId: 'suggestion-1',
      minutes: 60,
    });

    expect(todayActionService.useNormalRoutineForToday).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
    );
    expect(todayActionService.recordGapAction).toHaveBeenCalledWith(user(), {
      suggestionInstanceId: 'suggestion-1',
      ingredientOrCategory: 'Vitamin C serum',
      action: 'saved',
    });
    expect(todayActionService.snoozeRecordingReminder).toHaveBeenCalledWith(
      user(),
      { suggestionInstanceId: 'suggestion-1', minutes: 60 },
    );
  });

  it('queues on-demand suggestions with the request timezone', async () => {
    onDemandService.create.mockResolvedValue({
      id: 'suggestion-on-demand-1',
      slotId: null,
      requestSource: 'on_demand',
    } as never);
    const request = requestWithTimeZone('Europe/Stockholm');

    await expect(
      controller.createOnDemandSuggestion(user(), request, {
        intent: 'post_workout',
        intensity: 'minimal',
        note: 'Back from training.',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'suggestion-on-demand-1',
        requestSource: 'on_demand',
      }),
    );

    expect(onDemandService.create).toHaveBeenCalledWith(
      user(),
      'Europe/Stockholm',
      {
        intent: 'post_workout',
        intensity: 'minimal',
        note: 'Back from training.',
      },
    );
  });

  it('retries failed on-demand suggestions without a request body', async () => {
    onDemandService.retryFailed.mockResolvedValue({
      id: 'suggestion-on-demand-1',
      slotId: null,
      requestSource: 'on_demand',
      generationStatus: 'generating',
    } as never);

    await expect(
      controller.retryOnDemandSuggestion(user(), 'suggestion-on-demand-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'suggestion-on-demand-1',
        generationStatus: 'generating',
      }),
    );

    expect(onDemandService.retryFailed).toHaveBeenCalledWith(
      user(),
      'suggestion-on-demand-1',
    );
  });

  it('delegates routine break read, start, resume, and update actions', async () => {
    const state = {
      routineBreak: {
        id: 'break-1',
        status: 'active' as const,
        startedAt: '2026-05-06T08:00:00.000Z',
        endsAt: null,
        canResumeNow: true,
        message:
          'Your routine is paused. Ritora will not generate new skincare suggestions until you resume.',
      },
    };
    routineBreakService.getBreakState.mockResolvedValue(state);
    routineBreakService.startBreak.mockResolvedValue(state);
    routineBreakService.resumeActiveBreak.mockResolvedValue({
      routineBreak: null,
    });
    routineBreakService.updateBreak.mockResolvedValue(state);

    await expect(controller.getRoutineBreak(user())).resolves.toBe(state);
    await expect(
      controller.startRoutineBreak(user(), {
        endsAt: '2026-05-07T08:00:00.000Z',
        reason: 'Travelling',
      }),
    ).resolves.toBe(state);
    await expect(controller.resumeRoutineBreak(user())).resolves.toEqual({
      routineBreak: null,
    });
    await expect(
      controller.updateRoutineBreak(user(), 'break-1', {
        endsAt: null,
      }),
    ).resolves.toBe(state);

    expect(routineBreakService.getBreakState).toHaveBeenCalledWith(user());
    expect(routineBreakService.startBreak).toHaveBeenCalledWith(user(), {
      endsAt: '2026-05-07T08:00:00.000Z',
      reason: 'Travelling',
    });
    expect(routineBreakService.resumeActiveBreak).toHaveBeenCalledWith(user());
    expect(routineBreakService.updateBreak).toHaveBeenCalledWith(
      user(),
      'break-1',
      { endsAt: null },
    );
  });
});

function user(): User {
  return { id: 'user-1' } as User;
}

function requestWithTimeZone(value: string | null): Request {
  return {
    header: jest.fn((name: string) =>
      name === 'x-time-zone' ? value : undefined,
    ),
  } as unknown as Request;
}

function responseMock(): Response {
  return {
    setHeader: jest.fn(),
  } as unknown as Response;
}
