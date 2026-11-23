import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectSoundEvents, inspectAudio } from '../dist/pipeline/audio-signals.js';
import { run } from '../dist/core/process.js';

test('detects sudden audio increase without declaring an explosion', () => {
  const levels = Array.from({ length: 50 }, (_, i) => ({
    start: i * 0.1,
    rmsDbfs: i >= 20 && i < 25 ? -8 : -45,
    peakDbfs: i >= 20 && i < 25 ? -4 : -35,
  }));
  const events = detectSoundEvents(levels);
  assert(events.some((x) => x.type === 'loud_impulse'));
  assert(events.every((x) => !x.type.includes('explosion')));
});

test('FFmpeg PCM audio inspection identifies signal peaks', async (t) => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    t.skip('ffmpeg unavailable');
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'clipforge-audio-'));
  try {
    const file = path.join(dir, 'sound.wav');
    await run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=if(between(t\\,0.7\\,1.1)\\,0.8*sin(2*PI*180*t)\\,0.002*sin(2*PI*180*t)):s=16000:d=2',
      '-y',
      file,
    ]);
    const result = await inspectAudio(file, true);
    assert(result.levels.length > 5);
    assert(result.events.length >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
