import {
  WORKER_PROCESSES,
  startWorkerProcesses,
  type WorkerChildProcess,
} from './workers-runner';

class FakeChildProcess implements WorkerChildProcess {
  readonly pid: number;
  readonly killSignals: NodeJS.Signals[] = [];
  private exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | null = null;

  constructor(pid: number) {
    this.pid = pid;
  }

  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this {
    if (event === 'exit') {
      this.exitListener = listener;
    }
    return this;
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitListener?.(code, signal);
  }
}

describe('workers runner', () => {
  it('starts every background worker needed by the worker deployment', () => {
    expect(WORKER_PROCESSES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'account-deletion-worker',
          entryFile: 'start-account-deletion-worker.js',
        }),
        expect.objectContaining({
          name: 'account-monitoring-worker',
          entryFile: 'start-account-monitoring-worker.js',
        }),
        expect.objectContaining({
          name: 'skin-journal-analysis-worker',
          entryFile: 'start-skin-journal-analysis-worker.js',
        }),
        expect.objectContaining({
          name: 'skin-journal-insight-worker',
          entryFile: 'start-skin-journal-insight-worker.js',
        }),
        expect.objectContaining({
          name: 'smart-picks-generation-worker',
          entryFile: 'start-smart-picks-generation-worker.js',
        }),
        expect.objectContaining({
          name: 'ingredient-product-analysis-worker',
          entryFile: 'start-ingredient-product-analysis-worker.js',
        }),
      ]),
    );
  });

  it('stops all workers when one worker exits unexpectedly', () => {
    const children: FakeChildProcess[] = [];
    const errors: string[] = [];
    let exitCode = 0;
    const forceExitTimer = {
      unref: jest.fn(),
    };

    startWorkerProcesses({
      env: {},
      spawnProcess: () => {
        const child = new FakeChildProcess(10_000 + children.length);
        children.push(child);
        return child;
      },
      killProcess: (child, signal) => child.kill(signal),
      setExitCode: (code) => {
        exitCode = code;
      },
      writeError: (message) => {
        errors.push(message);
      },
      setForceExitTimer: (callback) => {
        expect(callback).toEqual(expect.any(Function));
        return forceExitTimer;
      },
    });

    children[0].exit(1, null);

    expect(exitCode).toBe(1);
    expect(errors[0]).toContain(WORKER_PROCESSES[0].name);
    expect(
      children.slice(1).every((child) => child.killSignals.includes('SIGTERM')),
    ).toBe(true);
    expect(forceExitTimer.unref).toHaveBeenCalled();
  });
});
