import { ApiProperty } from '@nestjs/swagger';
import {
  toDateOnlyString,
  toIsoString,
  toTimeOnlyString,
} from '../../common/utils/date';
import { ApplicationLogItemResponseDto } from './application-log-item.dto';
import { ApplicationLog } from '../entities/application-log.entity';
import { ApplicationLogVersion } from '../entities/application-log-version.entity';
import {
  APPLICATION_DAYPARTS,
  ApplicationDaypart,
  ApplicationLogSnapshot,
} from '../application-tracking.constants';

export class ApplicationLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  suggestionInstanceId: string | null;

  @ApiProperty({ nullable: true })
  slotId: string | null;

  @ApiProperty()
  targetDate: string;

  @ApiProperty({ nullable: true })
  targetTime: string | null;

  @ApiProperty({
    nullable: true,
    enum: APPLICATION_DAYPARTS,
  })
  daypart: ApplicationDaypart | null;

  @ApiProperty({ nullable: true })
  appliedAt: string | null;

  @ApiProperty({ nullable: true })
  generalNotes: string | null;

  @ApiProperty({ nullable: true })
  editReason: string | null;

  @ApiProperty()
  editCount: number;

  @ApiProperty()
  hasBeenEdited: boolean;

  @ApiProperty()
  firstRecordedAt: string;

  @ApiProperty({ nullable: true })
  lastEditedAt: string | null;

  @ApiProperty({ type: [ApplicationLogItemResponseDto] })
  items: ApplicationLogItemResponseDto[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  static fromEntity(log: ApplicationLog): ApplicationLogResponseDto {
    const dto = new ApplicationLogResponseDto();
    dto.id = log.id;
    dto.suggestionInstanceId = log.suggestion_instance_id;
    dto.slotId = log.slot_id;
    dto.targetDate = toDateOnlyString(log.target_date);
    dto.targetTime = log.target_time ? toTimeOnlyString(log.target_time) : null;
    dto.daypart = log.daypart;
    dto.appliedAt = log.applied_at ? toIsoString(log.applied_at) : null;
    dto.generalNotes = log.general_notes;
    dto.editReason = log.edit_reason;
    dto.editCount = log.edit_count;
    dto.hasBeenEdited = log.has_been_edited;
    dto.firstRecordedAt = toIsoString(log.first_recorded_at);
    dto.lastEditedAt = log.last_edited_at
      ? toIsoString(log.last_edited_at)
      : null;
    dto.items = (log.items ?? [])
      .slice()
      .sort((a, b) => a.step_order - b.step_order)
      .map((item) => ApplicationLogItemResponseDto.fromEntity(item));
    dto.createdAt = toIsoString(log.created_at);
    dto.updatedAt = toIsoString(log.updated_at);
    return dto;
  }
}

export class ApplicationLogVersionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  applicationLogId: string;

  @ApiProperty()
  version: number;

  @ApiProperty()
  editedAt: string;

  @ApiProperty()
  editedByUserId: string;

  @ApiProperty({ nullable: true })
  editReason: string | null;

  @ApiProperty()
  snapshot: ApplicationLogSnapshot;

  static fromEntity(
    version: ApplicationLogVersion,
  ): ApplicationLogVersionResponseDto {
    const dto = new ApplicationLogVersionResponseDto();
    dto.id = version.id;
    dto.applicationLogId = version.application_log_id;
    dto.version = version.version;
    dto.editedAt = toIsoString(version.created_at);
    dto.editedByUserId = version.edited_by_user_id;
    dto.editReason = version.edit_reason;
    dto.snapshot = version.snapshot;
    return dto;
  }
}

export class ApplicationTrackingAnalyticsDto {
  @ApiProperty()
  totalLogs: number;

  @ApiProperty()
  editedLogs: number;

  @ApiProperty()
  addedOffShelfCount: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  skippedByCategory: Record<string, number>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  substitutedByCategory: Record<string, number>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  appliedByCategory: Record<string, number>;
}
