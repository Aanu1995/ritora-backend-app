import { ScheduleSlot } from './entities/schedule-slot.entity';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

const mockScheduleService = () => ({
  getForUser: jest.fn(),
  getTodaysSchedule: jest.fn(),
  resolveEffectiveTimeZone: jest.fn(),
  resolveTodayDay: jest.fn(),
  createSlot: jest.fn(),
  createSlots: jest.fn(),
  applyEveryDayPreset: jest.fn(),
  updateSlot: jest.fn(),
  deleteSlot: jest.fn(),
  upsertSteps: jest.fn(),
  moveSlot: jest.fn(),
});

function createSlot(overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    id: 'slot-1',
    user_id: 'user-1',
    day_of_week: 'mon',
    slot_time: '08:30:00',
    mode: 'manual',
    slot_notes: null,
    steps: [],
    created_at: new Date('2026-04-17T08:00:00.000Z'),
    updated_at: new Date('2026-04-17T08:00:00.000Z'),
    generateId: jest.fn(),
    ...overrides,
  } as unknown as ScheduleSlot;
}

describe('ScheduleController', () => {
  let controller: ScheduleController;
  let scheduleService: ReturnType<typeof mockScheduleService>;

  beforeEach(() => {
    scheduleService = mockScheduleService();
    scheduleService.resolveEffectiveTimeZone.mockReturnValue(
      'Europe/Stockholm',
    );
    scheduleService.resolveTodayDay.mockReturnValue('mon');
    controller = new ScheduleController(
      scheduleService as unknown as ScheduleService,
    );
  });

  it('returns the full schedule with the effective timezone', async () => {
    const slot = createSlot();
    scheduleService.getForUser.mockResolvedValue([slot]);

    const result = await controller.getSchedule(
      'user-1',
      null,
      'Europe/Stockholm',
    );

    expect(scheduleService.getForUser).toHaveBeenCalledWith('user-1');
    expect(scheduleService.resolveEffectiveTimeZone).toHaveBeenCalledWith(
      null,
      'Europe/Stockholm',
    );
    expect(result.timeZone).toBe('Europe/Stockholm');
    expect(result.slots[0]).toMatchObject({
      id: 'slot-1',
      dayOfWeek: 'mon',
      slotTime: '08:30',
      mode: 'manual',
    });
  });

  it('returns today using the resolved day and timezone', async () => {
    const slot = createSlot({ day_of_week: 'tue' });
    scheduleService.resolveTodayDay.mockReturnValue('tue');
    scheduleService.getTodaysSchedule.mockResolvedValue([slot]);

    const result = await controller.getTodaysSchedule(
      'user-1',
      'Europe/Stockholm',
      undefined,
    );

    expect(scheduleService.resolveTodayDay).toHaveBeenCalledWith(
      'Europe/Stockholm',
      undefined,
    );
    expect(scheduleService.getTodaysSchedule).toHaveBeenCalledWith(
      'user-1',
      'tue',
    );
    expect(result.dayOfWeek).toBe('tue');
    expect(result.slots).toHaveLength(1);
  });

  it('wraps create, update, step, and move results as slot responses', async () => {
    const slot = createSlot();
    scheduleService.createSlot.mockResolvedValue(slot);
    scheduleService.updateSlot.mockResolvedValue(slot);
    scheduleService.upsertSteps.mockResolvedValue(slot);
    scheduleService.moveSlot.mockResolvedValue(slot);

    await expect(
      controller.createSlot('user-1', {
        dayOfWeek: 'mon',
        slotTime: '08:30',
      }),
    ).resolves.toMatchObject({ id: 'slot-1', slotTime: '08:30' });
    await expect(
      controller.updateSlot('user-1', 'slot-1', { slotTime: '09:00' }),
    ).resolves.toMatchObject({ id: 'slot-1' });
    await expect(
      controller.upsertSteps('user-1', 'slot-1', { steps: [] }),
    ).resolves.toMatchObject({ id: 'slot-1' });
    await expect(
      controller.moveSlot('user-1', 'slot-1', {
        toDay: 'wed',
        toTime: '20:00',
      }),
    ).resolves.toMatchObject({ id: 'slot-1' });

    expect(scheduleService.createSlot).toHaveBeenCalledWith('user-1', {
      dayOfWeek: 'mon',
      slotTime: '08:30',
    });
    expect(scheduleService.updateSlot).toHaveBeenCalledWith(
      'user-1',
      'slot-1',
      { slotTime: '09:00' },
    );
    expect(scheduleService.upsertSteps).toHaveBeenCalledWith(
      'user-1',
      'slot-1',
      { steps: [] },
    );
    expect(scheduleService.moveSlot).toHaveBeenCalledWith('user-1', 'slot-1', {
      toDay: 'wed',
      toTime: '20:00',
    });
  });

  it('returns schedule responses for batch creation and presets', async () => {
    const slots = [createSlot()];
    scheduleService.createSlots.mockResolvedValue(slots);
    scheduleService.applyEveryDayPreset.mockResolvedValue(slots);

    await expect(
      controller.createSlots('user-1', 'Europe/Stockholm', undefined, {
        daysOfWeek: ['mon', 'wed'],
        slotTime: '08:30',
      }),
    ).resolves.toMatchObject({
      timeZone: 'Europe/Stockholm',
      slots: [{ id: 'slot-1' }],
    });
    await expect(
      controller.applyPreset('user-1', null, 'Europe/Stockholm', {
        preset: 'every_day',
        slotTime: '21:00',
      }),
    ).resolves.toMatchObject({
      timeZone: 'Europe/Stockholm',
      slots: [{ id: 'slot-1' }],
    });

    expect(scheduleService.createSlots).toHaveBeenCalledWith('user-1', {
      daysOfWeek: ['mon', 'wed'],
      slotTime: '08:30',
    });
    expect(scheduleService.applyEveryDayPreset).toHaveBeenCalledWith('user-1', {
      preset: 'every_day',
      slotTime: '21:00',
    });
  });

  it('deletes slots through the service', async () => {
    scheduleService.deleteSlot.mockResolvedValue(undefined);

    await expect(controller.deleteSlot('user-1', 'slot-1')).resolves.toBe(
      undefined,
    );

    expect(scheduleService.deleteSlot).toHaveBeenCalledWith('user-1', 'slot-1');
  });
});
