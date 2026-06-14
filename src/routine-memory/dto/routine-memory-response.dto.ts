import { ApiProperty } from '@nestjs/swagger';
import {
  ROUTINE_MEMORY_EVENT_SEVERITIES,
  ROUTINE_MEMORY_EVENT_TYPES,
  ROUTINE_MEMORY_REASON_CODES,
  ROUTINE_MEMORY_SOURCE_TYPES,
  ROUTINE_MEMORY_SUSPICION_LEVELS,
  type RoutineMemoryEventSeverity,
  type RoutineMemoryEventType,
  type RoutineMemoryReasonCode,
  type RoutineMemorySourceType,
  type RoutineMemorySuspicionLevel,
} from '../routine-memory.types';

export class RoutineMemoryWindowDto {
  @ApiProperty({ format: 'date' })
  start: string;

  @ApiProperty({ format: 'date' })
  end: string;

  @ApiProperty()
  days: number;
}

export class RoutineMemoryProductDto {
  @ApiProperty({ nullable: true })
  productId: string | null;

  @ApiProperty({ nullable: true })
  brand: string | null;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty({ nullable: true })
  imageUrl: string | null;
}

export class RoutineMemoryTimelineEventDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ format: 'date' })
  date: string;

  @ApiProperty({ nullable: true })
  occurredAt: string | null;

  @ApiProperty({ enum: ROUTINE_MEMORY_EVENT_TYPES })
  type: RoutineMemoryEventType;

  @ApiProperty({ enum: ROUTINE_MEMORY_EVENT_SEVERITIES })
  severity: RoutineMemoryEventSeverity;

  @ApiProperty({ type: RoutineMemoryProductDto, nullable: true })
  product: RoutineMemoryProductDto | null;

  @ApiProperty({ enum: ROUTINE_MEMORY_SOURCE_TYPES })
  sourceType: RoutineMemorySourceType;

  @ApiProperty()
  sourceId: string;
}

export class RoutineMemorySuspiciousProductDto {
  @ApiProperty()
  productId: string;

  @ApiProperty()
  brand: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  category: string | null;

  @ApiProperty({ nullable: true })
  imageUrl: string | null;

  @ApiProperty({ enum: ROUTINE_MEMORY_SUSPICION_LEVELS })
  suspicionLevel: RoutineMemorySuspicionLevel;

  @ApiProperty()
  score: number;

  @ApiProperty({ enum: ROUTINE_MEMORY_REASON_CODES, isArray: true })
  reasonCodes: RoutineMemoryReasonCode[];

  @ApiProperty({ format: 'date', nullable: true })
  firstUseDate: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  lastUseDate: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  nearestReactionDate: string | null;

  @ApiProperty({ nullable: true })
  daysFromFirstUseToReaction: number | null;

  @ApiProperty()
  reactionSignalCountNearUse: number;
}

export class RoutineMemoryProductTimelineDto {
  @ApiProperty({ type: RoutineMemoryProductDto })
  product: RoutineMemoryProductDto;

  @ApiProperty({ enum: ROUTINE_MEMORY_SUSPICION_LEVELS, nullable: true })
  suspicionLevel: RoutineMemorySuspicionLevel | null;

  @ApiProperty({ enum: ROUTINE_MEMORY_REASON_CODES, isArray: true })
  reasonCodes: RoutineMemoryReasonCode[];

  @ApiProperty({ format: 'date', nullable: true })
  firstUseDate: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  lastUseDate: string | null;

  @ApiProperty({ format: 'date', nullable: true })
  nearestReactionDate: string | null;

  @ApiProperty()
  eventCount: number;

  @ApiProperty({ type: [RoutineMemoryTimelineEventDto] })
  timeline: RoutineMemoryTimelineEventDto[];
}

export class RoutineMemorySummaryDto {
  @ApiProperty()
  timelineEventCount: number;

  @ApiProperty()
  productChangeCount: number;

  @ApiProperty()
  applicationLogCount: number;

  @ApiProperty()
  reactionSignalCount: number;

  @ApiProperty()
  recoveryEventCount: number;

  @ApiProperty()
  suspiciousProductCount: number;

  @ApiProperty()
  hasPossibleLinks: boolean;
}

export class RoutineMemoryResponseDto {
  @ApiProperty()
  generatedAt: string;

  @ApiProperty()
  timeZone: string;

  @ApiProperty({ type: RoutineMemoryWindowDto })
  window: RoutineMemoryWindowDto;

  @ApiProperty()
  disclaimer: string;

  @ApiProperty({ type: RoutineMemorySummaryDto })
  summary: RoutineMemorySummaryDto;

  @ApiProperty({ type: [RoutineMemoryTimelineEventDto] })
  timeline: RoutineMemoryTimelineEventDto[];

  @ApiProperty({ type: [RoutineMemorySuspiciousProductDto] })
  suspiciousProducts: RoutineMemorySuspiciousProductDto[];

  @ApiProperty({ type: [RoutineMemoryProductTimelineDto] })
  productTimelines: RoutineMemoryProductTimelineDto[];
}
