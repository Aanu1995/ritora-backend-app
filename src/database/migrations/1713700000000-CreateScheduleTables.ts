import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScheduleTables1713700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "schedule_slots" (
        "id" varchar(26) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "day_of_week" varchar(10) NOT NULL,
        "slot_time" time NOT NULL,
        "mode" varchar(10) NOT NULL DEFAULT 'ai',
        "slot_notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_schedule_slots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_schedule_slots_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_schedule_slots_day" CHECK (
          "day_of_week" IN ('mon','tue','wed','thu','fri','sat','sun')
        ),
        CONSTRAINT "CK_schedule_slots_mode" CHECK (
          "mode" IN ('manual','ai')
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_schedule_slots_user_day_time"
        ON "schedule_slots" ("user_id", "day_of_week", "slot_time")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_schedule_slots_user_day"
        ON "schedule_slots" ("user_id", "day_of_week")
    `);

    await queryRunner.query(`
      CREATE TABLE "routine_steps" (
        "id" varchar(26) NOT NULL,
        "slot_id" varchar(26) NOT NULL,
        "step_order" integer NOT NULL,
        "inventory_product_id" varchar(26),
        "step_label" varchar(30) NOT NULL,
        "custom_label" varchar(100),
        "notes" text,
        "optional" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routine_steps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_routine_steps_slot" FOREIGN KEY ("slot_id")
          REFERENCES "schedule_slots" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_routine_steps_product" FOREIGN KEY ("inventory_product_id")
          REFERENCES "inventory_products" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_routine_steps_slot_order"
        ON "routine_steps" ("slot_id", "step_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "routine_steps"`);
    await queryRunner.query(`DROP TABLE "schedule_slots"`);
  }
}
