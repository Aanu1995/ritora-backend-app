export const TERMINAL_SHUTDOWN_SIGNALS = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
] as const satisfies readonly NodeJS.Signals[];

export type TerminalShutdownSignal = (typeof TERMINAL_SHUTDOWN_SIGNALS)[number];

export type ShutdownSignalTarget = {
  on(
    signal: TerminalShutdownSignal,
    listener: () => void,
  ): ShutdownSignalTarget;
};
