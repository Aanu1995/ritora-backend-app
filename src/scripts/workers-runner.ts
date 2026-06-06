import { join } from 'path';
import { spawn } from 'child_process';

export type WorkerProcessName =
  | 'account-deletion-worker'
  | 'account-monitoring-worker'
  | 'skin-journal-analysis-worker'
  | 'skin-journal-insight-worker'
  | 'smart-picks-generation-worker'
  | 'ingredient-product-analysis-worker';

export type WorkerProcess = {
  name: WorkerProcessName;
  entryFile: string;
};

export type WorkerDevProcess = {
  name: WorkerProcessName;
  args: readonly string[];
};

export type WorkerChildProcess = {
  readonly pid?: number;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
};

type WorkerSpawnOptions = {
  env: NodeJS.ProcessEnv;
  stdio: 'inherit';
  detached: boolean;
};

type ForceExitTimer = {
  unref?: () => void;
};

export type StartWorkerOptions = {
  processes?: readonly WorkerProcess[];
  devProcesses?: readonly WorkerDevProcess[];
  dev?: boolean;
  env?: NodeJS.ProcessEnv;
  entryDir?: string;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: WorkerSpawnOptions,
  ) => WorkerChildProcess;
  killProcess?: (child: WorkerChildProcess, signal: NodeJS.Signals) => void;
  setForceExitTimer?: (callback: () => void, delayMs: number) => ForceExitTimer;
  setExitCode?: (code: number) => void;
  exitProcess?: (code: number) => void;
  writeError?: (message: string) => void;
};

export type WorkerRunner = {
  shutdown(signal: NodeJS.Signals): void;
};

export const WORKER_PROCESSES: readonly WorkerProcess[] = [
  {
    name: 'account-deletion-worker',
    entryFile: 'start-account-deletion-worker.js',
  },
  {
    name: 'account-monitoring-worker',
    entryFile: 'start-account-monitoring-worker.js',
  },
  {
    name: 'skin-journal-analysis-worker',
    entryFile: 'start-skin-journal-analysis-worker.js',
  },
  {
    name: 'skin-journal-insight-worker',
    entryFile: 'start-skin-journal-insight-worker.js',
  },
  {
    name: 'smart-picks-generation-worker',
    entryFile: 'start-smart-picks-generation-worker.js',
  },
  {
    name: 'ingredient-product-analysis-worker',
    entryFile: 'start-ingredient-product-analysis-worker.js',
  },
];

export const WORKER_DEV_PROCESSES: readonly WorkerDevProcess[] = [
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

export function startWorkerProcesses(
  options: StartWorkerOptions = {},
): WorkerRunner {
  const children = new Map<WorkerProcessName, WorkerChildProcess>();
  const spawnProcess = options.spawnProcess ?? spawnChildProcess;
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
  const processConfigs = options.dev
    ? toSpawnableDevProcesses(options.devProcesses ?? WORKER_DEV_PROCESSES)
    : toSpawnableWorkerProcesses(
        options.processes ?? WORKER_PROCESSES,
        options.entryDir ?? __dirname,
      );
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

  for (const processConfig of processConfigs) {
    const child = spawnProcess(processConfig.command, processConfig.args, {
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
        `[workers] ${processConfig.name} exited unexpectedly with ${exitReason}. Stopping the remaining workers.`,
      );
      setExitCode(code && code > 0 ? code : 1);
      shutdown('SIGTERM');
    });
  }

  return { shutdown };
}

type SpawnableWorkerProcess = {
  name: WorkerProcessName;
  command: string;
  args: readonly string[];
};

function toSpawnableWorkerProcesses(
  processes: readonly WorkerProcess[],
  entryDir: string,
): SpawnableWorkerProcess[] {
  return processes.map((processConfig) => ({
    name: processConfig.name,
    command: process.execPath,
    args: [join(entryDir, processConfig.entryFile)],
  }));
}

function toSpawnableDevProcesses(
  processes: readonly WorkerDevProcess[],
): SpawnableWorkerProcess[] {
  return processes.map((processConfig) => ({
    name: processConfig.name,
    command: npmCommand(),
    args: processConfig.args,
  }));
}

function spawnChildProcess(
  command: string,
  args: readonly string[],
  options: WorkerSpawnOptions,
): WorkerChildProcess {
  return spawn(command, [...args], options);
}

function killChildProcess(
  child: WorkerChildProcess,
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
