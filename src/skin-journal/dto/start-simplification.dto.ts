import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  REACTION_REPORT_SEVERITIES,
  REACTION_REPORT_SYMPTOMS,
  RecoveryTriggerSourceValue,
  type ReactionReportSeverity,
  type ReactionReportSymptom,
  type RecoveryTriggerSource,
} from '../skin-journal.constants';

const RECOVERY_TRIGGER_SOURCES = Object.values(RecoveryTriggerSourceValue);

export class StartSimplificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  triggered_by_event_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsIn(RECOVERY_TRIGGER_SOURCES)
  recovery_trigger_source?: RecoveryTriggerSource;

  @IsOptional()
  @IsArray()
  @IsIn(REACTION_REPORT_SYMPTOMS, { each: true })
  recovery_trigger_symptoms?: ReactionReportSymptom[];

  @IsOptional()
  @IsIn(REACTION_REPORT_SEVERITIES)
  recovery_trigger_severity?: ReactionReportSeverity | null;

  @IsOptional()
  @IsBoolean()
  recovery_active_overuse?: boolean;
}
