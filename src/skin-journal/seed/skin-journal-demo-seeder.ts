import { hash } from 'bcrypt';
import { DataSource, IsNull, Repository } from 'typeorm';
import { UserConsent } from '../../users/entities/user-consent.entity';
import { User } from '../../users/entities/user.entity';
import { UserConsentType } from '../../users/user-consent.constants';
import { InAppNotification } from '../../notifications/entities/in-app-notification.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { RoutineSimplificationEvent } from '../entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../entities/skin-journal-entry.entity';
import { SkinJournalEvent } from '../entities/skin-journal-event.entity';
import { SkinJournalExportJob } from '../entities/skin-journal-export-job.entity';
import { SkinJournalInsight } from '../entities/skin-journal-insight.entity';
import { SkinJournalWrapped } from '../entities/skin-journal-wrapped.entity';
import { SKIN_JOURNAL_REMINDER_DEFAULT_TIME } from '../skin-journal.constants';
import {
  buildSkinJournalDemoData,
  SKIN_JOURNAL_DEMO_EMAIL,
  SKIN_JOURNAL_DEMO_PASSWORD,
  type SkinJournalDemoData,
  type SkinJournalDemoEntrySeed,
} from './skin-journal-demo-data';
import {
  removeDemoPhotoDirectory,
  writeDemoPhotoFile,
} from './skin-journal-demo-media';
import { deleteUserRowsIfTableExists } from './skin-journal-demo-reset';

type SkinJournalDemoSeederOptions = {
  email?: string;
  password?: string;
  anchorDate?: string;
  timeZone?: string;
};

type SeededEntryLookup = Map<string, SkinJournalEntry>;

export class SkinJournalDemoSeeder {
  private readonly users: Repository<User>;
  private readonly consents: Repository<UserConsent>;
  private readonly entries: Repository<SkinJournalEntry>;
  private readonly events: Repository<SkinJournalEvent>;
  private readonly insights: Repository<SkinJournalInsight>;
  private readonly simplifications: Repository<RoutineSimplificationEvent>;
  private readonly wrapped: Repository<SkinJournalWrapped>;
  private readonly exportJobs: Repository<SkinJournalExportJob>;
  private readonly notifications: Repository<InAppNotification>;
  private readonly preferences: Repository<UserNotificationPreference>;

  constructor(private readonly dataSource: DataSource) {
    this.users = dataSource.getRepository(User);
    this.consents = dataSource.getRepository(UserConsent);
    this.entries = dataSource.getRepository(SkinJournalEntry);
    this.events = dataSource.getRepository(SkinJournalEvent);
    this.insights = dataSource.getRepository(SkinJournalInsight);
    this.simplifications = dataSource.getRepository(RoutineSimplificationEvent);
    this.wrapped = dataSource.getRepository(SkinJournalWrapped);
    this.exportJobs = dataSource.getRepository(SkinJournalExportJob);
    this.notifications = dataSource.getRepository(InAppNotification);
    this.preferences = dataSource.getRepository(UserNotificationPreference);
  }

  async run(options: SkinJournalDemoSeederOptions = {}): Promise<{
    user: User;
    entryCount: number;
    notificationCount: number;
  }> {
    const email = (
      options.email ??
      process.env.SKIN_JOURNAL_SEED_EMAIL ??
      SKIN_JOURNAL_DEMO_EMAIL
    )
      .trim()
      .toLowerCase();
    const password =
      options.password ??
      process.env.SKIN_JOURNAL_SEED_PASSWORD ??
      SKIN_JOURNAL_DEMO_PASSWORD;
    const timeZone =
      options.timeZone ??
      process.env.SKIN_JOURNAL_SEED_TIME_ZONE ??
      'Europe/Stockholm';
    const anchorDate =
      options.anchorDate ??
      process.env.SKIN_JOURNAL_SEED_ANCHOR_DATE ??
      new Date().toISOString().slice(0, 10);

    const user = await this.ensureDemoUser(email, password, timeZone);
    const seed = buildSkinJournalDemoData({ anchorDate, timeZone });

    await this.resetSeededData(user.id);
    await this.ensureConsent(user.id, UserConsentType.SkinProgressProcessing);
    await this.ensureNotificationPreferences(user.id);

    const entryLookup = await this.seedEntries(user.id, seed);
    const eventLookup = await this.seedEvents(user.id, seed, entryLookup);
    await this.seedSimplification(user.id, seed, eventLookup);
    await this.seedInsights(user.id, seed, entryLookup);
    await this.seedNotifications(user.id, seed);

    return {
      user,
      entryCount: seed.entries.length,
      notificationCount: seed.notifications.length,
    };
  }

