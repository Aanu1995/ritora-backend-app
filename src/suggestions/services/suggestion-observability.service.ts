import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { SuggestionObservabilityAlertService } from './suggestion-observability-alert.service';

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
    @Optional()
    private readonly alertService?: SuggestionObservabilityAlertService,
  ) {}

  async record(input: SuggestionObservabilityRecordInput): Promise<void> {
    try {
      const severity = input.severity ?? 'info';
      const event = await this.eventRepo.save(
        this.eventRepo.create({
          user_id: input.userId ?? null,
          suggestion_instance_id: input.suggestionInstanceId ?? null,
          job_id: input.jobId ?? null,
          kind: input.kind,
          severity,
          metadata: input.metadata ?? {},
        }),
      );
      await this.routeAlert(event, severity);
    } catch (error) {
      this.logger.warn(
        `Suggestion observability write failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async routeAlert(
    event: SuggestionObservabilityEvent,
    severity: SuggestionObservabilitySeverity,
  ): Promise<void> {
    if (!shouldRouteAlert(event.kind, severity)) {
      return;
    }
    if (!this.alertService) {
      return;
    }
    await this.alertService.notify({
      eventId: event.id ?? null,
      kind: event.kind,
      severity,
      userId: event.user_id ?? null,
      suggestionInstanceId: event.suggestion_instance_id ?? null,
      jobId: event.job_id ?? null,
      metadata: event.metadata ?? {},
    });
  }
}

function shouldRouteAlert(
  kind: SuggestionObservabilityEventKind,
  severity: SuggestionObservabilitySeverity,
): boolean {
  return (
    severity !== 'info' && kind === 'generation_context_threshold_exceeded'
  );
}
