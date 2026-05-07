import { getMetadataArgsStorage } from 'typeorm';
import type { ValueTransformer } from 'typeorm';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';

describe('schedule entity encryption', () => {
  it('encrypts user-authored schedule and routine notes', () => {
    const slotNotesTransformer = getColumnTransformer(
      ScheduleSlot,
      'slot_notes',
    );
    const stepNotesTransformer = getColumnTransformer(RoutineStep, 'notes');

    const storedSlotNote = slotNotesTransformer.to('Use only on damp skin.');
    const storedStepNote = stepNotesTransformer.to('Specialist note.');

    expect(storedSlotNote).toEqual(expect.stringMatching(/^ritora:v1:/));
    expect(storedStepNote).toEqual(expect.stringMatching(/^ritora:v1:/));
    expect(slotNotesTransformer.from(storedSlotNote)).toBe(
      'Use only on damp skin.',
    );
    expect(stepNotesTransformer.from(storedStepNote)).toBe('Specialist note.');
  });

  it('rejects plaintext schedule and routine notes after migration', () => {
    expect(() =>
      getColumnTransformer(ScheduleSlot, 'slot_notes').from('Gym day'),
    ).toThrow(
      'Unencrypted skin profile string field schedule_slots.slot_notes',
    );
    expect(() =>
      getColumnTransformer(RoutineStep, 'notes').from('Use pea size'),
    ).toThrow('Unencrypted skin profile string field routine_steps.notes');
  });
});

function getColumnTransformer(
  target: typeof ScheduleSlot | typeof RoutineStep,
  propertyName: string,
): ValueTransformer {
  const column = getMetadataArgsStorage().columns.find(
    (candidate) =>
      candidate.target === target && candidate.propertyName === propertyName,
  );
  const transformer = column?.options.transformer;

  if (!transformer || Array.isArray(transformer)) {
    throw new Error(`Missing transformer for ${propertyName}`);
  }

  return transformer;
}
