import test from 'node:test';
import assert from 'node:assert/strict';
import { stopAtBoundary } from '../src/dashboard/playback.js';

test('review playback stops exactly at the highlight boundary', () => {
  const player = { currentTime: 12.2, pauseCalls: 0, pause() { this.pauseCalls++; } };
  assert.equal(stopAtBoundary(player, 12), true);
  assert.equal(player.currentTime, 12);
  assert.equal(player.pauseCalls, 1);
  assert.equal(stopAtBoundary(player, 13), false);
});
