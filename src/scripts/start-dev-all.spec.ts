import type { DevAllRunner } from './dev-all-runner';
import {
  registerDevAllShutdownHandlers,
  startDevAllCli,
} from './start-dev-all';
import {
  TERMINAL_SHUTDOWN_SIGNALS,
  type ShutdownSignalTarget,
  type TerminalShutdownSignal,
} from './shutdown-signals';

describe('start dev all script', () => {
  it('registers terminal-close shutdown signals for every dev process', () => {
    const handlers: Partial<Record<TerminalShutdownSignal, () => void>> = {};
    const signalTarget: ShutdownSignalTarget = {
      on(signal, listener) {
        handlers[signal] = listener;
        return signalTarget;
      },
    };
    const onSpy = jest.spyOn(signalTarget, 'on');
    const runner: DevAllRunner = {
      shutdown: jest.fn(),
    };

    registerDevAllShutdownHandlers(runner, signalTarget);

    expect(onSpy).toHaveBeenCalledTimes(TERMINAL_SHUTDOWN_SIGNALS.length);
    for (const signal of TERMINAL_SHUTDOWN_SIGNALS) {
      expect(onSpy).toHaveBeenCalledWith(signal, expect.any(Function));
      handlers[signal]?.();
      expect(runner.shutdown).toHaveBeenLastCalledWith(signal);
    }
  });

  it('starts dev processes before registering shutdown handlers', () => {
    const events: string[] = [];
    const runner: DevAllRunner = {
      shutdown: jest.fn(),
    };
    const signalTarget: ShutdownSignalTarget = {
      on(signal) {
        events.push(`registered:${signal}`);
        return signalTarget;
      },
    };

    startDevAllCli({
      startProcesses: () => {
        events.push('started');
        return runner;
      },
      signalTarget,
    });

    expect(events[0]).toBe('started');
    expect(events).toEqual([
      'started',
      'registered:SIGINT',
      'registered:SIGTERM',
      'registered:SIGHUP',
    ]);
  });
});
