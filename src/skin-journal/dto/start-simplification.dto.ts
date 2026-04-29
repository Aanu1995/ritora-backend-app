import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartSimplificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  triggered_by_event_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
