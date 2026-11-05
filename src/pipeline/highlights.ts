import type { Highlight } from '../core/db.js';
import { createHash } from 'node:crypto';
export interface Interval {
  start: number;
  end: number;
}
// Baseline candidate generation, NOT kill detection. It favors distinct active windows and never invents events.
export function candidates(
  clipId: string,
  duration: number,
  active: Interval[],
  limit: number,
  target: number,
): Highlight[] {
  const windows: Interval[] = [];
  for (const a of active.sort((x, y) => y.end - y.start - (x.end - x.start))) {
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
        'Audio-activity candidate; requires review. No gameplay event has been verified.',
      score: 50,
      status: 'pending_review',
      origin: 'heuristic',
      created_at: new Date().toISOString(),
    }));
}
