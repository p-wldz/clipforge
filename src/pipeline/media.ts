import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { run } from '../core/process.js';
export interface Metadata {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}
export interface FrameSample {
  path: string;
  timestamp: number;
}
export async function probe(file: string, signal?: AbortSignal): Promise<Metadata> {
  const { stdout } = await run(
    'ffprobe',
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file],
    { signal },
  );
  const raw = JSON.parse(String(stdout)) as {
    format: { duration: string };
    streams: Array<{ codec_type: string; width?: number; height?: number }>;
  };
  const video = raw.streams.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('Not a video: ' + file);
  return {
    duration: Number(raw.format.duration),
    width: video.width ?? 0,
    height: video.height ?? 0,
    hasAudio: raw.streams.some((s) => s.codec_type === 'audio'),
  };
}
export async function frames(
  file: string,
  targetDir: string,
  interval: number,
  duration: number,
  maxWidth = 640,
  signal?: AbortSignal,
) {
  await mkdir(targetDir, { recursive: true });
  // Keep a bounded artifact count while covering the entire source. Using the
  // requested interval for only the first 30 samples leaves a long ending unseen.
  const count = Math.min(30, Math.max(1, Math.ceil(duration / interval)));
  const sampleInterval = duration / count;
  const results: FrameSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = Math.min(duration - 0.01, (i + 0.5) * sampleInterval);
    // Timestamp is part of the cache identity: a change in sampling coverage
    // must never relabel a previously cached image as a later moment.
    const output = path.join(
      targetDir,
      `frame-${String(i).padStart(3, '0')}-${Math.round(t * 1000)}ms-${maxWidth}.jpg`,
    );
    try {
      await readFile(output);
    } catch {
      await run(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          String(Math.max(0, t)),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `scale=${maxWidth}:-2`,
          '-q:v',
          '5',
          output,
        ],
        { timeoutMs: 60000, signal },
      );
    }
    results.push({ path: output, timestamp: t });
  }
  return results;
}
export async function audioEvents(
  file: string,
  duration: number,
  hasAudio: boolean,
  minSilence: number,
  signal?: AbortSignal,
) {
  if (!hasAudio) return [{ start: 0, end: duration }];
  try {
    const { stderr } = await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        file,
        '-af',
        `silencedetect=noise=-27dB:d=${minSilence}`,
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 120000, signal },
    );
    const re = /silence_(start|end):\s*([0-9.]+)/g;
    const silences: { start: number; end: number }[] = [];
    let start: number | undefined;
    for (const match of stderr.matchAll(re)) {
      const t = Number(match[2]);
      if (match[1] === 'start') start = t;
      else if (start !== undefined) {
        silences.push({ start, end: t });
        start = undefined;
      }
    }
    if (start !== undefined) silences.push({ start, end: duration });
    let cursor = 0;
    const active: { start: number; end: number }[] = [];
    for (const silence of silences) {
      if (silence.start - cursor > 0.5) active.push({ start: cursor, end: silence.start });
      cursor = silence.end;
    }
    if (duration - cursor > 0.5) active.push({ start: cursor, end: duration });
    return active.length ? active : [{ start: 0, end: duration }];
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    return [{ start: 0, end: duration }];
  }
}
export async function saveJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n');
}
