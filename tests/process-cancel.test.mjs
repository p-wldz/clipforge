import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../dist/core/process.js';

test('aborting a subprocess reports cancellation', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      signal: controller.signal,
    }),
    { name: 'AbortError', message: 'Process cancelled' },
  );
});
