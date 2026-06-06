import {
  DEV_ALL_PROCESSES,
  startDevAllProcesses,
  type DevChildProcess,
} from './dev-all-runner';

class FakeChildProcess implements DevChildProcess {
  readonly pid: number;
  killed = false;
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
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitListener?.(code, signal);
  }
}

describe('dev all runner', () => {
  it('includes all background workers in the dev process list', () => {
    expect(
      DEV_ALL_PROCESSES.map((processConfig) => processConfig.name),
    ).toEqual([
      'api',
      'account-deletion-worker',
      'account-monitoring-worker',
      'skin-journal-analysis-worker',
      'skin-journal-insight-worker',
      'smart-picks-generation-worker',
      'ingredient-product-analysis-worker',
    ]);
    expect(DEV_ALL_PROCESSES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'account-deletion-worker',
          args: ['run', 'account-deletion-worker:dev'],
        }),
        expect.objectContaining({
          name: 'account-monitoring-worker',
          args: ['run', 'account-monitoring-worker:dev'],
        }),
        expect.objectContaining({
          name: 'skin-journal-analysis-worker',
          args: ['run', 'skin-journal:analysis-worker:dev'],
        }),
        expect.objectContaining({
          name: 'skin-journal-insight-worker',
          args: ['run', 'skin-journal:insight-worker:dev'],
        }),
        expect.objectContaining({
          name: 'smart-picks-generation-worker',
          args: ['run', 'smart-picks:generation-worker:dev'],
        }),
        expect.objectContaining({
          name: 'ingredient-product-analysis-worker',
          args: ['run', 'ingredient-analysis:worker:dev'],
        }),
      ]),
    );
  });

  it.each(
    DEV_ALL_PROCESSES.map(
      (processConfig) => [processConfig.name, processConfig] as const,
    ),
  )(
    'stops every remaining dev process when %s exits unexpectedly',
    (_processName, failedProcess) => {
      const children: FakeChildProcess[] = [];
      const errors: string[] = [];
      let exitCode = 0;
      const forceExitTimer = {
        unref: jest.fn(),
      };

      startDevAllProcesses({
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

      const failedIndex = DEV_ALL_PROCESSES.findIndex(
        (processConfig) => processConfig.name === failedProcess.name,
      );
      children[failedIndex].exit(1, null);

      expect(exitCode).toBe(1);
      expect(errors[0]).toContain(failedProcess.name);
      const remainingChildren = children.filter(
        (_, index) => index !== failedIndex,
      );
      expect(
        remainingChildren.every((child) =>
          child.killSignals.includes('SIGTERM'),
        ),
      ).toBe(true);
      expect(forceExitTimer.unref).toHaveBeenCalled();
    },
  );
});
