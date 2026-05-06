import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ROUTINE_BREAK_VIEW_STATUSES,
  RoutineBreakViewStatus,
} from '../suggestions.constants';

export class StartRoutineBreakDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;

  @ApiProperty({ required: false, nullable: true, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string | null;
}

export class UpdateRoutineBreakDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string | null;
}

export class RoutineBreakResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ROUTINE_BREAK_VIEW_STATUSES })
  status: RoutineBreakViewStatus;

  @ApiProperty()
  startedAt: string;

  @ApiProperty({ nullable: true })
  endsAt: string | null;

  @ApiProperty()
  canResumeNow: boolean;

  @ApiProperty()
  message: string;
}

export class RoutineBreakStateResponseDto {
  @ApiProperty({ nullable: true, type: () => RoutineBreakResponseDto })
  routineBreak: RoutineBreakResponseDto | null;
}
