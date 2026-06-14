import { SkinJournalEntry } from '../entities/skin-journal-entry.entity';
import { JournalEntryResponseDto } from './journal-entry-response.dto';

function entry(overrides: Partial<SkinJournalEntry> = {}): SkinJournalEntry {
  return {
    id: 'entry-1',
    user_id: 'user-1',
    entry_date: '2026-04-29',
    time_zone: 'Europe/Stockholm',
    photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    photo_width: 100,
    photo_height: 100,
    photo_size: 10,
    photo_content_type: 'image/webp',
    exif_stripped: true,
    angle: 'head_on',
    concern_focus: null,
    is_pre_routine: true,
    ratings: null,
    overall_feel: null,
    sleep_band: null,
    stress_today: null,
    sun_exposure_today: null,
    sweat_exercise_today: null,
    cycle_marker: null,
    recent_change: null,
    reaction_report: null,
    complaint_note: null,
    analysis_status: 'completed',
    analysis_observations: null,
    analysis_interpretation: {
      version: '1.0',
      code: 'stable_baseline',
      severity: 'info',
      summary_key: 'journal.analysis.interpretation.stableBaseline.summary',
      summary_values: {},
      guidance_keys: [
        'journal.analysis.interpretation.stableBaseline.guidance',
      ],
      caveat_keys: ['journal.analysis.interpretation.caveats.notDiagnosis'],
      source_ids: [],
      sources: [],
      generated_at: '2026-05-01T08:00:00.000Z',
    },
    analysis_feedback_submitted: false,
    analysis_feedback_submitted_at: null,
    analysis_feedback_interpretation_version: null,
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_prompt_version: 'skin-journal-photo-vtest',
    analysis_error: null,
    analysis_error_code: null,
    analysis_started_at: new Date('2026-04-29T09:00:00.000Z'),
    analysis_completed_at: null,
    analysis_duration_ms: 1234,
    analysis_input_image_count: 2,
    analysis_input_tokens: 1000,
    analysis_output_tokens: 100,
    analysis_total_tokens: 1100,
    analysis_estimated_cost_usd: 0.0065,
    analysis_retry_count: 0,
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

describe('JournalEntryResponseDto', () => {
  it('does not expose internal media object keys in user-facing entry responses', () => {
    const dto = JournalEntryResponseDto.fromEntity(
      entry(),
      'https://signed.example.com/photo.webp',
    );

    expect('photo_object_key' in dto).toBe(false);
    expect(dto.photo_url).toBe('https://signed.example.com/photo.webp');
    expect(dto.has_photo).toBe(true);
    expect(dto.analysis_interpretation?.code).toBe('stable_baseline');
    expect(dto.analysis_prompt_version).toBe('skin-journal-photo-vtest');
    expect(dto.analysis_duration_ms).toBe(1234);
    expect(dto.analysis_input_image_count).toBe(2);
    expect(dto.analysis_input_tokens).toBe(1000);
    expect(dto.analysis_output_tokens).toBe(100);
    expect(dto.analysis_total_tokens).toBe(1100);
    expect(dto.analysis_estimated_cost_usd).toBe(0.0065);
    expect(dto.analysis_error_code).toBeNull();
    expect(dto.analysis_feedback_submitted).toBe(false);
    expect(dto.analysis_feedback_submitted_at).toBeNull();
  });

  it('exposes a typed feedback-submitted flag only for the current interpretation', () => {
    const submittedAt = new Date('2026-05-27T08:00:00.000Z');
    const dto = JournalEntryResponseDto.fromEntity(
      entry({
        analysis_feedback_submitted: true,
        analysis_feedback_submitted_at: submittedAt,
        analysis_feedback_interpretation_version: '1.0',
      }),
      'https://signed.example.com/photo.webp',
    );

    expect(dto.analysis_feedback_submitted).toBe(true);
    expect(dto.analysis_feedback_submitted_at).toBe(submittedAt);
  });

  it('does not treat older interpretation feedback as submitted for the current analysis', () => {
    const dto = JournalEntryResponseDto.fromEntity(
      entry({
        analysis_feedback_submitted: true,
        analysis_feedback_submitted_at: new Date('2026-05-27T08:00:00.000Z'),
        analysis_feedback_interpretation_version: '1.0',
        analysis_interpretation: {
          ...entry().analysis_interpretation!,
          version: '1.1',
        },
      }),
      'https://signed.example.com/photo.webp',
    );

    expect(dto.analysis_feedback_submitted).toBe(false);
    expect(dto.analysis_feedback_submitted_at).toBeNull();
  });

  it('does not expose empty legacy reaction reports as user-visible reactions', () => {
    const dto = JournalEntryResponseDto.fromEntity(
      entry({
        reaction_report: {
          symptoms: [],
          severity: 'mild',
          onset: null,
          locations: [],
          red_flags: [],
          suspected_trigger: null,
          note: null,
        },
      }),
      'https://signed.example.com/photo.webp',
    );

    expect(dto.reaction_report).toBeNull();
    expect(dto.has_reaction).toBe(false);
  });
});
