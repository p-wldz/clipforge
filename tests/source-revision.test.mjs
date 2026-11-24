import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceRevision } from '../dist/core/paths.js';

test('source revision changes when a local source file is replaced', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-source-revision-'));
  const file = path.join(root, 'clip.mp4');
  try {
    await writeFile(file, 'first');
    const first = await sourceRevision(file);
    await writeFile(file, 'a deliberately different replacement');
    const replacement = await sourceRevision(file);
    assert.notEqual(replacement, first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
