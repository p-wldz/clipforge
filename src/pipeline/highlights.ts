import type { Highlight } from '../core/db.js';
import { createHash } from 'node:crypto';
export interface Interval {
  start: number;
  end: number;
}
export type CandidateSignal = Interval & {
  source?: 'audio_activity' | 'volume_peak' | 'speech' | 'sound_event' | 'scene_change';
};
const sourceLabels = {
  audio_activity: 'audio activity',
  volume_peak: 'a volume peak',
  speech: 'a speech window',
  sound_event: 'a sound-classifier event',
  scene_change: 'a scene change',
} as const;
const sourceWeight = {
  audio_activity: 1,
  speech: 2,
  scene_change: 2,
  volume_peak: 3,
  sound_event: 4,
} as const;
// Baseline candidate generation, NOT kill detection. It favors distinct active windows and never invents events.
export function candidates(
  clipId: string,
  duration: number,
  active: CandidateSignal[],
  limit: number,
  target: number,
): Highlight[] {
  const windows: Interval[] = [];
  const evidence = new Map<string, string[]>();
  for (const a of [...active].sort((x, y) => {
    const xWeight = x.source ? sourceWeight[x.source] : 1;
    const yWeight = y.source ? sourceWeight[y.source] : 1;
    return yWeight - xWeight || y.end - y.start - (x.end - x.start);
  })) {
    const center = (a.start + a.end) / 2;
    const start = Math.max(0, Math.min(duration - target, center - target / 2));
    const end = Math.min(duration, start + target);
    if (end - start < 0.5) continue;
    if (
      windows.some(
        (w) => Math.max(0, Math.min(end, w.end) - Math.max(start, w.start)) / (end - start) > 0.55,
      )
    )
      continue;
    windows.push({ start, end });
    evidence.set(
      `${start.toFixed(2)}:${end.toFixed(2)}`,
      active
        .filter((signal) => signal.end >= start && signal.start <= end && signal.source)
        .map((signal) => sourceLabels[signal.source!]),
    );
    if (windows.length >= limit) break;
  }
  if (windows.length === 0 && duration > 0)
    windows.push({ start: 0, end: Math.min(duration, target) });
  return windows
    .sort((a, b) => a.start - b.start)
    .map((w, i) => ({
      id: createHash('sha256')
        .update(`${clipId}:${w.start.toFixed(2)}:${w.end.toFixed(2)}`)
        .digest('hex')
        .slice(0, 20),
      clip_id: clipId,
      start: Number(w.start.toFixed(2)),
      end: Number(w.end.toFixed(2)),
      title: `Candidate ${i + 1}`,
      description:
        `${[...new Set(evidence.get(`${w.start.toFixed(2)}:${w.end.toFixed(2)}`) ?? [])].join(', ') || 'local activity'} candidate; requires review. No gameplay event has been verified.`,
      score: 50,
      status: 'pending_review',
      origin: 'heuristic',
      created_at: new Date().toISOString(),
    }));
}
