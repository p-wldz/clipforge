import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadEnvironmentFile } from '../dist/core/environment.js';

test('explicit environment file loads safe dotenv entries without replacing shell values', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-env-'));
  const file = path.join(dir, 'credentials.env');
  const old = process.env.CLIPFORGE_ENV_TEST_KEY;
  try {
    await writeFile(file, '# comment\nexport CLIPFORGE_ENV_TEST_KEY="from file"\nOTHER_KEY=value # note\n');
    process.env.CLIPFORGE_ENV_TEST_KEY = 'from shell';
    const result = await loadEnvironmentFile(file);
    assert.equal(result.loaded, 1);
    assert.equal(process.env.CLIPFORGE_ENV_TEST_KEY, 'from shell');
    assert.equal(process.env.OTHER_KEY, 'value');
  } finally {
    if (old === undefined) delete process.env.CLIPFORGE_ENV_TEST_KEY;
    else process.env.CLIPFORGE_ENV_TEST_KEY = old;
    delete process.env.OTHER_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test('explicit environment file reports an invalid entry by line', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-env-'));
  const file = path.join(dir, 'credentials.env');
  try {
    await writeFile(file, 'NOT VALID\n');
    await assert.rejects(() => loadEnvironmentFile(file), /credentials\.env:1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