  private async ensureDemoUser(
    email: string,
    password: string,
    timeZone: string,
  ): Promise<User> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      existing.email_verified = true;
      existing.time_zone = timeZone;
      return this.users.save(existing);
    }

    const passwordHash = await hash(
      password,
      Number(process.env.BCRYPT_SALT_ROUNDS ?? 12),
    );
    const user = this.users.create({
      email,
      password_hash: passwordHash,
      first_name: 'Maya',
      last_name: 'Demo',
      preferred_language: 'en',
      email_verified: true,
      time_zone: timeZone,
      date_of_birth: null,
      sex_at_birth: null,
      email_verification_token_hash: null,
      email_verification_expires: null,
      password_reset_token_hash: null,
      password_reset_expires: null,
    });

    const saved = await this.users.save(user);
    await this.ensureConsent(saved.id, UserConsentType.TermsOfService);
    await this.ensureConsent(saved.id, UserConsentType.PrivacyPolicy);
    return saved;
  }

  private async ensureConsent(
    userId: string,
    consentType: UserConsentType,
  ): Promise<void> {
    const existing = await this.consents.findOne({
      where: {
        user_id: userId,
        consent_type: consentType,
        granted: true,
        revoked_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });
    if (existing) {
      return;
    }

    await this.consents.save(
      this.consents.create({
        user_id: userId,
        consent_type: consentType,
        consent_version: 'demo-seed',
        granted: true,
        granted_at: new Date(),
        revoked_at: null,
        ip_address: null,
      }),
    );
  }

  private async ensureNotificationPreferences(userId: string): Promise<void> {
    const existing = await this.preferences.findOne({
      where: { user_id: userId },
    });
    const preference = existing ?? this.preferences.create({ user_id: userId });
    preference.photo_reminder_local_time = SKIN_JOURNAL_REMINDER_DEFAULT_TIME;
    preference.photo_reminder_enabled = true;
    preference.channels = ['in_app'];
    preference.reaction_alerts_enabled = true;
    preference.simplification_alerts_enabled = true;
    preference.insight_alerts_enabled = true;
    preference.wrapped_alerts_enabled = true;
    preference.photo_tutorial_completed = true;
    await this.preferences.save(preference);
  }

  private async resetSeededData(userId: string): Promise<void> {
    await this.deleteUserRows('in_app_notifications', () =>
      this.notifications.delete({ user_id: userId }),
    );
    await this.deleteUserRows('routine_simplification_events', () =>
      this.simplifications.delete({ user_id: userId }),
    );
    await this.deleteUserRows(
      'skin_journal_export_jobs',
      () => this.exportJobs.delete({ user_id: userId }),
      { required: false },
    );
    await this.deleteUserRows(
      'skin_journal_wrapped',
      () => this.wrapped.delete({ user_id: userId }),
      { required: false },
    );
    await this.deleteUserRows('skin_journal_insights', () =>
      this.insights.delete({ user_id: userId }),
    );
    await this.deleteUserRows('skin_journal_events', () =>
      this.events.delete({ user_id: userId }),
    );
    await this.deleteUserRows('skin_journal_entries', () =>
      this.entries.delete({ user_id: userId }),
    );
    await removeDemoPhotoDirectory(userId);
  }

  private async seedEntries(
    userId: string,
    seed: SkinJournalDemoData,
  ): Promise<SeededEntryLookup> {
    const lookup: SeededEntryLookup = new Map();
    for (const entrySeed of seed.entries) {
      const entry = await this.entries.save(
        this.entries.create({
          user_id: userId,
          entry_date: entrySeed.entryDate,
          time_zone: entrySeed.timeZone,
          photo_object_key: null,
          photo_width: null,
          photo_height: null,
          photo_size: null,
          photo_content_type: null,
          exif_stripped: false,
          angle: 'head_on',
          concern_focus: ['redness', 'texture', 'irritation'],
          is_pre_routine: true,
          ratings: entrySeed.ratings,
          overall_feel: entrySeed.overallFeel,
          sleep_band: entrySeed.sleepBand,
          stress_today: entrySeed.stressToday,
          sun_exposure_today: entrySeed.sunExposureToday,
          sweat_exercise_today: entrySeed.sweatExerciseToday,
          cycle_marker: 'dont_track',
          recent_change: entrySeed.recentChange,
          complaint_note: entrySeed.complaintNote,
          analysis_status: entrySeed.analysisStatus,
          analysis_observations: entrySeed.analysis,
          analysis_summary: entrySeed.analysisSummary,
          analysis_model: entrySeed.analysis ? 'demo-seed' : null,
          analysis_version: entrySeed.analysis?.schema_version ?? null,
          analysis_prompt_version: entrySeed.analysis
            ? 'skin-journal-demo-seed'
            : null,
          analysis_error:
            entrySeed.analysisStatus === 'failed'
              ? 'Demo failed analysis state for retry UI.'
              : null,
          analysis_started_at:
            entrySeed.analysisStatus === 'completed' ||
            entrySeed.analysisStatus === 'needs_review'
              ? dateAtHour(entrySeed.entryDate, 17)
              : null,
          analysis_completed_at:
            entrySeed.analysisStatus === 'completed' ||
            entrySeed.analysisStatus === 'needs_review'
              ? dateAtHour(entrySeed.entryDate, 18)
              : null,
          analysis_duration_ms: entrySeed.analysis ? 1200 : null,
          analysis_input_image_count: entrySeed.analysis ? 1 : null,
          analysis_input_tokens: null,
          analysis_output_tokens: null,
          analysis_total_tokens: null,
          analysis_estimated_cost_usd: null,
          analysis_retry_count: entrySeed.analysisStatus === 'failed' ? 1 : 0,
        }),
      );

      if (entrySeed.hasPhoto) {
        await this.attachLocalPhoto(userId, entry, entrySeed);
      }

      lookup.set(entrySeed.key, entry);
    }
    return lookup;
  }

  private async attachLocalPhoto(
    userId: string,
    entry: SkinJournalEntry,
    seed: SkinJournalDemoEntrySeed,
  ): Promise<void> {
    const photo = await writeDemoPhotoFile({
      userId,
      entryId: entry.id,
      tone: seed.photoTone,
      label: seed.entryDate,
    });

    entry.photo_object_key = photo.objectKey;
    entry.photo_width = photo.width;
    entry.photo_height = photo.height;
    entry.photo_size = photo.size;
    entry.photo_content_type = photo.contentType;
    entry.exif_stripped = true;
    await this.entries.save(entry);
  }

  private async seedEvents(
    userId: string,
    seed: SkinJournalDemoData,
    entries: SeededEntryLookup,
  ): Promise<Map<string, SkinJournalEvent>> {
    const lookup = new Map<string, SkinJournalEvent>();
    for (const eventSeed of seed.events) {
      const entry = requiredEntry(entries, eventSeed.entryKey);
      const event = await this.events.save(
        this.events.create({
          user_id: userId,
          entry_id: entry.id,
          kind: eventSeed.kind,
          severity: eventSeed.severity,
          payload: eventSeed.payload,
          acknowledged_at: eventSeed.acknowledged
            ? dateAtHour(entry.entry_date, 20)
            : null,
        }),
      );
      lookup.set(`${eventSeed.entryKey}:${eventSeed.kind}`, event);
    }
    return lookup;
  }

  private async seedSimplification(
    userId: string,
    seed: SkinJournalDemoData,
    events: Map<string, SkinJournalEvent>,
  ): Promise<void> {
    const trigger =
      events.get(
        `${seed.simplification.triggeredByEntryKey}:reaction_detected`,
      ) ?? null;
    await this.simplifications.save(
      this.simplifications.create({
        user_id: userId,
        triggered_by_event_id: trigger?.id ?? null,
        ended_at: null,
        original_schedule_snapshot: {
          captured_at: new Date().toISOString(),
          slots: [],
        },
        simplification_mode: seed.simplification.simplification_mode,
        reason: seed.simplification.reason,
        acknowledged_at: null,
        restore_strategy: seed.simplification.restore_strategy,
      }),
    );
  }

  private async seedInsights(
    userId: string,
    seed: SkinJournalDemoData,
    entries: SeededEntryLookup,
  ): Promise<void> {
    for (const insightSeed of seed.insights) {
      const relatedEntryIds = insightSeed.relatedEntryKeys.map(
        (key) => requiredEntry(entries, key).id,
      );
      await this.insights.save(
        this.insights.create({
          user_id: userId,
          kind: insightSeed.kind,
          summary: insightSeed.summary,
          supporting_data: insightSeed.supportingData,
          related_entry_ids: relatedEntryIds,
          severity: insightSeed.severity,
          seen_at: insightSeed.seen ? new Date() : null,
          dismissed_at: insightSeed.dismissed ? new Date() : null,
        }),
      );
    }
  }

  private async seedNotifications(
    userId: string,
    seed: SkinJournalDemoData,
  ): Promise<void> {
    for (const notificationSeed of seed.notifications) {
      await this.notifications.save(
        this.notifications.create({
          user_id: userId,
          kind: notificationSeed.kind,
          title_key: notificationSeed.titleKey,
          body_key: notificationSeed.bodyKey,
          payload: notificationSeed.payload,
          severity: notificationSeed.severity,
          deep_link: notificationSeed.deepLink,
          read_at: notificationSeed.read ? new Date() : null,
        }),
      );
    }
  }

  private async deleteUserRows(
    tableName: string,
    deleteRows: () => Promise<unknown>,
    options: { required?: boolean } = {},
  ): Promise<void> {
    await deleteUserRowsIfTableExists(
      this.dataSource,
      tableName,
      deleteRows,
      options,
    );
  }
}

function requiredEntry(
  entries: SeededEntryLookup,
  key: string,
): SkinJournalEntry {
  const entry = entries.get(key);
  if (!entry) {
    throw new Error(`Missing demo entry for key ${key}`);
  }
  return entry;
}

function dateAtHour(date: string, hour: number): Date {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

export function demoSeedCredentials(): {
  email: string;
  password: string;
} {
  return {
    email:
      process.env.SKIN_JOURNAL_SEED_EMAIL?.trim().toLowerCase() ??
      SKIN_JOURNAL_DEMO_EMAIL,
    password:
      process.env.SKIN_JOURNAL_SEED_PASSWORD ?? SKIN_JOURNAL_DEMO_PASSWORD,
  };
}
