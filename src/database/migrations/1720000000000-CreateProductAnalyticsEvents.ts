import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductAnalyticsEvents1720000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_analytics_events" (
        "idempotency_key" varchar(180) PRIMARY KEY,
        "event_type" varchar(64) NOT NULL,
        "user_id" varchar(26) NOT NULL,
        "source_entity_id" varchar(64),
        "occurred_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_product_analytics_events_user"
          FOREIGN KEY ("user_id")
          REFERENCES "users"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_analytics_events_type_time_user"
      ON "product_analytics_events" ("event_type", "occurred_at", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_product_analytics_events_user_type"
      ON "product_analytics_events" ("user_id", "event_type")
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION record_product_analytics_event(
        p_event_type varchar,
        p_user_id varchar,
        p_source_entity_id varchar,
        p_occurred_at timestamptz
      )
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF p_event_type IS NULL OR p_user_id IS NULL THEN
          RETURN;
        END IF;

        INSERT INTO product_analytics_events (
          idempotency_key,
          event_type,
          user_id,
          source_entity_id,
          occurred_at
        )
        VALUES (
          concat(p_event_type, ':', p_user_id, ':', COALESCE(p_source_entity_id, 'account')),
          p_event_type,
          p_user_id,
          p_source_entity_id,
          COALESCE(p_occurred_at, now())
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
      END;
      $$;
    `);

    await this.backfillEvents(queryRunner);
    await this.createTriggers(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_smart_pick_products" ON "smart_pick_product_suggestions"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_smart_pick_snapshots" ON "smart_pick_snapshots"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_notification_preferences" ON "user_notification_preferences"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_journal_entries" ON "skin_journal_entries"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_application_logs" ON "application_logs"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_suggestions" ON "suggestion_instances"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_schedule_slots" ON "schedule_slots"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_inventory_products" ON "inventory_products"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_skin_profiles" ON "skin_profiles"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_users" ON "users"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_smart_pick_products_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_smart_pick_snapshots_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_notification_preferences_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_journal_entries_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_application_logs_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_suggestions_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_schedule_slots_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_inventory_products_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_skin_profiles_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "product_analytics_users_trigger"()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "record_product_analytics_event"(varchar, varchar, varchar, timestamptz)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_analytics_events_user_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_product_analytics_events_type_time_user"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "product_analytics_events"`);
  }

  private async backfillEvents(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('account_created:', id, ':', id), 'account_created', id, id, created_at
      FROM users
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('email_verified:', id, ':', id), 'email_verified', id, id, updated_at
      FROM users
      WHERE email_verified = true
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('skin_profile_created:', user_id, ':', id), 'skin_profile_created', user_id, id, created_at
      FROM skin_profiles
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('inventory_product_created:', user_id, ':', id), 'inventory_product_created', user_id, id, created_at
      FROM inventory_products
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('schedule_slot_created:', user_id, ':', id), 'schedule_slot_created', user_id, id, created_at
      FROM schedule_slots
      WHERE deleted_at IS NULL
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('suggestion_generated:', user_id, ':', id), 'suggestion_generated', user_id, id, COALESCE(generated_at, updated_at)
      FROM suggestion_instances
      WHERE generation_status = 'ready'
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('routine_logged:', user_id, ':', id), 'routine_logged', user_id, id, COALESCE(applied_at, first_recorded_at, created_at)
      FROM application_logs
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('journal_check_in_created:', user_id, ':', id), 'journal_check_in_created', user_id, id, created_at
      FROM skin_journal_entries
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('notification_preferences_enabled:', user_id, ':', id), 'notification_preferences_enabled', user_id, id, created_at
      FROM user_notification_preferences
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('smart_pick_snapshot_generated:', user_id, ':', id), 'smart_pick_snapshot_generated', user_id, id, generated_at
      FROM smart_pick_snapshots
      ON CONFLICT (idempotency_key) DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO product_analytics_events (
        idempotency_key,
        event_type,
        user_id,
        source_entity_id,
        occurred_at
      )
      SELECT concat('smart_pick_product_generated:', user_id, ':', id), 'smart_pick_product_generated', user_id, id, created_at
      FROM smart_pick_product_suggestions
      ON CONFLICT (idempotency_key) DO NOTHING
    `);
  }

  private async createTriggers(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION product_analytics_users_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          PERFORM record_product_analytics_event('account_created', NEW.id, NEW.id, NEW.created_at);
          IF NEW.email_verified = true THEN
            PERFORM record_product_analytics_event('email_verified', NEW.id, NEW.id, NEW.updated_at);
          END IF;
        ELSIF TG_OP = 'UPDATE'
          AND NEW.email_verified = true
          AND COALESCE(OLD.email_verified, false) = false THEN
          PERFORM record_product_analytics_event('email_verified', NEW.id, NEW.id, NEW.updated_at);
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_users" ON "users"`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "trg_product_analytics_users" AFTER INSERT OR UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION product_analytics_users_trigger()`,
    );

    await this.createInsertTrigger(
      queryRunner,
      'skin_profiles',
      'skin_profile_created',
      'product_analytics_skin_profiles_trigger',
      'trg_product_analytics_skin_profiles',
    );
    await this.createInsertTrigger(
      queryRunner,
      'inventory_products',
      'inventory_product_created',
      'product_analytics_inventory_products_trigger',
      'trg_product_analytics_inventory_products',
    );
    await this.createInsertTrigger(
      queryRunner,
      'application_logs',
      'routine_logged',
      'product_analytics_application_logs_trigger',
      'trg_product_analytics_application_logs',
      'COALESCE(NEW.applied_at, NEW.first_recorded_at, NEW.created_at)',
    );
    await this.createInsertTrigger(
      queryRunner,
      'skin_journal_entries',
      'journal_check_in_created',
      'product_analytics_journal_entries_trigger',
      'trg_product_analytics_journal_entries',
    );
    await this.createInsertTrigger(
      queryRunner,
      'user_notification_preferences',
      'notification_preferences_enabled',
      'product_analytics_notification_preferences_trigger',
      'trg_product_analytics_notification_preferences',
    );
    await this.createInsertTrigger(
      queryRunner,
      'smart_pick_snapshots',
      'smart_pick_snapshot_generated',
      'product_analytics_smart_pick_snapshots_trigger',
      'trg_product_analytics_smart_pick_snapshots',
      'NEW.generated_at',
    );
    await this.createInsertTrigger(
      queryRunner,
      'smart_pick_product_suggestions',
      'smart_pick_product_generated',
      'product_analytics_smart_pick_products_trigger',
      'trg_product_analytics_smart_pick_products',
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION product_analytics_schedule_slots_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.deleted_at IS NULL THEN
          PERFORM record_product_analytics_event('schedule_slot_created', NEW.user_id, NEW.id, NEW.created_at);
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_schedule_slots" ON "schedule_slots"`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "trg_product_analytics_schedule_slots" AFTER INSERT ON "schedule_slots" FOR EACH ROW EXECUTE FUNCTION product_analytics_schedule_slots_trigger()`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION product_analytics_suggestions_trigger()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.generation_status = 'ready'
          AND (TG_OP = 'INSERT' OR OLD.generation_status IS DISTINCT FROM NEW.generation_status) THEN
          PERFORM record_product_analytics_event(
            'suggestion_generated',
            NEW.user_id,
            NEW.id,
            COALESCE(NEW.generated_at, NEW.updated_at, now())
          );
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_product_analytics_suggestions" ON "suggestion_instances"`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "trg_product_analytics_suggestions" AFTER INSERT OR UPDATE ON "suggestion_instances" FOR EACH ROW EXECUTE FUNCTION product_analytics_suggestions_trigger()`,
    );
  }

  private async createInsertTrigger(
    queryRunner: QueryRunner,
    tableName: string,
    eventType: string,
    functionName: string,
    triggerName: string,
    occurredAtExpression = 'NEW.created_at',
  ): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION ${functionName}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM record_product_analytics_event(
          '${eventType}',
          NEW.user_id,
          NEW.id,
          ${occurredAtExpression}
        );

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "${tableName}"`,
    );
    await queryRunner.query(
      `CREATE TRIGGER "${triggerName}" AFTER INSERT ON "${tableName}" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
  }
}
