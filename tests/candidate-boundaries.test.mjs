import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { candidates, padCandidateBoundary } from '../dist/pipeline/highlights.js';
import { initWorkspace } from '../dist/core/paths.js';
import { Store } from '../dist/core/db.js';

test('candidate padding preserves source boundaries and adds asymmetric context', () => {
  assert.deepEqual(
    padCandidateBoundary({ start: 0.2, end: 9.8 }, 10, {
      preRollSeconds: 0.5,
      postRollSeconds: 0.5,
    }),
    { start: 0, end: 10 },
  );
  const result = candidates('clip', 20, [{ start: 10, end: 10, source: 'volume_peak' }], 1, 4, {
    preRollSeconds: 0.5,
    postRollSeconds: 1,
  });
  assert.equal(result[0].start, 7.5);
  assert.equal(result[0].end, 13);
});

test('resetting a clip removes generated highlights but retains review observations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cf-reset-'));
  try {
    await initWorkspace(root);
    const db = new Store(root);
    try {
      db.upsertClip({
        id: 'clip',
        source_path: 'test.mp4',
        duration: 20,
        width: 640,
        height: 360,
        analyzed_at: new Date().toISOString(),
        transcript: null,
      });
      db.upsertHighlight({
        id: 'highlight',
        clip_id: 'clip',
        start: 3,
        end: 8,
        title: 'Moment',
        description: '',
        score: 50,
        status: 'approved',
        origin: 'heuristic',
        created_at: new Date().toISOString(),
      });
      db.saveFeedback({
        highlightId: 'highlight',
        rating: 4,
        category: 'starts_too_late',
        notes: 'Show the setup',
        favorite: true,
      });
      assert.equal(db.resetClipHighlights('clip'), 1);
      assert.equal(db.highlight('highlight'), undefined);
      assert.deepEqual(
        db.reviewObservations('clip').map((row) => ({
          start: row.start,
          end: row.end,
          category: row.category,
          notes: row.notes,
          favorite: row.favorite,
        })),
        [{ start: 3, end: 8, category: 'starts_too_late', notes: 'Show the setup', favorite: 1 }],
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
