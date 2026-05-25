import { startDevAllProcesses } from './dev-all-runner';

const runner = startDevAllProcesses();

process.on('SIGINT', () => runner.shutdown('SIGINT'));
process.on('SIGTERM', () => runner.shutdown('SIGTERM'));
