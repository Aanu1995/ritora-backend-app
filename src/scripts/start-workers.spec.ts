import type { WorkerRunner } from './workers-runner';
import {
  registerWorkerShutdownHandlers,
  startWorkersCli,
} from './start-workers';
import {
  TERMINAL_SHUTDOWN_SIGNALS,
  type ShutdownSignalTarget,
  type TerminalShutdownSignal,
} from './shutdown-signals';

describe('start workers script', () => {
  it('registers terminal-close shutdown signals for worker groups', () => {
    const handlers: Partial<Record<TerminalShutdownSignal, () => void>> = {};
    const signalTarget: ShutdownSignalTarget = {
      on(signal, listener) {
        handlers[signal] = listener;
        return signalTarget;
      },
    };
    const onSpy = jest.spyOn(signalTarget, 'on');
    const runner: WorkerRunner = {
      shutdown: jest.fn(),
    };

    registerWorkerShutdownHandlers(runner, signalTarget);

    expect(onSpy).toHaveBeenCalledTimes(TERMINAL_SHUTDOWN_SIGNALS.length);
    for (const signal of TERMINAL_SHUTDOWN_SIGNALS) {
      expect(onSpy).toHaveBeenCalledWith(signal, expect.any(Function));
      handlers[signal]?.();
      expect(runner.shutdown).toHaveBeenLastCalledWith(signal);
    }
  });

  it('starts workers with the requested dev mode before registering handlers', () => {
    const events: string[] = [];
    const runner: WorkerRunner = {
      shutdown: jest.fn(),
    };
    const signalTarget: ShutdownSignalTarget = {
      on(signal) {
        events.push(`registered:${signal}`);
        return signalTarget;
      },
    };

    startWorkersCli({
      argv: ['node', 'start-workers.ts', '--dev'],
      startProcesses: (workerOptions = {}) => {
        events.push(workerOptions.dev ? 'started-dev' : 'started-prod');
        return runner;
      },
      signalTarget,
    });

    expect(events[0]).toBe('started-dev');
    expect(events).toEqual([
      'started-dev',
      'registered:SIGINT',
      'registered:SIGTERM',
      'registered:SIGHUP',
    ]);
  });
});
