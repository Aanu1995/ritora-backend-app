import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { InsightAction } from '../insights/insight-types';

const INSIGHT_ACTION_KINDS = [
  'view_entries',
  'open_compare',
  'open_product',
  'open_today_upload',
  'dismiss',
  'open_settings',
] as const satisfies ReadonlyArray<InsightAction['kind']>;

export class RecordInsightActionDto {
  @ApiProperty({ enum: INSIGHT_ACTION_KINDS })
  @IsIn(INSIGHT_ACTION_KINDS)
  action_kind: InsightAction['kind'];
}
