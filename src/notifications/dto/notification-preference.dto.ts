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
import { ApiProperty } from '@nestjs/swagger';
import {
  NotificationChannel,
  UserNotificationPreference,
} from '../entities/user-notification-preference.entity';

export const SUGGESTION_LEAD_TIME_MIN_MINUTES = 30;
export const SUGGESTION_LEAD_TIME_MAX_MINUTES = 720;
export const SUGGESTION_LEAD_TIME_DEFAULT_MINUTES = 120;

const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  photo_reminder_local_time?: string;

  @IsOptional()
  @IsBoolean()
  photo_reminder_enabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['email', 'in_app'], { each: true })
  channels?: NotificationChannel[];

  @IsOptional() @IsBoolean() reaction_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() simplification_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() insight_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() ai_polished_insights_enabled?: boolean;
  @IsOptional() @IsBoolean() wrapped_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() photo_tutorial_completed?: boolean;

  @IsOptional() @IsBoolean() suggestion_ready_enabled?: boolean;
  @IsOptional() @IsBoolean() slot_start_enabled?: boolean;
  @IsOptional() @IsBoolean() recording_reminder_enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(SUGGESTION_LEAD_TIME_MIN_MINUTES)
  @Max(SUGGESTION_LEAD_TIME_MAX_MINUTES)
  suggestion_lead_time_minutes?: number;

  @IsOptional() @IsBoolean() quiet_hours_enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(HHMM_PATTERN)
  quiet_hours_start?: string;

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

  @ApiProperty()
  reaction_alerts_enabled: boolean;

  @ApiProperty()
  simplification_alerts_enabled: boolean;

  @ApiProperty()
  insight_alerts_enabled: boolean;

  @ApiProperty()
  ai_polished_insights_enabled: boolean;

  @ApiProperty()
  wrapped_alerts_enabled: boolean;

  @ApiProperty()
  suggestion_ready_enabled: boolean;

  @ApiProperty()
  slot_start_enabled: boolean;

  @ApiProperty()
  recording_reminder_enabled: boolean;

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
    dto.photo_reminder_local_time = normalizeHhmm(p.photo_reminder_local_time);
    dto.photo_reminder_enabled = p.photo_reminder_enabled;
    dto.channels = p.channels;
    dto.reaction_alerts_enabled = p.reaction_alerts_enabled;
    dto.simplification_alerts_enabled = p.simplification_alerts_enabled;
    dto.insight_alerts_enabled = p.insight_alerts_enabled;
    dto.ai_polished_insights_enabled = p.ai_polished_insights_enabled;
    dto.wrapped_alerts_enabled = p.wrapped_alerts_enabled;
    dto.suggestion_ready_enabled = p.suggestion_ready_enabled;
    dto.slot_start_enabled = p.slot_start_enabled;
    dto.recording_reminder_enabled = p.recording_reminder_enabled;
    dto.suggestion_lead_time_minutes = p.suggestion_lead_time_minutes;
    dto.quiet_hours_enabled = p.quiet_hours_enabled;
    dto.quiet_hours_start = normalizeHhmm(p.quiet_hours_start);
    dto.quiet_hours_end = normalizeHhmm(p.quiet_hours_end);
    dto.photo_tutorial_completed = p.photo_tutorial_completed;
    return dto;
  }
}

function normalizeHhmm(value: string | null | undefined): string {
  if (!value) return '00:00';
  const [hours = '00', minutes = '00'] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}
