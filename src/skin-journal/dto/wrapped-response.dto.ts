import { ApiProperty } from '@nestjs/swagger';
import { SkinJournalWrapped } from '../entities/skin-journal-wrapped.entity';
import type {
  WrappedManifest,
  WrappedPeriodKind,
  WrappedStatus,
} from '../skin-journal.constants';

export interface ResolvedWrappedManifest extends WrappedManifest {
  entries: Array<WrappedManifest['entries'][number] & { photo_url: string }>;
}

export class WrappedResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  period_kind: WrappedPeriodKind;

  @ApiProperty()
  period_start: string;

  @ApiProperty()
  period_end: string;

  @ApiProperty()
  status: WrappedStatus;

  @ApiProperty({ required: false, nullable: true })
  manifest: ResolvedWrappedManifest | null;

  @ApiProperty()
  photo_count: number;

  @ApiProperty({ required: false, nullable: true })
  generated_at: Date | null;

  @ApiProperty({ required: false, nullable: true })
  error: string | null;

  static fromEntity(
    wrapped: SkinJournalWrapped,
    manifest: ResolvedWrappedManifest | null,
  ): WrappedResponseDto {
    const dto = new WrappedResponseDto();
    dto.id = wrapped.id;
    dto.period_kind = wrapped.period_kind;
    dto.period_start = wrapped.period_start;
    dto.period_end = wrapped.period_end;
    dto.status = wrapped.status;
    dto.manifest = manifest;
    dto.photo_count =
      manifest?.entries?.length ?? wrapped.manifest?.entries?.length ?? 0;
    dto.generated_at = wrapped.generated_at;
    dto.error = wrapped.error;
    return dto;
  }
}
