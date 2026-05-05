import { ObjectLiteral, Repository } from 'typeorm';
import { RoutineSimplificationEvent } from '../../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SuggestionTodayActionService } from './suggestion-today-action.service';
import { TodaysSuggestionReactionService } from './todays-suggestion-reaction.service';

describe('TodaysSuggestionReactionService', () => {
  const entryRepo = repo<SkinJournalEntry>();
  const simplificationRepo = repo<RoutineSimplificationEvent>();
  const todayActionService = {
    shouldIgnoreReactionContext: jest.fn(),
  } as unknown as jest.Mocked<SuggestionTodayActionService>;
  const service = new TodaysSuggestionReactionService(
    entryRepo,
    simplificationRepo,
    todayActionService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    todayActionService.shouldIgnoreReactionContext.mockResolvedValue(false);
  });

  it('returns rich reaction metadata from recent journal analysis', async () => {
    entryRepo.find.mockResolvedValue([
      reactionEntry('2026-05-04', true),
      reactionEntry('2026-05-03', false),
    ]);
    simplificationRepo.findOne.mockResolvedValue({
      id: 'simplification-1',
    } as RoutineSimplificationEvent);

    await expect(
      service.getReactionAlert('user-1', '2026-05-04', [
        'Retinol serum',
        'AHA toner',
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        photoEntryId: 'entry-2026-05-04',
        severity: 'moderate',
        confidence: 0.82,
        affectedZones: ['cheeks'],
        indicators: ['redness', 'dryness'],
        concernKeys: ['redness_inflammation', 'skin_barrier_damage'],
        barrierConcern: true,
        photosUntilClear: 2,
        simplificationId: 'simplification-1',
        canUseNormalRoutine: true,
        pausedActiveNames: ['Retinol serum', 'AHA toner'],
      }),
    );
  });

  it('does not show a reaction banner when recent entries are clear', async () => {
    entryRepo.find.mockResolvedValue([reactionEntry('2026-05-04', false)]);
    simplificationRepo.findOne.mockResolvedValue(null);

    await expect(
      service.getReactionAlert('user-1', '2026-05-04', []),
    ).resolves.toBeNull();
  });

  it('hides reaction metadata when the user has chosen normal routine today', async () => {
    todayActionService.shouldIgnoreReactionContext.mockResolvedValue(true);

    await expect(
      service.getReactionAlert('user-1', '2026-05-04', []),
    ).resolves.toBeNull();

    expect(entryRepo.find).not.toHaveBeenCalled();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function reactionEntry(date: string, detected: boolean): SkinJournalEntry {
  return {
    id: `entry-${date}`,
    entry_date: date,
    user_id: 'user-1',
    has_reaction_signal: detected,
    analysis_summary: detected
      ? 'Possible irritation signal detected; keep the routine simple.'
      : 'No reaction signal detected.',
    analysis_completed_at: new Date(`${date}T07:30:00.000Z`),
    created_at: new Date(`${date}T07:00:00.000Z`),
    updated_at: new Date(`${date}T07:30:00.000Z`),
    analysis_observations: {
      schema_version: '1.1',
      model_version: 'test-model',
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
      },
      detected_concerns: detected
        ? [
            {
              concern: 'redness_inflammation',
              severity: 'moderate',
              locations: ['cheeks'],
              confidence: 0.84,
            },
            {
              concern: 'skin_barrier_damage',
              severity: 'moderate',
              locations: ['cheeks'],
              confidence: 0.77,
            },
          ]
        : [],
      reaction_signals: {
        reaction_detected: detected,
        reaction_severity: detected ? 'moderate' : 'none',
        indicators: detected ? ['redness'] : [],
        confidence: detected ? 0.82 : 0.1,
      },
      barrier_signs: {
        barrier_compromise: detected,
        indicators: detected ? ['dryness'] : [],
      },
      overall_assessment: 'Assessment',
      user_visible_message: detected
        ? 'Your latest photo suggests redness and dryness changes.'
        : 'Your latest photo looks steady.',
      should_flag_for_doctor: false,
    },
  } as unknown as SkinJournalEntry;
}
