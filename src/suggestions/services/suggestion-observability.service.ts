import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SuggestionObservabilityEvent,
  SuggestionObservabilityMetadata,
} from '../entities/suggestion-observability-event.entity';
import {
  SuggestionObservabilityEventKind,
  SuggestionObservabilitySeverity,
} from '../suggestions.constants';

export interface SuggestionObservabilityRecordInput {
  kind: SuggestionObservabilityEventKind;
  severity?: SuggestionObservabilitySeverity;
  userId?: string | null;
  suggestionInstanceId?: string | null;
  jobId?: string | null;
  metadata?: SuggestionObservabilityMetadata;
}

@Injectable()
export class SuggestionObservabilityService {
  private readonly logger = new Logger(SuggestionObservabilityService.name);

  constructor(
    @InjectRepository(SuggestionObservabilityEvent)
    private readonly eventRepo: Repository<SuggestionObservabilityEvent>,
  ) {}

  async record(input: SuggestionObservabilityRecordInput): Promise<void> {
    try {
      await this.eventRepo.save(
        this.eventRepo.create({
          user_id: input.userId ?? null,
          suggestion_instance_id: input.suggestionInstanceId ?? null,
          job_id: input.jobId ?? null,
          kind: input.kind,
          severity: input.severity ?? 'info',
          metadata: input.metadata ?? {},
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Suggestion observability write failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
