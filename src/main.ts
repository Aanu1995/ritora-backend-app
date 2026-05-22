import { startTelemetry } from './observability/telemetry';

const telemetry = startTelemetry();

void import('./bootstrap.js')
  .then(({ bootstrapApplication }) => bootstrapApplication())
  .catch(async (error: unknown) => {
    await telemetry.shutdown();
    throw error;
  });
