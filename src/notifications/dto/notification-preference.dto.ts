import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_VALUES,
  NotificationChannel,
  NotificationChannelValue,
  UserNotificationPreference,
} from '../entities/user-notification-preference.entity';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';
import {
  INSIGHT_CADENCE_DEFAULT,
  INSIGHT_CADENCE_VALUES,
  INSIGHT_DIGEST_DAY_DEFAULT,
  INSIGHT_DIGEST_DAY_MAX,
  INSIGHT_DIGEST_DAY_MIN,
  INSIGHT_DIGEST_LOCAL_TIME_DEFAULT,
  PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT,
  PRODUCT_EXPIRY_NOTICE_DAYS_MAX,
  PRODUCT_EXPIRY_NOTICE_DAYS_MIN,
  type InsightCadence,
} from '../notifications.constants';

export const SUGGESTION_LEAD_TIME_MIN_MINUTES = 30;
export const SUGGESTION_LEAD_TIME_MAX_MINUTES = 720;
export const SUGGESTION_LEAD_TIME_DEFAULT_MINUTES = 120;

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdatePreferencesDto {
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  photo_reminder_local_time?: string;

  @IsOptional()
  @IsBoolean()
  photo_reminder_enabled?: boolean;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  channels?: NotificationChannel[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  reaction_alert_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() reaction_alerts_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  simplification_alert_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() simplification_alerts_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  insight_alert_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() insight_alerts_enabled?: boolean;
  @IsOptional()
  @IsIn(INSIGHT_CADENCE_VALUES)
  insight_cadence?: InsightCadence;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(INSIGHT_DIGEST_DAY_MIN)
  @Max(INSIGHT_DIGEST_DAY_MAX)
  insight_digest_day?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  insight_digest_local_time?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  wrapped_alert_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() wrapped_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() photo_tutorial_completed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  suggestion_ready_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() suggestion_ready_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  smart_pick_ready_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() smart_pick_ready_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  slot_start_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() slot_start_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  recording_reminder_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() recording_reminder_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(NOTIFICATION_CHANNEL_VALUES, { each: true })
  product_expiry_alert_channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() product_expiry_alerts_enabled?: boolean;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(PRODUCT_EXPIRY_NOTICE_DAYS_MIN)
  @Max(PRODUCT_EXPIRY_NOTICE_DAYS_MAX)
  product_expiry_notice_days?: number;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsInt()
  @Min(SUGGESTION_LEAD_TIME_MIN_MINUTES)
  @Max(SUGGESTION_LEAD_TIME_MAX_MINUTES)
  suggestion_lead_time_minutes?: number;

  @IsOptional() @IsBoolean() quiet_hours_enabled?: boolean;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  quiet_hours_start?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  quiet_hours_end?: string;
}

export class PreferencesResponseDto {
  @ApiProperty()
  photo_reminder_local_time: string;

  @ApiProperty()
  photo_reminder_enabled: boolean;

  @ApiProperty({ type: [String] })
  channels: NotificationChannel[];

  @ApiPropertyOptional({ type: [String] })
  reaction_alert_channels: NotificationChannel[];

  @ApiProperty()
  reaction_alerts_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  simplification_alert_channels: NotificationChannel[];

  @ApiProperty()
  simplification_alerts_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  insight_alert_channels: NotificationChannel[];

  @ApiProperty()
  insight_alerts_enabled: boolean;

  @ApiProperty({ enum: INSIGHT_CADENCE_VALUES })
  insight_cadence: InsightCadence;

  @ApiProperty({
    minimum: INSIGHT_DIGEST_DAY_MIN,
    maximum: INSIGHT_DIGEST_DAY_MAX,
  })
  insight_digest_day: number;

  @ApiProperty()
  insight_digest_local_time: string;

  @ApiPropertyOptional({ type: [String] })
  wrapped_alert_channels: NotificationChannel[];

  @ApiProperty()
  wrapped_alerts_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  suggestion_ready_channels: NotificationChannel[];

  @ApiProperty()
  suggestion_ready_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  smart_pick_ready_channels: NotificationChannel[];

  @ApiProperty()
  smart_pick_ready_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  slot_start_channels: NotificationChannel[];

  @ApiProperty()
  slot_start_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  recording_reminder_channels: NotificationChannel[];

  @ApiProperty()
  recording_reminder_enabled: boolean;

  @ApiPropertyOptional({ type: [String] })
  product_expiry_alert_channels: NotificationChannel[];

  @ApiProperty()
  product_expiry_alerts_enabled: boolean;

  @ApiProperty({
    minimum: PRODUCT_EXPIRY_NOTICE_DAYS_MIN,
    maximum: PRODUCT_EXPIRY_NOTICE_DAYS_MAX,
  })
  product_expiry_notice_days: number;

  @ApiProperty({
    minimum: SUGGESTION_LEAD_TIME_MIN_MINUTES,
    maximum: SUGGESTION_LEAD_TIME_MAX_MINUTES,
  })
  suggestion_lead_time_minutes: number;

  @ApiProperty()
  quiet_hours_enabled: boolean;

  @ApiProperty()
  quiet_hours_start: string;

  @ApiProperty()
  quiet_hours_end: string;

  @ApiProperty()
  photo_tutorial_completed: boolean;

  static fromEntity(p: UserNotificationPreference): PreferencesResponseDto {
    const dto = new PreferencesResponseDto();
    dto.photo_reminder_local_time = normalizeHhmm(
      p.photo_reminder_local_time,
      '00:00',
    );
    dto.photo_reminder_enabled = p.photo_reminder_enabled;
    dto.channels = normalizeChannels(p.channels, DEFAULT_NOTIFICATION_CHANNELS);
    dto.reaction_alert_channels = normalizeSpecificChannels(
      p.reaction_alert_channels,
      dto.channels,
      dto.channels,
    );
    dto.reaction_alerts_enabled = p.reaction_alerts_enabled;
    dto.simplification_alert_channels = normalizeSpecificChannels(
      p.simplification_alert_channels,
      dto.channels,
      dto.channels,
    );
    dto.simplification_alerts_enabled = p.simplification_alerts_enabled;
    dto.insight_alert_channels = normalizeSpecificChannels(
      p.insight_alert_channels,
      dto.channels,
      dto.channels,
    );
    dto.insight_alerts_enabled = p.insight_alerts_enabled;
    dto.insight_cadence = normalizeInsightCadence(p.insight_cadence);
    dto.insight_digest_day = normalizeInsightDigestDay(p.insight_digest_day);
    dto.insight_digest_local_time = normalizeHhmm(
      p.insight_digest_local_time,
      INSIGHT_DIGEST_LOCAL_TIME_DEFAULT,
    );
    dto.wrapped_alert_channels = normalizeSpecificChannels(
      p.wrapped_alert_channels,
      dto.channels,
      dto.channels,
    );
    dto.wrapped_alerts_enabled = p.wrapped_alerts_enabled;
    dto.suggestion_ready_channels = normalizeSpecificChannels(
      p.suggestion_ready_channels,
      dto.channels,
      dto.channels,
    );
    dto.suggestion_ready_enabled = p.suggestion_ready_enabled;
    dto.smart_pick_ready_channels = normalizeSpecificChannels(
      p.smart_pick_ready_channels,
      [NotificationChannelValue.InApp],
      dto.channels,
    );
    dto.smart_pick_ready_enabled = p.smart_pick_ready_enabled ?? false;
    dto.slot_start_channels = normalizeSpecificChannels(
      p.slot_start_channels,
      dto.channels,
      dto.channels,
    );
    dto.slot_start_enabled = p.slot_start_enabled;
    dto.recording_reminder_channels = normalizeSpecificChannels(
      p.recording_reminder_channels,
      dto.channels,
      dto.channels,
    );
    dto.recording_reminder_enabled = p.recording_reminder_enabled;
    dto.product_expiry_alert_channels = normalizeSpecificChannels(
      p.product_expiry_alert_channels,
      [NotificationChannelValue.InApp, NotificationChannelValue.Push],
      dto.channels,
    );
    dto.product_expiry_alerts_enabled = p.product_expiry_alerts_enabled ?? true;
    dto.product_expiry_notice_days = normalizeProductExpiryNoticeDays(
      p.product_expiry_notice_days,
    );
    dto.suggestion_lead_time_minutes = p.suggestion_lead_time_minutes;
    dto.quiet_hours_enabled = p.quiet_hours_enabled;
    dto.quiet_hours_start = normalizeHhmm(p.quiet_hours_start, '00:00');
    dto.quiet_hours_end = normalizeHhmm(p.quiet_hours_end, '00:00');
    dto.photo_tutorial_completed = p.photo_tutorial_completed;
    return dto;
  }
}

function normalizeChannels(
  value: NotificationChannel[] | null | undefined,
  fallback: NotificationChannel[],
): NotificationChannel[] {
  const source = Array.isArray(value) ? value : fallback;
  const allowed = new Set<NotificationChannel>(NOTIFICATION_CHANNEL_VALUES);
  const seen = new Set<NotificationChannel>();
  return source.filter((channel) => {
    if (!allowed.has(channel) || seen.has(channel)) return false;
    seen.add(channel);
    return true;
  });
}

function normalizeSpecificChannels(
  value: NotificationChannel[] | null | undefined,
  fallback: NotificationChannel[],
  globalChannels: NotificationChannel[],
): NotificationChannel[] {
  const normalized = normalizeChannels(value, fallback);
  if (globalChannels.includes(NotificationChannelValue.Push)) {
    return normalized;
  }
  return normalized.filter(
    (channel) => channel !== NotificationChannelValue.Push,
  );
}

function normalizeInsightCadence(
  value: InsightCadence | null | undefined,
): InsightCadence {
  return INSIGHT_CADENCE_VALUES.includes(value as InsightCadence)
    ? (value as InsightCadence)
    : INSIGHT_CADENCE_DEFAULT;
}

function normalizeInsightDigestDay(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return INSIGHT_DIGEST_DAY_DEFAULT;
  }
  return Math.max(
    INSIGHT_DIGEST_DAY_MIN,
    Math.min(INSIGHT_DIGEST_DAY_MAX, value),
  );
}

function normalizeProductExpiryNoticeDays(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return PRODUCT_EXPIRY_NOTICE_DAYS_DEFAULT;
  }
  return Math.max(
    PRODUCT_EXPIRY_NOTICE_DAYS_MIN,
    Math.min(PRODUCT_EXPIRY_NOTICE_DAYS_MAX, value),
  );
}

function normalizeHhmm(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  const [hours = '00', minutes = '00'] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}
