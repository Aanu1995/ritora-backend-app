import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ANALYSIS_FEEDBACK_REASONS,
  ANALYSIS_FEEDBACK_VOTES,
  type AnalysisFeedbackReason,
  type AnalysisFeedbackVote,
} from '../skin-journal.constants';
import { SkinJournalAnalysisFeedback } from '../entities/skin-journal-analysis-feedback.entity';

export class RecordAnalysisFeedbackDto {
  @ApiProperty({ enum: ANALYSIS_FEEDBACK_VOTES })
  @IsIn(ANALYSIS_FEEDBACK_VOTES)
  vote: AnalysisFeedbackVote;

  @ApiProperty({
    enum: ANALYSIS_FEEDBACK_REASONS,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(ANALYSIS_FEEDBACK_REASONS)
  reason?: AnalysisFeedbackReason | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class AnalysisFeedbackResponseDto {
  @ApiProperty({ enum: ANALYSIS_FEEDBACK_VOTES })
  vote: AnalysisFeedbackVote;

  @ApiProperty({
    enum: ANALYSIS_FEEDBACK_REASONS,
    required: false,
    nullable: true,
  })
  reason: AnalysisFeedbackReason | null;

  @ApiProperty({ required: false, nullable: true })
  note: string | null;

  @ApiProperty({ required: false, nullable: true })
  interpretation_version: string | null;

  @ApiProperty({ required: false, nullable: true })
  reading_label: string | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;

  static fromEntity(
    feedback: SkinJournalAnalysisFeedback,
  ): AnalysisFeedbackResponseDto {
    const dto = new AnalysisFeedbackResponseDto();
    dto.vote = feedback.vote;
    dto.reason = feedback.reason;
    dto.note = feedback.note;
    dto.interpretation_version = feedback.interpretation_version;
    dto.reading_label = feedback.reading_label;
    dto.created_at = feedback.created_at;
    dto.updated_at = feedback.updated_at;
    return dto;
  }
}
