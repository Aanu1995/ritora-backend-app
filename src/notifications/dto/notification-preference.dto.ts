import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  NotificationChannel,
  UserNotificationPreference,
} from '../entities/user-notification-preference.entity';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
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
  @IsOptional() @IsBoolean() wrapped_alerts_enabled?: boolean;
  @IsOptional() @IsBoolean() photo_tutorial_completed?: boolean;
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
  wrapped_alerts_enabled: boolean;

  @ApiProperty()
  photo_tutorial_completed: boolean;

  static fromEntity(p: UserNotificationPreference): PreferencesResponseDto {
    const dto = new PreferencesResponseDto();
    dto.photo_reminder_local_time = normalizeReminderTime(
      p.photo_reminder_local_time,
    );
    dto.photo_reminder_enabled = p.photo_reminder_enabled;
    dto.channels = p.channels;
    dto.reaction_alerts_enabled = p.reaction_alerts_enabled;
    dto.simplification_alerts_enabled = p.simplification_alerts_enabled;
    dto.insight_alerts_enabled = p.insight_alerts_enabled;
    dto.wrapped_alerts_enabled = p.wrapped_alerts_enabled;
    dto.photo_tutorial_completed = p.photo_tutorial_completed;
    return dto;
  }
}

function normalizeReminderTime(value: string): string {
  const [hours = '08', minutes = '00'] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}
