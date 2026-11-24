import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { initWorkspace, loadConfig } from '../dist/core/paths.js';
import { Store } from '../dist/core/db.js';
import { ensurePrompts, promptPath } from '../dist/agents/prompts.js';
import {
  contexts,
  profileFor,
  parseDeepAction,
  parseContextualEditing,
} from '../dist/pipeline/staged-ai.js';

test('stage artifacts and editing sets retain independent cache keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-stages-'));
  try {
    await initWorkspace(root);
    const db = new Store(root);
    db.upsertClip({
      id: 'c1',
      source_path: path.join(root, 'clips', 'one.mp4'),
      duration: 30,
      width: 1,
      height: 1,
      analyzed_at: new Date().toISOString(),
      transcript: null,
    });
    const understanding = {
      clipId: 'c1',
      summary: 'quiet setup then action',
      observations: [
        {
          start: 0,
          end: 10,
          type: 'setup',
          description: 'waits',
          confidence: 0.7,
          evidence: ['visual'],
        },
      ],
      themes: [],
      tone: { intensity: 0.2, humor: null, tension: 0.4, voiceActivity: null },
    };
    db.saveStageArtifact(
      'c1',
      'base',
      'objective-key',
      'codex',
      undefined,
      'success',
      'artifact.json',
      understanding,
      null,
    );
    assert.deepEqual(
      JSON.parse(db.stageArtifact('c1', 'base', 'objective-key').payload_json),
      understanding,
    );
    const highlight = {
      id: 'h1',
      clip_id: 'c1',
      start: 0,
      end: 12,
      title: 'Complete action',
      description: 'setup through result',
      score: 90,
      status: 'pending_review',
      origin: 'codex',
      created_at: new Date().toISOString(),
    };
    db.saveHighlightSet('funny', 'funny-key', [highlight]);
    db.saveHighlightSet('cinematic', 'cinematic-key', [highlight]);
    assert.equal(db.highlightSets().length, 2);
    assert.equal(db.highlightsForSet('funny', 'funny-key')[0].id, 'h1');
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('new projects create independent context and nested stage prompts while legacy profiles still work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-contexts-'));
  try {
    await initWorkspace(root);
    await ensurePrompts(root);
    const config = await loadConfig(root);
    const value = await contexts(root, config);
    assert.equal(value.editing, config.project.focus);
    assert.match(
      await readFile(promptPath(root, 'deep-action-analysis'), 'utf8'),
      /entire timeline/i,
    );
    assert.equal(profileFor(config, 'editing').provider, config.agent.provider);
    assert.match(
      await readFile(promptPath(root, 'contextual-editing'), 'utf8'),
      /unresolved sequence/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('deep action analysis preserves complete actions and contextual editing decides each one', () => {
  const deep = parseDeepAction(
    JSON.stringify({
      summary: 'A quiet setup leads to one outcome.',
      actions: [
        {
          id: 'a1',
          start: 0,
          end: 20,
          whatHappens: 'Player waits then reacts.',
          phases: {
            beginning: { start: 0, end: 4, description: 'Quiet setup' },
            climax: { start: 12, end: 14, description: 'Key event' },
            reaction: { start: 14, end: 20, description: 'Reaction' },
          },
          evidence: [{ start: 12, end: 14, kind: 'visual', detail: 'Visible change' }],
          uncertainty: [
            {
              claim: 'The event is a kill',
              reason: 'No HUD proof',
              clarifyWith: 'Inspect 12-14',
            },
          ],
        },
      ],
      relationships: [],
    }),
    20,
    'c1',
  );
  assert.equal(deep.actions[0].phases.reaction.end, 20);
  const decisions = parseContextualEditing(
    JSON.stringify({
      candidates: [
        {
          actionId: 'a1',
          include: true,
          start: 0,
          end: 20,
          title: 'Complete action',
          description: 'Keeps the reaction',
          reason: 'Narratively complete',
          accelerate: [],
          overlaps: [],
          confidence: 0.8,
        },
      ],
    }),
    20,
    deep.actions,
  );
  assert.equal(decisions[0].start, 0);
  assert.equal(decisions[0].end, 20);
  assert.throws(
    () => parseContextualEditing(JSON.stringify({ candidates: [] }), 20, deep.actions),
    /every Deep Action/,
  );
});
test('contextual editing expands a selected action to its observed setup and reaction', () => {
  const action = {
    id: 'a1',
    start: 5,
    end: 18,
    whatHappens: 'A setup ends in a reaction.',
    phases: {
      beginning: { start: 5, end: 7, description: 'Setup' },
      climax: { start: 11, end: 12, description: 'Payoff' },
      reaction: { start: 12, end: 18, description: 'Reaction' },
    },
    evidence: [],
    uncertainty: [],
  };
  const decisions = parseContextualEditing(
    JSON.stringify({
      candidates: [
        {
          actionId: 'a1',
          include: true,
          start: 10,
          end: 13,
          title: 'Too short',
          description: '',
          reason: '',
          accelerate: [],
          overlaps: [],
          confidence: 0.8,
        },
      ],
    }),
    20,
    [action],
  );
  assert.deepEqual([decisions[0].start, decisions[0].end], [5, 18]);
});
test('forced re-analysis removes saved derived-set references before pending highlights', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-force-'));
  try {
    await initWorkspace(root);
    const db = new Store(root);
    db.upsertClip({
      id: 'c1',
      source_path: 'one.mp4',
      duration: 30,
      width: 1,
      height: 1,
      analyzed_at: new Date().toISOString(),
      transcript: null,
    });
    const highlight = {
      id: 'h1',
      clip_id: 'c1',
      start: 0,
      end: 10,
      title: 'Pending',
      description: '',
      score: 50,
      status: 'pending_review',
      origin: 'heuristic',
      created_at: new Date().toISOString(),
    };
    db.saveHighlightSet('context', 'key', [highlight]);
    db.clearPendingHighlights('c1');
    assert.equal(db.highlight('h1'), undefined);
    assert.equal(db.highlightSets().length, 0);
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
