import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserPreviewMetadataPath,
  browserPreviewPath,
  needsBrowserPreview,
} from '../dist/core/browser-playback.js';

test('only likely browser-native containers skip the local preview offer', () => {
  assert.equal(needsBrowserPreview('recording.MP4'), false);
  assert.equal(needsBrowserPreview('recording.webm'), false);
  assert.equal(needsBrowserPreview('recording.mov'), true);
  assert.equal(needsBrowserPreview('recording.mkv'), true);
});

test('browser preview artifacts stay under the clip artifact directory', () => {
  assert.match(
    browserPreviewPath('workspace', 'clip-123'),
    /artifacts[\\/]clip-123[\\/]browser-preview\.mp4$/,
  );
  assert.match(
    browserPreviewMetadataPath('workspace', 'clip-123'),
    /artifacts[\\/]clip-123[\\/]browser-preview\.json$/,
  );
});
