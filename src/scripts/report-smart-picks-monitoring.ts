import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { In, MoreThanOrEqual } from 'typeorm';
import dataSource from '../database/data-source';
import { SuggestionObservabilityEvent } from '../suggestions/entities/suggestion-observability-event.entity';
import {
  buildSmartPicksMonitoringReport,
  SMART_PICK_MONITORED_EVENT_KINDS,
  SmartPickMonitoredEventKind,
  type SmartPicksMonitoringThresholds,
} from '../smart-picks/evaluation/smart-picks-monitoring-report';

interface MonitoringCliOptions {
  out: string;
  windowHours: number;
  failOnAlert: boolean;
  thresholds: Partial<SmartPicksMonitoringThresholds>;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const now = new Date();
    const since = new Date(
      now.getTime() - options.windowHours * 60 * 60 * 1000,
    );
    const repo = dataSource.getRepository(SuggestionObservabilityEvent);
    const events = await repo.find({
      where: {
        kind: In([...SMART_PICK_MONITORED_EVENT_KINDS]),
        created_at: MoreThanOrEqual(since),
      },
      order: { created_at: 'ASC' },
    });
    const report = buildSmartPicksMonitoringReport({
      generatedAt: now,
      windowHours: options.windowHours,
      events: events.map((event) => ({
        kind: event.kind as SmartPickMonitoredEventKind,
        severity: event.severity,
        createdAt: event.created_at,
        metadata: event.metadata,
      })),
      thresholds: options.thresholds,
    });

    await mkdir(resolve(options.out, '..'), { recursive: true });
    await writeFile(
      options.out,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `Smart Picks monitoring report saved to ${options.out}: ${report.totalEvents} events in ${report.windowHours}h.`,
    );
    if (options.failOnAlert && report.recommendedActions.length > 0) {
      console.error(
        `Smart Picks monitoring alerts: ${report.recommendedActions.join(', ')}`,
      );
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

function parseArgs(args: string[]): MonitoringCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const thresholds: Partial<SmartPicksMonitoringThresholds> = {};
  assignNumericThreshold(args, thresholds, 'noPickCount', '--no-pick-count');
  assignNumericThreshold(args, thresholds, 'noPickRate', '--no-pick-rate');
  assignNumericThreshold(
    args,
    thresholds,
    'aiFailureRate',
    '--ai-failure-rate',
  );
  assignNumericThreshold(
    args,
    thresholds,
    'minFeedbackCount',
    '--min-feedback-count',
  );
  assignNumericThreshold(
    args,
    thresholds,
    'lowFeedbackSaveRate',
    '--low-feedback-save-rate',
  );
  return {
    windowHours: Number(readFlag(args, '--window-hours') ?? 24),
    failOnAlert: args.includes('--fail-on-alert'),
    thresholds,
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/smart-picks/evaluation/reports',
          `smart-picks-monitoring-${timestamp}.json`,
        ),
    ),
  };
}

function assignNumericThreshold(
  args: readonly string[],
  target: Partial<SmartPicksMonitoringThresholds>,
  key: keyof SmartPicksMonitoringThresholds,
  flag: string,
): void {
  const raw = readFlag(args, flag);
  if (!raw) return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative number.`);
  }
  target[key] = value;
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
