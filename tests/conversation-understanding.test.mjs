import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversationUnderstanding } from '../dist/pipeline/staged-ai.js';

const utterances = ['utt-1', 'utt-2', 'utt-3', 'utt-4'];
const events = ['sound-1'];
test('conversation understanding preserves a delayed joke and validated evidence links', () => {
  const value = parseConversationUnderstanding(
    JSON.stringify({
      conversations: [
        {
          conversationId: 'conversation-1',
          start: 5,
          end: 45,
          summary: 'A risky plan becomes a joke after a blast.',
          topic: 'Failed plan',
          type: 'humorous_interaction',
          narrativePhases: [
            { type: 'setup', start: 5, end: 12 },
            { type: 'payoff', start: 37, end: 43 },
            { type: 'reaction', start: 43, end: 45 },
          ],
          dominantModality: 'dialogue',
          visualActivity: 'low',
          keyUtteranceIds: utterances,
          relatedEventIds: events,
          relationships: [
            {
              sourceId: 'utt-3',
              targetId: 'sound-1',
              type: 'reacts_to',
              evidenceIds: ['utt-3', 'sound-1'],
              confidence: 0.84,
              reason: 'The statement follows the sound and describes the outcome.',
            },
          ],
          interpretation: { humor: 'high', narrativeValue: 'high', actionRelevance: 'medium' },
          confidence: 0.86,
          uncertainties: ['The blast cause is not visually confirmed.'],
        },
      ],
    }),
    50,
    'clip',
    utterances,
    events,
  );
  assert.equal(value.conversations[0].narrativePhases.at(-1).type, 'reaction');
  assert.equal(value.conversations[0].relationships[0].targetId, 'sound-1');
});
test('conversation understanding drops invalid references instead of inventing a temporal link', () => {
  const value = parseConversationUnderstanding(
    JSON.stringify({
      conversations: [
        {
          start: 1,
          end: 4,
          summary: 'Chatter.',
          keyUtteranceIds: ['utt-1'],
          relationships: [
            { sourceId: 'utt-1', targetId: 'not-real', type: 'reacts_to', reason: 'Near in time' },
          ],
          interpretation: {},
        },
      ],
    }),
    10,
    'clip',
    utterances,
    events,
  );
  assert.equal(value.conversations[0].relationships.length, 0);
});
