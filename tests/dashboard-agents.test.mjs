import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, loadConfig, saveConfig } from '../dist/core/paths.js';
import { Store } from '../dist/core/db.js';
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
    const idle = await (await fetch(base + '/api/analysis/jobs/active')).json();
    assert.equal(idle.status, 'idle');
    const noActiveCancel = await fetch(base + '/api/analysis/jobs/active/cancel', {
      method: 'POST',
    });
    assert.equal(noActiveCancel.status, 409);
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

test('dashboard shutdown waits for its analysis to be recorded as cancelled', async (t) => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    t.skip('ffmpeg unavailable');
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-dashboard-stop-'));
  await initWorkspace(dir);
  const clip = path.join(dir, 'clips', 'slow-cancel.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=32x32:r=1',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=8000:cl=mono',
    '-t',
    '2',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    '-shortest',
    '-y',
    clip,
  ]);
  const config = await loadConfig(dir);
  config.transcription = {
    enabled: true,
    provider: 'whisper-cli',
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
  };
  await saveConfig(dir, config);
  const server = startServer(dir, 0);
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/analysis/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'none', force: false }),
    });
    assert.equal(response.status, 202);
    let transcribing = false;
    for (let i = 0; i < 100; i++) {
      const db = new Store(dir);
      try {
        transcribing = db.runs()[0]?.current_stage === 'transcription';
        if (transcribing) break;
      } finally {
        db.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(transcribing, 'analysis should reach the deliberately slow transcription stage');
    await server.abortAnalysis();
    const db = new Store(dir);
    try {
      assert.equal(db.runs()[0].status, 'cancelled');
    } finally {
      db.close();
    }
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});

test('dashboard can clear an abandoned analysis record without an in-memory job', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-dashboard-stale-'));
  await initWorkspace(dir);
  const db = new Store(dir);
  db.startRun('abandoned-run', 'none', 1);
  db.close();
  const server = startServer(dir, 0);
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once('listening', resolve),
  );
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/analysis/runs/abandoned-run/cancel', {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'cancelled');
    const check = new Store(dir);
    try {
      assert.equal(check.runs()[0].status, 'cancelled');
    } finally {
      check.close();
    }
  } finally {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
