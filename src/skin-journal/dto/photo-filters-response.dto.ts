import { ApiProperty } from '@nestjs/swagger';
import type {
  AnalysisConcern,
  PhotoFilterKind,
} from '../skin-journal.constants';

export class PhotoFilterOptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['all', 'reaction', 'concern'] })
  kind: PhotoFilterKind;

  @ApiProperty({ required: false, nullable: true })
  value: AnalysisConcern | null;

  @ApiProperty()
  count: number;
}

export class PhotoFiltersResponseDto {
  @ApiProperty({ type: [PhotoFilterOptionDto] })
  filters: PhotoFilterOptionDto[];
}
