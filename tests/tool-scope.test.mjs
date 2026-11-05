import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initWorkspace, loadConfig, saveConfig, workspaceDir } from '../dist/core/paths.js';
import { venvPython, classifierPython } from '../dist/core/setup.js';
test('project or user Python environments are separate from project prompts and data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-scope-'));
  await initWorkspace(root);
  assert.ok(venvPython(root).startsWith(workspaceDir(root)));
  const cfg = await loadConfig(root);
  cfg.toolsScope = 'user';
  await saveConfig(root, cfg);
  assert.ok(venvPython(root).startsWith(path.join(os.homedir(), '.clipforge', 'tools')));
  assert.ok(classifierPython(root).startsWith(path.join(os.homedir(), '.clipforge', 'tools')));
  assert.ok(venvPython(root, process.platform, 'project').startsWith(workspaceDir(root)));
});
