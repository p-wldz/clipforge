import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardStatus } from '../dist/core/dashboard-status.js';

test('dashboard console status reports current analysis progress on one line', () => {
  assert.equal(dashboardStatus(), 'analysis: idle');
  assert.equal(
    dashboardStatus({
      status: 'running',
      current_stage: 'frames',
      processed_count: 2,
      source_count: 5,
      current_file: 'round-3.mp4',
    }),
    'analysis: running · frames 2/5 · round-3.mp4',
  );
});
