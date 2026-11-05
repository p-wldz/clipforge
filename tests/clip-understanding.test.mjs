import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClipUnderstanding } from '../dist/agents/agent.js';

test('full clip analysis validates timeline and score', () => {
  const result = parseClipUnderstanding(
    '```json\n' +
      JSON.stringify({
        title: 'Ambush',
        summary: 'A team prepares, then a loud explosion occurs.',
        story: [{ start: 0, end: 5, description: 'Setup' }],
        tags: ['explosion'],
        highlights: [
          {
            start: 3,
            end: 12,
            score: 94,
            title: 'Explosion',
            description: 'Loud boom',
            reason: 'Strong reaction',
          },
        ],
      }) +
      '\n```',
    20,
  );
  assert.equal(result.summary, 'A team prepares, then a loud explosion occurs.');
  assert.equal(result.highlights[0].score, 94);
  assert.equal(result.highlights[0].start, 3);
});
test('rejects invalid AI timestamps instead of silently treating heuristic as AI', () => {
  assert.throws(
    () =>
      parseClipUnderstanding(
        JSON.stringify({
          title: 'Bad',
          summary: 'Bad',
          highlights: [
            {
              start: 50,
              end: 80,
              score: 100,
              title: 'Wrong',
              description: 'Wrong',
            },
          ],
        }),
        30,
      ),
    /no valid time ranges/,
  );
});
