import { startDevAllProcesses, type DevAllRunner } from './dev-all-runner';
import {
  TERMINAL_SHUTDOWN_SIGNALS,
  type ShutdownSignalTarget,
} from './shutdown-signals';

type StartDevAllCliOptions = {
  startProcesses?: () => DevAllRunner;
  signalTarget?: ShutdownSignalTarget;
};

export function registerDevAllShutdownHandlers(
  runner: DevAllRunner,
  signalTarget: ShutdownSignalTarget = process,
): void {
  for (const signal of TERMINAL_SHUTDOWN_SIGNALS) {
    signalTarget.on(signal, () => runner.shutdown(signal));
  }
}

export function startDevAllCli(options: StartDevAllCliOptions = {}): void {
  const runner = (options.startProcesses ?? startDevAllProcesses)();
  registerDevAllShutdownHandlers(runner, options.signalTarget);
}

if (require.main === module) {
  startDevAllCli();
}
