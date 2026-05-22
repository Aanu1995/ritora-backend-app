import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { SkinJournalExportJob } from '../entities/skin-journal-export-job.entity';
import type {
  ExportStatus,
  SkinJournalExportPayload,
} from '../skin-journal.constants';

export class CreateJournalExportDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}

export class JournalExportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: ExportStatus;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty({ required: false, nullable: true })
  payload: SkinJournalExportPayload | null;

  @ApiProperty({ required: false, nullable: true })
  error: string | null;

  @ApiProperty()
  created_at: Date;

  static fromEntity(job: SkinJournalExportJob): JournalExportResponseDto {
    const dto = new JournalExportResponseDto();
    dto.id = job.id;
    dto.status = job.status;
    dto.from = job.range_from;
    dto.to = job.range_to;
    dto.payload = job.payload;
    dto.error = job.error;
    dto.created_at = job.created_at;
    return dto;
  }
}
