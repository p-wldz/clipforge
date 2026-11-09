import path from 'node:path';
import { artifactDir } from './paths.js';

// These containers are broadly supported by current desktop browsers. Codec support
// can still vary, so the dashboard offers an explicit local MP4 preview when needed.
export function needsBrowserPreview(sourcePath: string) {
  return !['.mp4', '.webm'].includes(path.extname(sourcePath).toLowerCase());
}

export function browserPreviewPath(root: string, clipId: string) {
  return path.join(artifactDir(root, clipId), 'browser-preview.mp4');
}

export function browserPreviewMetadataPath(root: string, clipId: string) {
  return path.join(artifactDir(root, clipId), 'browser-preview.json');
}
