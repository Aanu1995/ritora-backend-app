import { SkinJournalEntry } from '../entities/skin-journal-entry.entity';
import { JournalEntryResponseDto } from './journal-entry-response.dto';

function entry(): SkinJournalEntry {
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
    complaint_note: null,
    analysis_status: 'completed',
    analysis_observations: null,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_error: null,
    analysis_completed_at: null,
    analysis_retry_count: 0,
    created_at: new Date('2026-04-29T00:00:00.000Z'),
    updated_at: new Date('2026-04-29T00:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
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
  });
});
