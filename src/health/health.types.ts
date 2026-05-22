export const HealthCheckStatus = {
  Down: 'down',
  Ok: 'ok',
} as const;

export type HealthCheckStatus =
  (typeof HealthCheckStatus)[keyof typeof HealthCheckStatus];

export type HealthCheckComponent = {
  latencyMs: number | null;
  status: HealthCheckStatus;
};

export type HealthCheckResponse = {
  checks: {
    api: HealthCheckComponent;
    database: HealthCheckComponent;
  };
  status: HealthCheckStatus;
  timestamp: string;
  uptimeSeconds: number;
};
