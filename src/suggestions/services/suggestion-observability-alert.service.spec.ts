import { AdminService } from '../../admin/admin.service';
import { AdminOperationalIncidentSeverity } from '../../admin/entities/admin-operational-incident.entity';
import { SuggestionObservabilityAlertService } from './suggestion-observability-alert.service';

describe('SuggestionObservabilityAlertService', () => {
  const adminService = {
    createScheduledAccountMonitoringOperationalIncident: jest.fn(),
  } as unknown as jest.Mocked<AdminService>;
  const service = new SuggestionObservabilityAlertService(adminService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes warning events to admin operational incident monitoring without raw context', async () => {
    await service.notify({
      eventId: 'event-1',
      kind: 'generation_context_threshold_exceeded',
      severity: 'warning',
      userId: 'user-1',
      suggestionInstanceId: null,
      jobId: 'job-1',
      metadata: {
        contextLoadDurationMs: 1700,
        contextLoadDurationWarnMs: 1500,
        historyRowsWarnThreshold: 1000,
        maxHistoryRows: 1200,
        overDurationThreshold: true,
        overHistoryRowsThreshold: true,
        privateJournalNote: 'do-not-route',
      },
    });

    expect(
      adminService.createScheduledAccountMonitoringOperationalIncident,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: AdminOperationalIncidentSeverity.Warning,
        sourceId: 'generation_context_threshold_exceeded:event-1',
        sourceType: 'suggestions:observability',
        title: "Today's suggestion context threshold crossed",
      }),
    );
    const incident =
      adminService.createScheduledAccountMonitoringOperationalIncident.mock
        .calls[0]?.[0];
    expect(incident?.description).toContain('durationMs=1700');
    expect(incident?.description).not.toContain('do-not-route');
    expect(incident?.description).not.toContain('privateJournalNote');
  });

  it('does not route informational events', async () => {
    await service.notify({
      eventId: 'event-1',
      kind: 'generation_completed',
      severity: 'info',
      userId: 'user-1',
      suggestionInstanceId: null,
      jobId: null,
      metadata: {},
    });

    expect(
      adminService.createScheduledAccountMonitoringOperationalIncident,
    ).not.toHaveBeenCalled();
  });
});
