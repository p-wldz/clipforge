import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, rm } from 'node:fs/promises';
import { run } from '../core/process.js';
import { classifierPython } from '../core/setup.js';
import { saveJson } from './media.js';
import type { Config } from '../core/paths.js';

export type ClassifiedSound = {
  start: number;
  end: number;
  label: string;
  confidence: number;
  provider: 'ast';
};
const script = fileURLToPath(new URL('../../tools/classify_sound_ast.py', import.meta.url));
export function validateSoundEvents(value: unknown, duration: number): ClassifiedSound[] {
  if (!value || typeof value !== 'object' || !('events' in value) || !Array.isArray(value.events))
    throw new Error('Classifier returned invalid event data');
  return value.events.filter((e: unknown): e is ClassifiedSound => {
    if (!e || typeof e !== 'object') return false;
    const item = e as Record<string, unknown>;
    return (
      typeof item.start === 'number' &&
      Number.isFinite(item.start) &&
      item.start >= 0 &&
      typeof item.end === 'number' &&
      Number.isFinite(item.end) &&
      item.end > item.start &&
      item.end <= duration + 0.1 &&
      typeof item.label === 'string' &&
      item.label.length > 0 &&
      typeof item.confidence === 'number' &&
      item.confidence >= 0 &&
      item.confidence <= 1 &&
      item.provider === 'ast'
    );
  });
}
export async function classifySound(
  root: string,
  config: Config,
  file: string,
  duration: number,
  artifact: string,
  signal?: AbortSignal,
): Promise<ClassifiedSound[]> {
  if (!config.soundClassifier.enabled) return [];
  await mkdir(artifact, { recursive: true });
  const wav = path.join(artifact, 'classifier-input.wav');
  try {
    await run(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-i',
        file,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        wav,
      ],
      { timeoutMs: 120000, signal },
    );
    const cfg = config.soundClassifier;
    const { stdout } = await run(
      cfg.command || classifierPython(root),
      [
        script,
        '--input',
        wav,
        '--model',
        cfg.model,
        '--window',
        String(cfg.windowSeconds),
        '--hop',
        String(cfg.hopSeconds),
        '--threshold',
        String(cfg.minConfidence),
        '--max-events',
        String(cfg.maxEvents),
      ],
      { timeoutMs: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, signal },
    );
    const events = validateSoundEvents(JSON.parse(String(stdout)), duration);
    await saveJson(path.join(artifact, 'sound-events.json'), events);
    return events;
  } finally {
    await rm(wav, { force: true }).catch(() => {});
  }
}
