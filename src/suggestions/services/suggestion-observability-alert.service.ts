import { Injectable, Logger } from '@nestjs/common';
import { AdminService } from '../../admin/admin.service';
import { AdminOperationalIncidentSeverity } from '../../admin/entities/admin-operational-incident.entity';
import { SuggestionObservabilityMetadata } from '../entities/suggestion-observability-event.entity';
import {
  SuggestionObservabilityEventKind,
  SuggestionObservabilitySeverity,
} from '../suggestions.constants';

export interface SuggestionObservabilityAlertInput {
  eventId: string | null;
  kind: SuggestionObservabilityEventKind;
  severity: SuggestionObservabilitySeverity;
  userId: string | null;
  suggestionInstanceId: string | null;
  jobId: string | null;
  metadata: SuggestionObservabilityMetadata;
}

@Injectable()
export class SuggestionObservabilityAlertService {
  private readonly logger = new Logger(
    SuggestionObservabilityAlertService.name,
  );

  constructor(private readonly adminService: AdminService) {}

  async notify(input: SuggestionObservabilityAlertInput): Promise<void> {
    if (input.severity === 'info') {
      return;
    }

    try {
      await this.adminService.createScheduledAccountMonitoringOperationalIncident(
        {
          description: buildIncidentDescription(input),
          severity: toIncidentSeverity(input.severity),
          sourceId: buildIncidentSourceId(input),
          sourceType: 'suggestions:observability',
          title: buildIncidentTitle(input.kind),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Suggestion observability alert routing failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

function buildIncidentTitle(kind: SuggestionObservabilityEventKind): string {
  if (kind === 'generation_context_threshold_exceeded') {
    return "Today's suggestion context threshold crossed";
  }
  return "Today's suggestion operational warning";
}

function buildIncidentSourceId(
  input: SuggestionObservabilityAlertInput,
): string {
  const identifier =
    input.eventId ??
    input.jobId ??
    input.suggestionInstanceId ??
    input.userId ??
    'unknown';
  return `${input.kind}:${identifier}`.slice(0, 120);
}

function buildIncidentDescription(
  input: SuggestionObservabilityAlertInput,
): string {
  const metadata = input.metadata;
  const durationMs = readMetadataNumber(metadata, 'contextLoadDurationMs');
  const durationLimitMs = readMetadataNumber(
    metadata,
    'contextLoadDurationWarnMs',
  );
  const maxHistoryRows = readMetadataNumber(metadata, 'maxHistoryRows');
  const rowsLimit = readMetadataNumber(metadata, 'historyRowsWarnThreshold');
  const overDuration = readMetadataBoolean(metadata, 'overDurationThreshold');
  const overRows = readMetadataBoolean(metadata, 'overHistoryRowsThreshold');

  return [
    "A Today's Suggestion context build crossed an operational threshold.",
    `kind=${input.kind}`,
    `severity=${input.severity}`,
    `eventId=${input.eventId ?? 'unknown'}`,
    `jobId=${input.jobId ?? 'none'}`,
    `durationMs=${durationMs ?? 'unknown'}`,
    `durationWarnMs=${durationLimitMs ?? 'unknown'}`,
    `maxHistoryRows=${maxHistoryRows ?? 'unknown'}`,
    `historyRowsWarnThreshold=${rowsLimit ?? 'unknown'}`,
    `overDurationThreshold=${overDuration ?? false}`,
    `overHistoryRowsThreshold=${overRows ?? false}`,
    'Review database/query health and prompt context volume. No journal notes, prompt text, product notes, or raw user context are included in this alert.',
  ].join(' ');
}

function toIncidentSeverity(
  severity: SuggestionObservabilitySeverity,
): AdminOperationalIncidentSeverity {
  return severity === 'critical'
    ? AdminOperationalIncidentSeverity.Critical
    : AdminOperationalIncidentSeverity.Warning;
}

function readMetadataNumber(
  metadata: SuggestionObservabilityMetadata,
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readMetadataBoolean(
  metadata: SuggestionObservabilityMetadata,
  key: string,
): boolean | null {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : null;
}
