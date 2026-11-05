import { run } from '../core/process.js';

export interface SoundEvent {
  start: number;
  end: number;
  type: 'loud_impulse' | 'sustained_loud_activity';
  confidence: number;
  peakDbfs: number;
  description: string;
}
export interface AudioSignals {
  windowSeconds: number;
  levels: Array<{ start: number; rmsDbfs: number; peakDbfs: number }>;
  events: SoundEvent[];
}
/** Deterministic signal analysis. These are NOT semantic explosion/gunshot labels. */
export async function inspectAudio(file: string, hasAudio: boolean): Promise<AudioSignals> {
  if (!hasAudio) return { windowSeconds: 0.1, levels: [], events: [] };
  const { stdout } = await run(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'],
    { timeoutMs: 120000, maxBuffer: 48 * 1024 * 1024, encoding: 'buffer' },
  );
  const buffer = stdout as Buffer;
  const sampleCount = Math.floor(buffer.length / 2),
    window = 1600;
  const levels: AudioSignals['levels'] = [];
  for (let off = 0; off < sampleCount; off += window) {
    let sum = 0,
      peak = 0;
    const end = Math.min(sampleCount, off + window);
    for (let i = off; i < end; i++) {
      const v = buffer.readInt16LE(i * 2) / 32768;
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.sqrt(sum / (end - off));
    levels.push({
      start: Number((off / 16000).toFixed(3)),
      rmsDbfs: 20 * Math.log10(Math.max(rms, 1e-6)),
      peakDbfs: 20 * Math.log10(Math.max(peak, 1e-6)),
    });
  }
  return { windowSeconds: 0.1, levels, events: detectSoundEvents(levels) };
}
export function detectSoundEvents(levels: AudioSignals['levels']): SoundEvent[] {
  if (!levels.length) return [];
  const sorted = levels.map((x) => x.rmsDbfs).sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length * 0.35)] ?? -60;
  const events: SoundEvent[] = [];
  let previous = levels[0]!.rmsDbfs;
  for (let i = 1; i < levels.length; i++) {
    const current = levels[i]!;
    const rise = current.rmsDbfs - previous;
    if (rise >= 8 && current.rmsDbfs > Math.max(-32, baseline + 12)) {
      const start = Math.max(0, current.start - 0.2),
        end = current.start + 0.5;
      const last = events.at(-1);
      if (last && start - last.end < 0.35) {
        last.end = end;
        last.peakDbfs = Math.max(last.peakDbfs, current.peakDbfs);
      } else
        events.push({
          start,
          end,
          type: 'loud_impulse',
          confidence: Math.min(0.85, Math.max(0.2, rise / 32)),
          peakDbfs: current.peakDbfs,
          description: 'Sudden audio intensity increase. Cause not classified.',
        });
    }
    previous = current.rmsDbfs;
  }
  // Group high-energy windows to reveal possible continuous combat or bombardment.
  let start = -1,
    peak = -120;
  for (let i = 0; i <= levels.length; i++) {
    const row = levels[i],
      loud = !!row && row.rmsDbfs > Math.max(-25, baseline + 10);
    if (loud) {
      if (start < 0) start = i;
      peak = Math.max(peak, row!.peakDbfs);
    } else if (start >= 0) {
      const duration = (i - start) * 0.1;
      if (duration >= 1.5)
        events.push({
          start: start * 0.1,
          end: i * 0.1,
          type: 'sustained_loud_activity',
          confidence: 0.5,
          peakDbfs: peak,
          description: 'Extended high-energy audio. Could be combat, speech or music.',
        });
      start = -1;
      peak = -120;
    }
  }
  return events.sort((a, b) => a.start - b.start);
}
