import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
test('AST ignores 213 sample trailing audio, but keeps valid windows', (t) => {
  const code = `from audio_windowing import ast_windows\nimport json\nprint(json.dumps(list(ast_windows(80213, 40000, 40000))))`;
  const result = spawnSync(python, ['-c', code], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: path.join(process.cwd(), 'tools') },
    encoding: 'utf8',
  });
  if (result.status === null) {
    t.skip(
      `Python worker could not start${result.error?.message ? `: ${result.error.message}` : ''}`,
    );
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [
    [0, 40000],
    [40000, 80000],
  ]);
});
test('AST skips audio too short for Kaldi without inference', (t) => {
  const code = `from audio_windowing import ast_windows\nprint(list(ast_windows(213, 80000, 40000)))`;
  const result = spawnSync(python, ['-c', code], {
    env: { ...process.env, PYTHONPATH: path.join(process.cwd(), 'tools') },
    encoding: 'utf8',
  });
  if (result.status === null) {
    t.skip(
      `Python worker could not start${result.error?.message ? `: ${result.error.message}` : ''}`,
    );
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '[]');
});
