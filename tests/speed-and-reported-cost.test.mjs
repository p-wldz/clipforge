import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../dist/core/paths.js';
import { Store } from '../dist/core/db.js';
import { audioTempoFilter } from '../dist/pipeline/render.js';
import { parseClaudeReportedCost } from '../dist/core/usage.js';

test('audio tempo factors support 0.25x to 4x without invalid factors', () => {
  assert.equal(audioTempoFilter(0.25), 'atempo=0.5,atempo=0.5');
  assert.equal(audioTempoFilter(0.5), 'atempo=0.5');
  assert.equal(audioTempoFilter(1), 'atempo=1');
  assert.equal(audioTempoFilter(4), 'atempo=2,atempo=2');
  assert.throws(() => audioTempoFilter(0), /Speed/);
});
test('montage stores speed without changing original highlight', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-speed-'));
  await initWorkspace(root);
  const db = new Store(root),
    now = new Date().toISOString();
  try {
    db.upsertClip({
      id: 'clip',
      source_path: path.join(root, 'clips', 'test.mp4'),
      duration: 20,
      width: 1280,
      height: 720,
      analyzed_at: now,
      transcript: null,
    });
    db.upsertHighlight({
      id: 'high',
      clip_id: 'clip',
      start: 2,
      end: 10,
      title: 'Blast',
      description: '',
      score: 70,
      status: 'approved',
      origin: 'codex',
      created_at: now,
    });
    db.createEditorProject('edit', 'Clip', ['high']);
    assert.equal(db.editorProject('edit').items[0].speed, 1);
    assert.equal(
      db.updateEditorProject('edit', {
        name: 'Clip',
        description: '',
        items: [{ highlightId: 'high', start: 1, end: 11, speed: 0.5 }],
      }).items[0].speed,
      0.5,
    );
    assert.equal(db.highlight('high').start, 2);
    assert.throws(
      () =>
        db.updateEditorProject('edit', {
          name: 'Clip',
          description: '',
          items: [{ highlightId: 'high', start: 1, end: 11, speed: 5 }],
        }),
      /Invalid cut/,
    );
  } finally {
    db.close();
  }
});
test('Claude reported cost is separate from API estimate', () => {
  assert.equal(parseClaudeReportedCost({ total_cost_usd: 0.0123 }), 0.0123);
  assert.equal(parseClaudeReportedCost({ usage: { input_tokens: 12 } }), null);
  assert.equal(parseClaudeReportedCost({ total_cost_usd: -2 }), null);
});
