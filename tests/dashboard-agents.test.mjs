import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, loadConfig } from '../dist/core/paths.js';
import { startServer } from '../dist/server.js';

test('AI stage profiles preserve legacy agent and expose API model scan', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-agent-settings-'));
  const server = startServer(dir, 0);
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  try {
    await initWorkspace(dir);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    let res = await fetch(base + '/api/ai/models');
    assert.equal(res.status, 200);
    let data = await res.json();
    assert.ok(data.providers.codex);
    assert.equal(data.stages.clipAnalysis.provider, 'none');
    res = await fetch(base + '/api/ai/stages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clipAnalysis: { provider: 'codex', model: 'test-model' },
        montage: { provider: 'claude', model: 'different-model' },
      }),
    });
    assert.equal(
      res.status,
      400,
      'Cannot save unverified model identifiers or unavailable CLI providers',
    );
    res = await fetch(base + '/api/ai/stages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clipAnalysis: { provider: 'none' },
        montage: { provider: 'none' },
      }),
    });
    assert.equal(res.status, 200);
    const cfg = await loadConfig(dir);
    assert.equal(cfg.aiStages.clipAnalysis.provider, 'none');
    assert.equal(cfg.aiStages.montage.provider, 'none');
    res = await fetch(base + '/api/ai/stages', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clipAnalysis: { provider: 'cursor' },
        montage: { provider: 'claude' },
      }),
    });
    assert.equal(res.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test('dashboard analysis start checks inputs and reports failures asynchronously', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-ui-run-'));
  await initWorkspace(dir);
  const server = startServer(dir, 0);
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let r = await fetch(base + '/api/analysis/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'cursor', force: false }),
    });
    assert.equal(r.status, 400);
    r = await fetch(base + '/api/analysis/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'none', force: false }),
    });
    assert.equal(r.status, 202);
    const job = await r.json();
    assert.ok(job.jobId);
    await new Promise((r) => setTimeout(r, 300));
    const status = await (await fetch(base + '/api/analysis/jobs/' + job.jobId)).json();
    assert.equal(status.status, 'completed');
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
