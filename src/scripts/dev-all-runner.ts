import { spawn } from 'child_process';

export type DevProcessName =
  | 'api'
  | 'account-deletion-worker'
  | 'account-monitoring-worker'
  | 'skin-journal-analysis-worker'
  | 'skin-journal-insight-worker'
  | 'smart-picks-generation-worker'
  | 'ingredient-product-analysis-worker';

export type DevProcess = {
  name: DevProcessName;
  args: readonly string[];
};

export type DevChildProcess = {
  readonly pid?: number;
  readonly killed?: boolean;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
};

type DevSpawnOptions = {
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
  detached: boolean;
};

type ForceExitTimer = {
  unref?: () => void;
};

export type StartDevAllOptions = {
  processes?: readonly DevProcess[];
  env?: NodeJS.ProcessEnv;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: DevSpawnOptions,
  ) => DevChildProcess;
  killProcess?: (child: DevChildProcess, signal: NodeJS.Signals) => void;
  setForceExitTimer?: (callback: () => void, delayMs: number) => ForceExitTimer;
  setExitCode?: (code: number) => void;
  exitProcess?: (code: number) => void;
  writeError?: (message: string) => void;
};

export type DevAllRunner = {
  shutdown(signal: NodeJS.Signals): void;
};

export const DEV_ALL_PROCESSES: readonly DevProcess[] = [
  { name: 'api', args: ['run', 'start:dev'] },
  {
    name: 'account-deletion-worker',
    args: ['run', 'account-deletion-worker:dev'],
  },
  {
    name: 'account-monitoring-worker',
    args: ['run', 'account-monitoring-worker:dev'],
  },
  {
    name: 'skin-journal-analysis-worker',
    args: ['run', 'skin-journal:analysis-worker:dev'],
  },
  {
    name: 'skin-journal-insight-worker',
    args: ['run', 'skin-journal:insight-worker:dev'],
  },
  {
    name: 'smart-picks-generation-worker',
    args: ['run', 'smart-picks:generation-worker:dev'],
  },
  {
    name: 'ingredient-product-analysis-worker',
    args: ['run', 'ingredient-analysis:worker:dev'],
  },
];

const FORCE_EXIT_DELAY_MS = 5000;

export function startDevAllProcesses(
  options: StartDevAllOptions = {},
): DevAllRunner {
  const children = new Map<DevProcessName, DevChildProcess>();
  const processes = options.processes ?? DEV_ALL_PROCESSES;
  const spawnProcess = options.spawnProcess ?? spawnNpmProcess;
  const killProcess = options.killProcess ?? killChildProcess;
  const setForceExitTimer =
    options.setForceExitTimer ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const setExitCode =
    options.setExitCode ??
    ((code: number) => {
      process.exitCode = code;
    });
  const exitProcess =
    options.exitProcess ??
    ((code: number) => {
      process.exit(code);
    });
  const writeError = options.writeError ?? console.error;
  const env = options.env ?? process.env;
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const child of children.values()) {
      killProcess(child, signal);
    }

    const forceExitTimer = setForceExitTimer(() => {
      for (const child of children.values()) {
        killProcess(child, 'SIGKILL');
      }
      exitProcess(typeof process.exitCode === 'number' ? process.exitCode : 0);
    }, FORCE_EXIT_DELAY_MS);
    forceExitTimer.unref?.();
  };

  for (const processConfig of processes) {
    const child = spawnProcess(npmCommand(), processConfig.args, {
      env,
      stdio: 'inherit',
      detached: shouldDetachChildProcesses(),
    });

    children.set(processConfig.name, child);
    child.once('exit', (code, signal) => {
      children.delete(processConfig.name);
      if (shuttingDown) return;

      const exitReason =
        signal === null ? `code ${code ?? 0}` : `signal ${signal}`;
      writeError(
        `[dev:all] ${processConfig.name} exited unexpectedly with ${exitReason}. Stopping the remaining dev processes.`,
      );
      setExitCode(code && code > 0 ? code : 1);
      shutdown('SIGTERM');
    });
  }

  return { shutdown };
}

function spawnNpmProcess(
  command: string,
  args: readonly string[],
  options: DevSpawnOptions,
): DevChildProcess {
  return spawn(command, [...args], options);
}

function killChildProcess(
  child: DevChildProcess,
  signal: NodeJS.Signals,
): void {
  if (child.pid && shouldDetachChildProcesses()) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      child.kill(signal);
      return;
    }
  }

  child.kill(signal);
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function shouldDetachChildProcesses(): boolean {
  return process.platform !== 'win32';
}
