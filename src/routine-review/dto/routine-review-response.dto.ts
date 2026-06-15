import { ApiProperty } from '@nestjs/swagger';
import {
  ROUTINE_REVIEW_DECISIONS,
  ROUTINE_REVIEW_RISK_LEVELS,
  ROUTINE_REVIEW_SIGNAL_SEVERITIES,
  type RoutineReviewActionCode,
  type RoutineReviewDecision,
  type RoutineReviewReasonCode,
  type RoutineReviewRiskLevel,
  type RoutineReviewSignalCode,
  type RoutineReviewSignalSeverity,
} from '../routine-review.types';

export class RoutineReviewWindowDto {
  @ApiProperty({ format: 'date' })
  start: string;

  @ApiProperty({ format: 'date' })
  end: string;

  @ApiProperty()
  days: number;
}

export class RoutineReviewActionDto {
  @ApiProperty()
  code: RoutineReviewActionCode;

  @ApiProperty()
  label: string;

  @ApiProperty()
  detail: string;
}

export class RoutineReviewSignalDto {
  @ApiProperty()
  code: RoutineReviewSignalCode;

  @ApiProperty({ enum: ROUTINE_REVIEW_SIGNAL_SEVERITIES })
  severity: RoutineReviewSignalSeverity;

  @ApiProperty()
  label: string;

  @ApiProperty()
  detail: string;
}

export class RoutineReviewEvidenceDto {
  @ApiProperty()
  journalEntryCount: number;

  @ApiProperty()
  applicationLogCount: number;

  @ApiProperty()
  reactionSignalCount: number;

  @ApiProperty()
  userReactionReportCount: number;

  @ApiProperty()
  userReactionRedFlagCount: number;

  @ApiProperty()
  barrierSignalCount: number;

  @ApiProperty()
  highIrritationEntryCount: number;

  @ApiProperty()
  highBreakoutEntryCount: number;

  @ApiProperty()
  recentNewProductCount: number;

  @ApiProperty()
  activeUseDayCount: number;

  @ApiProperty()
  activeShelfProductCount: number;

  @ApiProperty()
  activeSimplification: boolean;

  @ApiProperty()
  lowSpfWithPigmentGoal: boolean;
}

export class RoutineReviewResponseDto {
  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty({ type: RoutineReviewWindowDto })
  window: RoutineReviewWindowDto;

  @ApiProperty({ enum: ROUTINE_REVIEW_DECISIONS })
  decision: RoutineReviewDecision;

  @ApiProperty({ enum: ROUTINE_REVIEW_RISK_LEVELS })
  riskLevel: RoutineReviewRiskLevel;

  @ApiProperty()
  reasonCode: RoutineReviewReasonCode;

  @ApiProperty()
  title: string;

  @ApiProperty()
  summary: string;

  @ApiProperty({ nullable: true })
  nextReviewAt: string | null;

  @ApiProperty({ type: [RoutineReviewActionDto] })
  actions: RoutineReviewActionDto[];

  @ApiProperty({ type: [RoutineReviewSignalDto] })
  signals: RoutineReviewSignalDto[];

  @ApiProperty({ type: RoutineReviewEvidenceDto })
  evidence: RoutineReviewEvidenceDto;
}
