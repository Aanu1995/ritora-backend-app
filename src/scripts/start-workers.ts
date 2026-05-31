import { startWorkerProcesses } from './workers-runner';
import {
  TERMINAL_SHUTDOWN_SIGNALS,
  type ShutdownSignalTarget,
} from './shutdown-signals';

type StartWorkersCliOptions = {
  argv?: readonly string[];
  startProcesses?: typeof startWorkerProcesses;
  signalTarget?: ShutdownSignalTarget;
};

export function registerWorkerShutdownHandlers(
  runner: ReturnType<typeof startWorkerProcesses>,
  signalTarget: ShutdownSignalTarget = process,
): void {
  for (const signal of TERMINAL_SHUTDOWN_SIGNALS) {
    signalTarget.on(signal, () => runner.shutdown(signal));
  }
}

export function startWorkersCli(options: StartWorkersCliOptions = {}): void {
  const argv = options.argv ?? process.argv;
  const startProcesses = options.startProcesses ?? startWorkerProcesses;
  const runner = startProcesses({
    dev: argv.includes('--dev'),
  });

  registerWorkerShutdownHandlers(runner, options.signalTarget);
}

if (require.main === module) {
  startWorkersCli();
}
