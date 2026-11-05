import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSoundEvents } from '../dist/pipeline/sound-classifier.js';

test('classifier result validation keeps time-bounded estimates', () => {
  const values = validateSoundEvents(
    {
      events: [
        {
          start: 1,
          end: 4,
          label: 'Explosion',
          confidence: 0.81,
          provider: 'ast',
        },
        {
          start: -1,
          end: 3,
          label: 'Gunshot',
          confidence: 0.6,
          provider: 'ast',
        },
        {
          start: 4,
          end: 300,
          label: 'Music',
          confidence: 0.5,
          provider: 'ast',
        },
      ],
    },
    10,
  );
  assert.equal(values.length, 1);
  assert.equal(values[0].label, 'Explosion');
  assert.throws(() => validateSoundEvents({}, 10), /invalid event/);
});
