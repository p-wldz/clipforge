import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Highlight } from '../core/db.js';
import { workspaceDir } from '../core/paths.js';

export type ExpectedMoment = {
  id: string;
  clipId: string;
  start: number;
  end: number;
  label?: string;
};
export type EvaluationFixture = { version: 1; moments: ExpectedMoment[] };
export const evaluationFixturePath = (root: string) =>
  path.join(workspaceDir(root), 'evaluation.json');
export const evaluationTemplate: EvaluationFixture = {
  version: 1,
  moments: [
    {
      id: 'example-moment',
      clipId: 'replace-with-a-clip-id',
      start: 12.5,
      end: 18,
      label: 'Describe the complete moment to find',
    },
  ],
};

function validInterval(value: unknown): value is { start: number; end: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isFinite((value as { start?: unknown }).start) &&
    Number.isFinite((value as { end?: unknown }).end) &&
    (value as { start: number; end: number }).start >= 0 &&
    (value as { start: number; end: number }).end > (value as { start: number; end: number }).start
  );
}

export function parseEvaluationFixture(value: unknown): EvaluationFixture {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Evaluation fixture must be an object');
  const fixture = value as { version?: unknown; moments?: unknown };
  if (fixture.version !== 1 || !Array.isArray(fixture.moments))
    throw new Error('Evaluation fixture requires version=1 and moments[]');
  const moments = fixture.moments.map((moment, index) => {
    if (
      !validInterval(moment) ||
      typeof (moment as { id?: unknown }).id !== 'string' ||
      typeof (moment as { clipId?: unknown }).clipId !== 'string'
    )
      throw new Error(`Invalid evaluation moment at index ${index}`);
    const value = moment as ExpectedMoment;
    if (
      !value.id.trim() ||
      !value.clipId.trim() ||
      (value.label !== undefined && typeof value.label !== 'string')
    )
      throw new Error(`Invalid evaluation moment at index ${index}`);
    return { ...value };
  });
  if (new Set(moments.map((moment) => moment.id)).size !== moments.length)
    throw new Error('Evaluation moment IDs must be unique');
  return { version: 1, moments };
}

export async function loadEvaluationFixture(root: string) {
  let raw: string;
  try {
    raw = await readFile(evaluationFixturePath(root), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('No evaluation fixture. Run: clipforge evaluate --init');
    throw error;
  }
  return parseEvaluationFixture(JSON.parse(raw));
}

const overlap = (left: { start: number; end: number }, right: { start: number; end: number }) =>
  Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
const iou = (left: { start: number; end: number }, right: { start: number; end: number }) => {
  const shared = overlap(left, right);
  return shared / (left.end - left.start + (right.end - right.start) - shared);
};

export function evaluateHighlights(
  fixture: EvaluationFixture,
  highlights: Highlight[],
  minIou = 0.2,
) {
  if (!Number.isFinite(minIou) || minIou <= 0 || minIou > 1)
    throw new Error('Invalid evaluation IoU threshold');
  const remaining = new Set(highlights.map((highlight) => highlight.id));
  const matches: Array<{
    expectedId: string;
    highlightId: string;
    iou: number;
    startError: number;
    endError: number;
  }> = [];
  let duplicates = 0;
  for (const expected of fixture.moments) {
    const candidates = highlights
      .filter((highlight) => remaining.has(highlight.id) && highlight.clip_id === expected.clipId)
      .map((highlight) => ({ highlight, score: iou(expected, highlight) }))
      .filter((candidate) => candidate.score >= minIou)
      .sort((left, right) => right.score - left.score);
    const best = candidates.shift();
    if (!best) continue;
    remaining.delete(best.highlight.id);
    matches.push({
      expectedId: expected.id,
      highlightId: best.highlight.id,
      iou: Number(best.score.toFixed(4)),
      startError: Number(Math.abs(best.highlight.start - expected.start).toFixed(3)),
      endError: Number(Math.abs(best.highlight.end - expected.end).toFixed(3)),
    });
    duplicates += candidates.length;
  }
  const matched = matches.length;
  const predictions = highlights.length;
  return {
    version: 1,
    minIou,
    expectedMoments: fixture.moments.length,
    proposedHighlights: predictions,
    matched,
    precision: predictions ? Number((matched / predictions).toFixed(4)) : null,
    recall: fixture.moments.length ? Number((matched / fixture.moments.length).toFixed(4)) : null,
    meanBoundaryErrorSeconds: matched
      ? Number(
          (
            matches.reduce((sum, match) => sum + (match.startError + match.endError) / 2, 0) /
            matched
          ).toFixed(3),
        )
      : null,
    duplicateProposals: duplicates,
    unmatchedExpectedIds: fixture.moments
      .filter((moment) => !matches.some((match) => match.expectedId === moment.id))
      .map((moment) => moment.id),
    unmatchedHighlightIds: [...remaining],
    matches,
  };
}
