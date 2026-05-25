import { startWorkerProcesses } from './workers-runner';

const runner = startWorkerProcesses({
  dev: process.argv.includes('--dev'),
});

process.on('SIGINT', () => runner.shutdown('SIGINT'));
process.on('SIGTERM', () => runner.shutdown('SIGTERM'));
