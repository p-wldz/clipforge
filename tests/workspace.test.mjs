import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, loadConfig } from '../dist/core/paths.js';

test('customized project initializes safely with creative brief and persistent config', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-workspace-'));
  try {
    await initWorkspace(root, {
      name: 'Explosions',
      description: 'Test clips',
      focus: 'Tank explosions and funny dialogue',
      mediaDir: 'recordings',
      frameIntervalSeconds: 2,
      hasAudio: true,
    });
    const config = await loadConfig(root);
    assert.equal(config.mediaDir, 'recordings');
    assert.equal(config.analysis.frameIntervalSeconds, 2);
    assert.equal(config.project.focus, 'Tank explosions and funny dialogue');
    assert.ok(
      (await readFile(path.join(root, '.clipforge', 'context.md'), 'utf8')).includes(
        'Tank explosions',
      ),
    );
    assert.ok((await stat(path.join(root, 'recordings'))).isDirectory());
    assert.ok(
      (await readFile(path.join(root, '.clipforge', 'workflow.json'), 'utf8')).includes(
        'human-review',
      ),
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('clips directory cannot escape project root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-path-'));
  try {
    await assert.rejects(() => initWorkspace(root, { mediaDir: '../outside' }), /Clips folder/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
