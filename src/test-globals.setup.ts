import {
  clearInterval as nodeClearInterval,
  clearTimeout as nodeClearTimeout,
  setInterval as nodeSetInterval,
  setTimeout as nodeSetTimeout,
} from 'node:timers';

type GlobalWithMutableRuntime = typeof globalThis & {
  clearInterval?: typeof clearInterval;
  clearTimeout?: typeof clearTimeout;
  fetch?: typeof fetch;
  setInterval?: typeof setInterval;
  setTimeout?: typeof setTimeout;
};

const runtime = globalThis as GlobalWithMutableRuntime;

function installGlobalRuntimeValue<Key extends keyof GlobalWithMutableRuntime>(
  key: Key,
  value: NonNullable<GlobalWithMutableRuntime[Key]>,
): void {
  if (typeof runtime[key] !== 'undefined') return;
  Object.defineProperty(runtime, key, {
    configurable: true,
    writable: true,
    value,
  });
}

installGlobalRuntimeValue('setTimeout', nodeSetTimeout);
installGlobalRuntimeValue('clearTimeout', nodeClearTimeout);
installGlobalRuntimeValue('setInterval', nodeSetInterval);
installGlobalRuntimeValue('clearInterval', nodeClearInterval);
installGlobalRuntimeValue('fetch', () => {
  throw new Error('global.fetch was called without a test mock');
});
