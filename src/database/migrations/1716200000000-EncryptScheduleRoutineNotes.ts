import { MigrationInterface, QueryRunner } from 'typeorm';
import type { ValueTransformer } from 'typeorm';
import { encryptedNullableStringFieldTransformer } from '../../skin-profile/skin-profile-field-encryption';

type ScheduleNoteRow = {
  id: string;
  slot_notes: unknown;
};

type RoutineStepNoteRow = {
  id: string;
  notes: unknown;
};

const slotNotesTransformer = encryptedNullableStringFieldTransformer(
  'schedule_slots.slot_notes',
);
const stepNotesTransformer = encryptedNullableStringFieldTransformer(
  'routine_steps.notes',
);

export class EncryptScheduleRoutineNotes1716200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await encryptScheduleSlotNotes(queryRunner);
    await encryptRoutineStepNotes(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await decryptScheduleSlotNotes(queryRunner);
    await decryptRoutineStepNotes(queryRunner);
  }
}

async function encryptScheduleSlotNotes(
  queryRunner: QueryRunner,
): Promise<void> {
  const rows = await queryRows<ScheduleNoteRow>(
    queryRunner,
    `SELECT "id", "slot_notes" FROM "schedule_slots" WHERE "slot_notes" IS NOT NULL`,
  );

  for (const row of rows) {
    await queryRunner.query(
      `UPDATE "schedule_slots" SET "slot_notes" = $1 WHERE "id" = $2`,
      [encryptStoredValue(slotNotesTransformer, row.slot_notes), row.id],
    );
  }
}

async function encryptRoutineStepNotes(
  queryRunner: QueryRunner,
): Promise<void> {
  const rows = await queryRows<RoutineStepNoteRow>(
    queryRunner,
    `SELECT "id", "notes" FROM "routine_steps" WHERE "notes" IS NOT NULL`,
  );

  for (const row of rows) {
    await queryRunner.query(
      `UPDATE "routine_steps" SET "notes" = $1 WHERE "id" = $2`,
      [encryptStoredValue(stepNotesTransformer, row.notes), row.id],
    );
  }
}

async function decryptScheduleSlotNotes(
  queryRunner: QueryRunner,
): Promise<void> {
  const rows = await queryRows<ScheduleNoteRow>(
    queryRunner,
    `SELECT "id", "slot_notes" FROM "schedule_slots" WHERE "slot_notes" IS NOT NULL`,
  );

  for (const row of rows) {
    await queryRunner.query(
      `UPDATE "schedule_slots" SET "slot_notes" = $1 WHERE "id" = $2`,
      [decryptStoredValue(slotNotesTransformer, row.slot_notes), row.id],
    );
  }
}

async function decryptRoutineStepNotes(
  queryRunner: QueryRunner,
): Promise<void> {
  const rows = await queryRows<RoutineStepNoteRow>(
    queryRunner,
    `SELECT "id", "notes" FROM "routine_steps" WHERE "notes" IS NOT NULL`,
  );

  for (const row of rows) {
    await queryRunner.query(
      `UPDATE "routine_steps" SET "notes" = $1 WHERE "id" = $2`,
      [decryptStoredValue(stepNotesTransformer, row.notes), row.id],
    );
  }
}

async function queryRows<T>(
  queryRunner: QueryRunner,
  sql: string,
): Promise<T[]> {
  const result: unknown = await queryRunner.query(sql);
  return Array.isArray(result) ? (result as T[]) : [];
}

function encryptStoredValue(
  transformer: ValueTransformer,
  value: unknown,
): unknown {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  return transformer.to(value);
}

function decryptStoredValue(
  transformer: ValueTransformer,
  value: unknown,
): unknown {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  try {
    return transformer.from(value);
  } catch {
    return value;
  }
}
