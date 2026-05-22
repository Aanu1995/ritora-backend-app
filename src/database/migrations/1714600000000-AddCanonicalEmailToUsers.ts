import { MigrationInterface, QueryRunner } from 'typeorm';

type DuplicateCanonicalEmailCountRow = {
  duplicate_group_count: string | number;
};

export class AddCanonicalEmailToUsers1714600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD "canonical_email" varchar(255)
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "canonical_email" = CASE
        WHEN split_part(LOWER(TRIM("email")), '@', 2) IN ('gmail.com', 'googlemail.com')
          THEN replace(
            regexp_replace(split_part(LOWER(TRIM("email")), '@', 1), '\\+.*$', ''),
            '.',
            ''
          ) || '@gmail.com'
        ELSE regexp_replace(split_part(LOWER(TRIM("email")), '@', 1), '\\+.*$', '')
          || '@'
          || split_part(LOWER(TRIM("email")), '@', 2)
      END
    `);

    const duplicateRows = (await queryRunner.query(`
      SELECT COUNT(*) AS "duplicate_group_count"
      FROM (
        SELECT "canonical_email"
        FROM "users"
        GROUP BY "canonical_email"
        HAVING COUNT(*) > 1
      ) "duplicate_groups"
    `)) as DuplicateCanonicalEmailCountRow[];
    const duplicateGroupCount = Number(
      duplicateRows[0]?.duplicate_group_count ?? 0,
    );

    if (duplicateGroupCount > 0) {
      throw new Error(
        'Cannot add canonical email uniqueness while duplicate email identities exist. Resolve duplicate user accounts before rerunning this migration.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "canonical_email" SET NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_users_canonical_email"
      ON "users" ("canonical_email")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_users_canonical_email"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "canonical_email"`,
    );
  }
}
