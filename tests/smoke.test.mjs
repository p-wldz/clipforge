import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from '../dist/pipeline/highlights.js';
import { inside } from '../dist/core/paths.js';

test('candidate windows are bounded and stable', () => {
  const input = [
    { start: 4, end: 12 },
    { start: 24, end: 38 },
  ];
  const result = candidates('clip', 45, input, 4, 12);
  assert.equal(result.length, 2);
  assert.ok(result.every((x) => x.start >= 0 && x.end <= 45 && x.end > x.start));
  assert.deepEqual(
    result.map((x) => x.id),
    candidates('clip', 45, input, 4, 12).map((x) => x.id),
  );
});
test('short clips are bounded', () => {
  const result = candidates('short', 3, [], 4, 12);
  assert.equal(result[0].end, 3);
});
test('candidate descriptions retain local evidence without claiming gameplay', () => {
  const result = candidates(
    'evidence',
    40,
    [
      { start: 10, end: 11, source: 'scene_change' },
      { start: 10.2, end: 10.6, source: 'volume_peak' },
      { start: 10.3, end: 10.8, source: 'speech' },
      { start: 10.4, end: 10.9, source: 'sound_event' },
    ],
    4,
    12,
  );
  assert.match(result[0].description, /scene change/);
  assert.match(result[0].description, /volume peak/);
  assert.match(result[0].description, /speech window/);
  assert.match(result[0].description, /sound-classifier event/);
  assert.match(result[0].description, /No gameplay event has been verified/);
});
test('workspace paths stay contained', () => {
  assert.equal(inside('/tmp/work', '/tmp/work/index.html'), true);
  assert.equal(inside('/tmp/work', '/tmp/wrong/index.html'), false);
});
