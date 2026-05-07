import { ObjectLiteral, Repository } from 'typeorm';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { RoutineBreakService } from '../suggestions/services/routine-break.service';
import { User } from '../users/entities/user.entity';
import { ApplicationLogResponseDto } from './dto/application-log-response.dto';
import { ApplicationReactiveRegenerationService } from './application-reactive-regeneration.service';

describe('ApplicationReactiveRegenerationService', () => {
  const slotRepo = repo<ScheduleSlot>();
  const suggestionRepo = repo<SuggestionInstance>();
  const jobRepo = repo<SuggestionGenerationJob>();
  const preferenceRepo = repo<UserNotificationPreference>();
  const routineBreakService = {
    isRoutineBreakActive: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;
  const service = new ApplicationReactiveRegenerationService(
    slotRepo,
    suggestionRepo,
    jobRepo,
    preferenceRepo,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    routineBreakService.isRoutineBreakActive.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('regenerates only later same-day slots whose visibility window is already open', async () => {
    slotRepo.find.mockResolvedValue([
      slot('morning-slot', '08:00'),
      slot('noon-slot', '12:00'),
      slot('evening-slot', '20:00'),
    ]);
    preferenceRepo.findOne.mockResolvedValue({
      user_id: 'user-1',
      suggestion_lead_time_minutes: 120,
    } as UserNotificationPreference);
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'noon-suggestion',
        slot_id: 'noon-slot',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);
    suggestionRepo.save.mockResolvedValue({
      id: 'noon-suggestion',
      slot_id: 'noon-slot',
      generation_status: 'superseded',
    } as SuggestionInstance);
    jobRepo.findOne.mockResolvedValue(null);
    jobRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });

    await service.queueAfterApplicationChange(user(), skippedMorningLog());

    expect(slotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 'user-1',
          day_of_week: 'wed',
          deleted_at: expect.objectContaining({ _type: 'isNull' }),
        },
      }),
    );
    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'noon-suggestion',
        generation_status: 'superseded',
      }),
    );
    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'noon-slot',
        target_date: '2026-04-29',
        target_time: '12:00',
        generation_status: 'pending',
        visible_at: new Date('2026-04-29T10:00:00.000Z'),
        supersedes_id: 'noon-suggestion',
      }),
    );
    expect(jobRepo.insert).toHaveBeenCalledTimes(1);
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        slot_id: 'noon-slot',
        target_date: '2026-04-29',
        target_time: '12:00',
        visible_at: new Date('2026-04-29T10:00:00.000Z'),
        run_after: new Date('2026-04-29T10:00:00.000Z'),
        last_error: 'reactive:log-1',
      }),
    );
  });

  it('does not queue reactive regeneration for later slots whose start time already passed', async () => {
    jest.setSystemTime(new Date('2026-04-29T20:35:00.000Z'));
    slotRepo.find.mockResolvedValue([
      slot('morning-slot', '08:00'),
      slot('noon-slot', '12:00'),
      slot('evening-slot', '20:00'),
    ]);
    preferenceRepo.findOne.mockResolvedValue({
      user_id: 'user-1',
      suggestion_lead_time_minutes: 120,
    } as UserNotificationPreference);
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'noon-suggestion',
        slot_id: 'noon-slot',
        generation_status: 'ready',
      } as SuggestionInstance,
      {
        id: 'evening-suggestion',
        slot_id: 'evening-slot',
        generation_status: 'ready',
      } as SuggestionInstance,
    ]);

    await service.queueAfterApplicationChange(user(), skippedMorningLog());

    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('does not queue regeneration when the log has no meaningful deviation', async () => {
    await service.queueAfterApplicationChange(user(), {
      ...skippedMorningLog(),
      hasBeenEdited: false,
      items: [
        {
          status: 'applied',
          isAdHoc: false,
          itemSource: 'recommended',
        },
      ],
    } as ApplicationLogResponseDto);

    expect(slotRepo.find).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('does not queue reactive regeneration while the user is on a routine break', async () => {
    routineBreakService.isRoutineBreakActive.mockResolvedValue(true);

    await service.queueAfterApplicationChange(user(), skippedMorningLog());

    expect(slotRepo.find).not.toHaveBeenCalled();
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return {
    id: 'user-1',
    time_zone: 'UTC',
  } as User;
}

function slot(id: string, slotTime: string): ScheduleSlot {
  return {
    id,
    user_id: 'user-1',
    day_of_week: 'wed',
    slot_time: slotTime,
  } as ScheduleSlot;
}

function skippedMorningLog(): ApplicationLogResponseDto {
  return {
    id: 'log-1',
    targetDate: '2026-04-29',
    targetTime: '08:00',
    hasBeenEdited: false,
    items: [
      {
        status: 'skipped',
        isAdHoc: false,
        itemSource: 'recommended',
      },
    ],
  } as ApplicationLogResponseDto;
}
