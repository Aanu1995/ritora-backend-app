import { ConfigService } from '@nestjs/config';
import { SuggestionAiGenerator } from './suggestion-ai-generator';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';

describe('SuggestionAiGenerator', () => {
  it('uses the structured reaction context even when the journal flag has not been backfilled', async () => {
    const generator = new SuggestionAiGenerator({
      get: jest.fn().mockReturnValue(null),
    } as unknown as ConfigService);

    const result = await generator.generate({
      slotId: 'slot-1',
      targetDate: '2026-04-29',
      targetTime: '08:00',
      daypart: 'morning',
      skinProfile: null,
      shelfActiveProducts: [],
      shelfFinishedProductIds: [],
      routineSteps: [],
      recentJournalEntries: [],
      recentApplications: [],
      contextSummary: {
        cacheKey: 'ctx',
        builtAt: '2026-04-29T06:00:00.000Z',
        targetDate: '2026-04-29',
        targetTime: '08:00',
        daypart: 'morning',
        skinProfile: {
          primaryGoal: null,
          skinType: null,
          sensitivityLevel: null,
          activeConcerns: [],
          pregnancyStatus: null,
        },
        reaction: {
          hasSignal: true,
          severity: 'moderate',
          confidence: 0.8,
          indicators: ['redness'],
          affectedZones: ['cheeks'],
          concernKeys: ['redness_inflammation'],
          daysSinceLatestSignal: 0,
          barrierCompromised: true,
        },
        productScores: [],
        applicationPatterns: {
          days: 0,
          skippedByCategory: {},
          substitutedByCategory: {},
          addedOffShelfCount: 0,
          editedLogCount: 0,
          adherenceByCategory: {},
        },
        safetyConstraints: ['barrier_recovery_mode'],
        skippedCandidates: [],
      },
    } satisfies SuggestionGenerationInputs);

    expect(result.hasReactionSignal).toBe(true);
    expect(result.metadata.model).toBe('deterministic-baseline');
    expect(result.safetyFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Recent reaction'),
        }),
      ]),
    );
  });
});
