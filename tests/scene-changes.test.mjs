import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneChanges } from '../dist/pipeline/media.js';

test('scene-change parser extracts stable FFmpeg timestamps', () => {
  const changes = parseSceneChanges(
    '[Parsed_showinfo_1] n:0 pts:1500 pts_time:1.5000\n[Parsed_showinfo_1] n:1 pts:3000 pts_time:3',
  );
  assert.deepEqual(changes, [{ at: 1.5 }, { at: 3 }]);
});
