import { ApiProperty } from '@nestjs/swagger';
import {
  InAppNotification,
  NotificationKind,
  NotificationSeverity,
} from '../entities/in-app-notification.entity';

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kind: NotificationKind;

  @ApiProperty()
  title_key: string;

  @ApiProperty()
  body_key: string;

  @ApiProperty()
  severity: NotificationSeverity;

  @ApiProperty({ required: false, nullable: true })
  payload: Record<string, unknown> | null;

  @ApiProperty({ required: false, nullable: true })
  deep_link: string | null;

  @ApiProperty({ required: false, nullable: true })
  read_at: Date | null;

  @ApiProperty()
  created_at: Date;

  static fromEntity(n: InAppNotification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id = n.id;
    dto.kind = n.kind;
    dto.title_key = n.title_key;
    dto.body_key = n.body_key;
    dto.severity = n.severity;
    dto.payload = n.payload;
    dto.deep_link = n.deep_link;
    dto.read_at = n.read_at;
    dto.created_at = n.created_at;
    return dto;
  }
}
