import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHighlights, parseEvaluationFixture } from '../dist/pipeline/evaluation.js';

const highlight = (id, start, end, clip = 'clip') => ({
  id,
  clip_id: clip,
  start,
  end,
  title: id,
  description: '',
  score: 50,
  status: 'pending_review',
  origin: 'heuristic',
  created_at: '2026-01-01T00:00:00.000Z',
});

test('quality evaluation matches moments once and reports boundary error and duplicates', () => {
  const fixture = parseEvaluationFixture({
    version: 1,
    moments: [
      { id: 'first', clipId: 'clip', start: 10, end: 15 },
      { id: 'missing', clipId: 'clip', start: 30, end: 35 },
    ],
  });
  const report = evaluateHighlights(fixture, [
    highlight('match', 9, 16),
    highlight('duplicate', 10, 15),
    highlight('false-positive', 40, 44),
  ]);
  assert.equal(report.matched, 1);
  assert.equal(report.precision, 0.3333);
  assert.equal(report.recall, 0.5);
  assert.equal(report.meanBoundaryErrorSeconds, 0);
  assert.equal(report.duplicateProposals, 1);
  assert.deepEqual(report.unmatchedExpectedIds, ['missing']);
  assert.deepEqual(report.unmatchedHighlightIds, ['match', 'false-positive']);
});

test('quality evaluation rejects malformed fixtures', () => {
  assert.throws(
    () =>
      parseEvaluationFixture({
        version: 1,
        moments: [{ id: 'bad', clipId: 'clip', start: 3, end: 3 }],
      }),
    /Invalid evaluation moment/,
  );
  assert.throws(
    () =>
      parseEvaluationFixture({
        version: 1,
        moments: [
          { id: 'same', clipId: 'clip', start: 1, end: 2 },
          { id: 'same', clipId: 'clip', start: 3, end: 4 },
        ],
      }),
    /unique/,
  );
});
