import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const DEFAULT_SERVICE_NAME = 'ritora-backend-api';

let activeSdk: NodeSDK | null = null;

export type TelemetryRuntime = {
  enabled: boolean;
  shutdown: () => Promise<void>;
};

export function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
): TelemetryRuntime {
  if (!isTelemetryEnabled(env) || activeSdk) {
    return {
      enabled: Boolean(activeSdk),
      shutdown: activeSdk ? shutdownActiveTelemetry : () => Promise.resolve(),
    };
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': readServiceName(env),
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  activeSdk = sdk;
  return { enabled: true, shutdown: shutdownActiveTelemetry };
}

export function isTelemetryEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.OTEL_ENABLED?.trim().toLowerCase() === 'true';
}

export function readServiceName(env: NodeJS.ProcessEnv): string {
  const configured = env.OTEL_SERVICE_NAME?.trim();
  return configured || DEFAULT_SERVICE_NAME;
}

async function shutdownActiveTelemetry(): Promise<void> {
  const sdk = activeSdk;
  activeSdk = null;
  await sdk?.shutdown();
}
