/** Stage boundaries for reusable AI work.  This module deliberately contains no
 * media extraction: understanding can be reused when an editor changes taste. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  artifactDir,
  workspaceDir,
  type AgentProvider,
  type AiProfile,
  type Config,
} from '../core/paths.js';
import { Store, type Highlight } from '../core/db.js';
import { getPrompt } from '../agents/prompts.js';
import { runAgentText } from '../agents/agent.js';

export type ActionPhase = { start: number; end: number; description: string };
export type ConversationPhase = {
  type: 'setup' | 'development' | 'payoff' | 'reaction' | 'resolution';
  start: number;
  end: number;
};
export type ConversationRelationship = {
  sourceId: string;
  targetId: string;
  type:
    | 'responds_to'
    | 'refers_to'
    | 'anticipates'
    | 'explains'
    | 'contradicts'
    | 'reacts_to'
    | 'follows_up'
    | 'resolves'
    | 'possibly_related';
  evidenceIds: string[];
  confidence: number;
  reason: string;
};
export type Conversation = {
  id: string;
  start: number;
  end: number;
  summary: string;
  topic: string;
  type: string;
  narrativePhases: ConversationPhase[];
  dominantModality: 'dialogue' | 'mixed';
  visualActivity: 'low' | 'medium' | 'high' | 'unknown';
  keyUtteranceIds: string[];
  relatedEventIds: string[];
  relationships: ConversationRelationship[];
  interpretation: {
    humor: 'low' | 'medium' | 'high' | 'uncertain';
    narrativeValue: 'low' | 'medium' | 'high' | 'uncertain';
    actionRelevance: 'low' | 'medium' | 'high' | 'uncertain';
  };
  confidence: number;
  uncertainties: string[];
};
export type ConversationArtifact = { clipId: string; conversations: Conversation[] };
export type DeepAction = {
  id: string;
  start: number;
  end: number;
  whatHappens: string;
  phases: {
    beginning?: ActionPhase;
    buildUp?: ActionPhase;
    change?: ActionPhase;
    climax?: ActionPhase;
    resolution?: ActionPhase;
    reaction?: ActionPhase;
  };
  evidence: Array<{ start: number; end: number; kind: string; detail: string }>;
  uncertainty: Array<{ claim: string; reason: string; clarifyWith: string }>;
};
export type Understanding = {
  clipId: string;
  summary: string;
  actions: DeepAction[];
  relationships: string[];
  conversation?: ConversationArtifact;
};
export type EditingDecision = {
  actionId: string;
  include: boolean;
  start: number;
  end: number;
  title: string;
  description: string;
  reason: string;
  accelerate: Array<{ start: number; end: number; speed: number }>;
  overlaps: string[];
  confidence: number;
  conversationId?: string;
  narrativePhaseCoverage: string[];
  missingContextRisks: string[];
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const profileFor = (
  config: Config,
  stage:
    | 'understanding'
    | 'contextualUnderstanding'
    | 'editing'
    | 'criticalReview'
    | 'filmDirection',
): AiProfile =>
  config.aiStages?.[stage] ??
  (stage === 'understanding'
    ? config.aiStages?.clipAnalysis
    : stage === 'filmDirection'
      ? config.aiStages?.montage
      : undefined) ??
  config.agent;
export async function contexts(root: string, config: Config) {
  const fallback = {
    domain: '',
    editing: config.project.focus,
    filmDirection: config.project.focus,
  };
  const fromFile = await readFile(path.join(workspaceDir(root), 'contexts.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  return {
    ...fallback,
    ...config.contexts,
    ...(fromFile && typeof fromFile === 'object' ? fromFile : {}),
  } as typeof fallback;
}
function json(text: string) {
  const first = text.indexOf('{'),
    last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Response contains no JSON object');
  return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
}
const bounded = (value: unknown, duration: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= duration + 0.1;
const id = (value: unknown) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : undefined;
const level = (value: unknown): 'low' | 'medium' | 'high' | 'uncertain' =>
  value === 'low' || value === 'medium' || value === 'high' ? value : 'uncertain';
export function parseConversationUnderstanding(
  text: string,
  duration: number,
  clipId: string,
  utteranceIds: string[],
  eventIds: string[],
): ConversationArtifact {
  const raw = json(text);
  if (!Array.isArray(raw.conversations))
    throw new Error('Conversation Understanding requires conversations');
  const sources = new Set([...utteranceIds, ...eventIds]);
  const conversations = raw.conversations.flatMap((value, index): Conversation[] => {
    if (!value || typeof value !== 'object') return [];
    const v = value as Record<string, unknown>;
    const start = v.start,
      end = v.end,
      conversationId = id(v.conversationId) ?? `conversation-${index + 1}`;
    if (
      !bounded(start, duration) ||
      !bounded(end, duration) ||
      (end as number) <= (start as number) ||
      typeof v.summary !== 'string'
    )
      return [];
    const utterances = Array.isArray(v.keyUtteranceIds)
      ? v.keyUtteranceIds
          .filter((x): x is string => typeof x === 'string' && utteranceIds.includes(x))
          .slice(0, 100)
      : [];
    if (!utterances.length) return [];
    const relationships = Array.isArray(v.relationships)
      ? v.relationships.flatMap((item): ConversationRelationship[] => {
          if (!item || typeof item !== 'object') return [];
          const r = item as Record<string, unknown>,
            sourceId = id(r.sourceId),
            targetId = id(r.targetId);
          const types = [
            'responds_to',
            'refers_to',
            'anticipates',
            'explains',
            'contradicts',
            'reacts_to',
            'follows_up',
            'resolves',
            'possibly_related',
          ];
          if (
            !sourceId ||
            !targetId ||
            sourceId === targetId ||
            !sources.has(sourceId) ||
            !sources.has(targetId) ||
            !types.includes(r.type as string) ||
            typeof r.reason !== 'string'
          )
            return [];
          return [
            {
              sourceId,
              targetId,
              type: r.type as ConversationRelationship['type'],
              evidenceIds: Array.isArray(r.evidenceIds)
                ? r.evidenceIds
                    .filter((x): x is string => typeof x === 'string' && sources.has(x))
                    .slice(0, 20)
                : [],
              confidence:
                typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0,
              reason: r.reason.slice(0, 800),
            },
          ];
        })
      : [];
    const phases = Array.isArray(v.narrativePhases)
      ? v.narrativePhases.flatMap((item): ConversationPhase[] => {
          if (!item || typeof item !== 'object') return [];
          const p = item as Record<string, unknown>;
          return ['setup', 'development', 'payoff', 'reaction', 'resolution'].includes(
            p.type as string,
          ) &&
            bounded(p.start, duration) &&
            bounded(p.end, duration) &&
            (p.end as number) > (p.start as number)
            ? [
                {
                  type: p.type as ConversationPhase['type'],
                  start: p.start as number,
                  end: Math.min(p.end as number, duration),
                },
              ]
            : [];
        })
      : [];
    const interpretation =
      v.interpretation && typeof v.interpretation === 'object'
        ? (v.interpretation as Record<string, unknown>)
        : {};
    return [
      {
        id: conversationId,
        start: start as number,
        end: Math.min(end as number, duration),
        summary: v.summary.slice(0, 2000),
        topic: typeof v.topic === 'string' ? v.topic.slice(0, 300) : '',
        type: typeof v.type === 'string' ? v.type.slice(0, 80) : 'interaction',
        narrativePhases: phases,
        dominantModality: v.dominantModality === 'mixed' ? 'mixed' : 'dialogue',
        visualActivity: ['low', 'medium', 'high'].includes(v.visualActivity as string)
          ? (v.visualActivity as Conversation['visualActivity'])
          : 'unknown',
        keyUtteranceIds: utterances,
        relatedEventIds: Array.isArray(v.relatedEventIds)
          ? v.relatedEventIds
              .filter((x): x is string => typeof x === 'string' && eventIds.includes(x))
              .slice(0, 100)
          : [],
        relationships,
        interpretation: {
          humor: level(interpretation.humor),
          narrativeValue: level(interpretation.narrativeValue),
          actionRelevance: level(interpretation.actionRelevance),
        },
        confidence: typeof v.confidence === 'number' ? Math.max(0, Math.min(1, v.confidence)) : 0,
        uncertainties: Array.isArray(v.uncertainties)
          ? v.uncertainties
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.slice(0, 800))
              .slice(0, 30)
          : [],
      },
    ];
  });
  if (new Set(conversations.map((c) => c.id)).size !== conversations.length)
    throw new Error('Conversation Understanding has duplicate conversation IDs');
  return { clipId, conversations };
}
export async function conversationUnderstanding(
  root: string,
  db: Store,
  input: {
    clipId: string;
    duration: number;
    transcript: Array<{ id: string; start: number; end: number; text: string }>;
    events: Array<{ id: string; start: number; end: number; kind: string; detail: string }>;
    config: Config;
  },
  onEvent?: (message: string) => void,
) {
  const profile = profileFor(input.config, 'understanding');
  if (!['codex', 'claude', 'deepseek'].includes(profile.provider))
    throw new Error('Conversation Understanding requires a configured AI provider');
  const prompt = await getPrompt(root, 'conversation-understanding');
  const key = hash({
    stage: 'conversation-v1',
    prompt,
    profile,
    transcript: input.transcript,
    events: input.events,
  });
  const cached = db.stageArtifact(input.clipId, 'conversation-understanding', key);
  if (cached?.status === 'success')
    return { conversation: JSON.parse(cached.payload_json) as ConversationArtifact, cached: true };
  const folder = path.join(artifactDir(root, input.clipId), 'understanding');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'conversations.json'),
    output = path.join(folder, 'conversations-response.txt');
  const request = `${prompt}\n\nReturn ONLY JSON: {conversations:[{conversationId,start,end,summary,topic,type,narrativePhases:[{type,start,end}],dominantModality,visualActivity,keyUtteranceIds,relatedEventIds,relationships:[{sourceId,targetId,type,evidenceIds,confidence,reason}],interpretation:{humor,narrativeValue,actionRelevance},confidence,uncertainties}]}. Only use supplied IDs.\n\nTRANSCRIPT:\n${JSON.stringify(input.transcript)}\n\nMEDIA EVENTS:\n${JSON.stringify(input.events)}`;
  await writeFile(path.join(folder, 'conversations-prompt.txt'), request);
  onEvent?.(`Conversation Understanding: invoking ${profile.provider}`);
  try {
    const response = await runAgentText(
      profile.provider as Exclude<AgentProvider, 'none' | 'cursor'>,
      profile.model,
      root,
      request,
      output,
      10 * 60 * 1000,
    );
    const conversation = parseConversationUnderstanding(
      response,
      input.duration,
      input.clipId,
      input.transcript.map((x) => x.id),
      input.events.map((x) => x.id),
    );
    await writeFile(file, JSON.stringify(conversation, null, 2));
    db.saveStageArtifact(
      input.clipId,
      'conversation-understanding',
      key,
      profile.provider,
      profile.model,
      'success',
      file,
      conversation,
      null,
    );
    return { conversation, cached: false };
  } catch (error) {
    db.saveStageArtifact(
      input.clipId,
      'conversation-understanding',
      key,
      profile.provider,
      profile.model,
      'failed',
      file,
      null,
      (error as Error).message,
    );
    throw error;
  }
}
export function parseDeepAction(text: string, duration: number, clipId: string): Understanding {
  const raw = json(text);
  if (typeof raw.summary !== 'string' || !Array.isArray(raw.actions))
    throw new Error('Deep Action Analysis requires summary and actions');
  const phase = (value: unknown): ActionPhase | undefined => {
    if (!value || typeof value !== 'object') return;
    const v = value as Record<string, unknown>;
    return typeof v.start === 'number' &&
      typeof v.end === 'number' &&
      typeof v.description === 'string' &&
      v.start >= 0 &&
      v.end > v.start &&
      v.end <= duration + 0.1
      ? {
          start: v.start,
          end: Math.min(v.end, duration),
          description: v.description.slice(0, 1200),
        }
      : undefined;
  };
  const actions = raw.actions.flatMap((value, index): DeepAction[] => {
    if (!value || typeof value !== 'object') return [];
    const v = value as Record<string, unknown>;
    if (
      typeof v.start !== 'number' ||
      typeof v.end !== 'number' ||
      typeof v.whatHappens !== 'string' ||
      v.start < 0 ||
      v.end <= v.start ||
      v.end > duration + 0.1
    )
      return [];
    const phases =
      v.phases && typeof v.phases === 'object' ? (v.phases as Record<string, unknown>) : {};
    const evidence = Array.isArray(v.evidence)
      ? v.evidence.flatMap((e) => {
          if (!e || typeof e !== 'object') return [];
          const x = e as Record<string, unknown>;
          return typeof x.start === 'number' &&
            typeof x.end === 'number' &&
            typeof x.kind === 'string' &&
            typeof x.detail === 'string' &&
            x.start >= 0 &&
            x.end >= x.start &&
            x.end <= duration + 0.1
            ? [
                {
                  start: x.start,
                  end: x.end,
                  kind: x.kind.slice(0, 50),
                  detail: x.detail.slice(0, 800),
                },
              ]
            : [];
        })
      : [];
    return [
      {
        id:
          typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v.id)
            ? v.id
            : `action-${index + 1}`,
        start: v.start,
        end: Math.min(v.end, duration),
        whatHappens: v.whatHappens.slice(0, 2000),
        phases: {
          beginning: phase(phases.beginning),
          buildUp: phase(phases.buildUp),
          change: phase(phases.change),
          climax: phase(phases.climax),
          resolution: phase(phases.resolution),
          reaction: phase(phases.reaction),
        },
        evidence,
        uncertainty: Array.isArray(v.uncertainty)
          ? v.uncertainty.flatMap((u) => {
              if (!u || typeof u !== 'object') return [];
              const x = u as Record<string, unknown>;
              return typeof x.claim === 'string' &&
                typeof x.reason === 'string' &&
                typeof x.clarifyWith === 'string'
                ? [
                    {
                      claim: x.claim.slice(0, 600),
                      reason: x.reason.slice(0, 600),
                      clarifyWith: x.clarifyWith.slice(0, 600),
                    },
                  ]
                : [];
            })
          : [],
      },
    ];
  });
  if (!actions.length || new Set(actions.map((a) => a.id)).size !== actions.length)
    throw new Error('Deep Action Analysis contains no valid uniquely identified actions');
  return {
    clipId,
    summary: raw.summary.slice(0, 5000),
    actions,
    relationships: Array.isArray(raw.relationships)
      ? raw.relationships.filter((r): r is string => typeof r === 'string').slice(0, 100)
      : [],
  };
}
export async function baseUnderstanding(
  root: string,
  db: Store,
  input: {
    clipId: string;
    duration: number;
    media: unknown;
    images: string[];
    conversation?: ConversationArtifact;
    config: Config;
    runId?: string;
  },
  onEvent?: (message: string) => void,
) {
  const profile = profileFor(input.config, 'understanding');
  if (!['codex', 'claude', 'deepseek'].includes(profile.provider))
    throw new Error('Base understanding requires a configured AI provider');
  const prompt = await getPrompt(root, 'deep-action-analysis');
  const key = hash({
    stage: 'deep-action-v1',
    prompt,
    provider: profile,
    media: input.media,
  });
  const cached = db.stageArtifact(input.clipId, 'deep-action', key);
  if (cached?.status === 'success')
    return {
      understanding: {
        ...(JSON.parse(cached.payload_json) as Understanding),
        conversation: input.conversation,
      },
      cached: true,
    };
  const folder = path.join(artifactDir(root, input.clipId), 'understanding');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'deep-action.json'),
    output = path.join(folder, 'deep-action-response.txt');
  const request = `${prompt}\n\nReturn ONLY JSON: {summary,actions:[{id,start,end,whatHappens,phases:{beginning?,buildUp?,change?,climax?,resolution?,reaction?},evidence:[{start,end,kind,detail}],uncertainty:[{claim,reason,clarifyWith}]}],relationships:string[]}. A phase is {start,end,description}.\n\nINPUT:\n${JSON.stringify(input.media).slice(0, 100000)}\n\nFRAME PATHS:\n${input.images.join('\n')}`;
  await writeFile(path.join(folder, 'deep-action-prompt.txt'), request);
  onEvent?.(`Deep Action Analysis: invoking ${profile.provider}`);
  try {
    const response = await runAgentText(
      profile.provider as Exclude<AgentProvider, 'none' | 'cursor'>,
      profile.model,
      root,
      request,
      output,
      10 * 60 * 1000,
    );
    const understanding = {
      ...parseDeepAction(response, input.duration, input.clipId),
      conversation: input.conversation,
    };
    await writeFile(file, JSON.stringify(understanding, null, 2));
    db.saveStageArtifact(
      input.clipId,
      'deep-action',
      key,
      profile.provider,
      profile.model,
      'success',
      file,
      understanding,
      null,
    );
    return { understanding, cached: false };
  } catch (error) {
    db.saveStageArtifact(
      input.clipId,
      'deep-action',
      key,
      profile.provider,
      profile.model,
      'failed',
      file,
      null,
      (error as Error).message,
    );
    throw error;
  }
}

export function parseContextualEditing(
  text: string,
  duration: number,
  actions: DeepAction[],
  conversationIds: string[] = [],
): EditingDecision[] {
  const raw = json(text);
  if (!Array.isArray(raw.candidates)) throw new Error('Contextual Editing requires candidates');
  const ids = new Set(actions.map((a) => a.id));
  const decisions = raw.candidates.flatMap((value): EditingDecision[] => {
    if (!value || typeof value !== 'object') return [];
    const v = value as Record<string, unknown>;
    if (typeof v.actionId !== 'string' || !ids.has(v.actionId) || typeof v.include !== 'boolean')
      return [];
    const start = typeof v.start === 'number' ? v.start : 0,
      end = typeof v.end === 'number' ? v.end : 0;
    if (v.include && (start < 0 || end <= start || end > duration + 0.1)) return [];
    const intervals = Array.isArray(v.accelerate)
      ? v.accelerate.flatMap((a) => {
          if (!a || typeof a !== 'object') return [];
          const x = a as Record<string, unknown>;
          return typeof x.start === 'number' &&
            typeof x.end === 'number' &&
            typeof x.speed === 'number' &&
            x.start >= start &&
            x.end > x.start &&
            x.end <= end &&
            x.speed > 1 &&
            x.speed <= 4
            ? [{ start: x.start, end: x.end, speed: x.speed }]
            : [];
        })
      : [];
    return [
      {
        actionId: v.actionId,
        include: v.include,
        start,
        end: Math.min(end, duration),
        title: typeof v.title === 'string' ? v.title.slice(0, 120) : 'Untitled action',
        description: typeof v.description === 'string' ? v.description.slice(0, 1200) : '',
        reason: typeof v.reason === 'string' ? v.reason.slice(0, 1600) : '',
        accelerate: intervals,
        overlaps: Array.isArray(v.overlaps)
          ? v.overlaps.filter((x): x is string => typeof x === 'string' && ids.has(x)).slice(0, 20)
          : [],
        confidence:
          typeof v.confidence === 'number' && Number.isFinite(v.confidence)
            ? Math.max(0, Math.min(1, v.confidence))
            : 0,
        conversationId:
          typeof v.conversationId === 'string' && conversationIds.includes(v.conversationId)
            ? v.conversationId
            : undefined,
        narrativePhaseCoverage: Array.isArray(v.narrativePhaseCoverage)
          ? v.narrativePhaseCoverage
              .filter((x): x is string =>
                ['setup', 'development', 'payoff', 'reaction', 'resolution'].includes(x),
              )
              .slice(0, 5)
          : [],
        missingContextRisks: Array.isArray(v.missingContextRisks)
          ? v.missingContextRisks
              .filter((x): x is string => typeof x === 'string')
              .map((x) => x.slice(0, 400))
              .slice(0, 10)
          : [],
      },
    ];
  });
  if (
    decisions.length !== actions.length ||
    new Set(decisions.map((d) => d.actionId)).size !== actions.length
  )
    throw new Error('Contextual Editing must decide every Deep Action exactly once');
  return decisions;
}
export async function contextualEditing(
  root: string,
  db: Store,
  input: {
    clipId: string;
    duration: number;
    understanding: Understanding;
    context: string;
    config: Config;
  },
) {
  const profile = profileFor(input.config, 'editing');
  if (!['codex', 'claude', 'deepseek'].includes(profile.provider))
    throw new Error('Contextual Editing requires a configured AI provider');
  const prompt = await getPrompt(root, 'contextual-editing');
  const key = hash({
    stage: 'contextual-editing-v1',
    prompt,
    profile,
    context: input.context,
    understanding: input.understanding,
  });
  const cached = db.stageArtifact(input.clipId, 'contextual-editing', key);
  if (cached?.status === 'success')
    return {
      decisions: JSON.parse(cached.payload_json) as EditingDecision[],
      cached: true,
      key,
    };
  const folder = path.join(artifactDir(root, input.clipId), 'editing');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'contextual-editing.json'),
    output = path.join(folder, 'contextual-editing-response.txt');
  const request = `${prompt}\n\nReturn ONLY JSON: {candidates:[{actionId,include,start,end,title,description,reason,accelerate:[{start,end,speed}],overlaps:string[],confidence,conversationId?,narrativePhaseCoverage:string[],missingContextRisks:string[]}]}. Include one decision for every action; excluded actions still require actionId, include:false, reason and confidence.\n\nEDITING CONTEXT:\n${input.context}\n\nDEEP ACTION ANALYSIS:\n${JSON.stringify(input.understanding)}`;
  await writeFile(path.join(folder, 'contextual-editing-prompt.txt'), request);
  try {
    const response = await runAgentText(
      profile.provider as Exclude<AgentProvider, 'none' | 'cursor'>,
      profile.model,
      root,
      request,
      output,
      10 * 60 * 1000,
    );
    const decisions = parseContextualEditing(
      response,
      input.duration,
      input.understanding.actions,
      input.understanding.conversation?.conversations.map((c) => c.id),
    );
    await writeFile(file, JSON.stringify(decisions, null, 2));
    db.saveStageArtifact(
      input.clipId,
      'contextual-editing',
      key,
      profile.provider,
      profile.model,
      'success',
      file,
      decisions,
      null,
    );
    return { decisions, cached: false, key };
  } catch (error) {
    db.saveStageArtifact(
      input.clipId,
      'contextual-editing',
      key,
      profile.provider,
      profile.model,
      'failed',
      file,
      null,
      (error as Error).message,
    );
    throw error;
  }
}
export async function criticalReview(
  root: string,
  db: Store,
  input: {
    clipId: string;
    duration: number;
    understanding: Understanding;
    context: string;
    decisions: EditingDecision[];
    config: Config;
  },
) {
  const profile = profileFor(input.config, 'criticalReview');
  if (!['codex', 'claude', 'deepseek'].includes(profile.provider))
    throw new Error('Critical Review requires a configured AI provider');
  const prompt = await getPrompt(root, 'critical-review');
  const key = hash({
    stage: 'critical-review-v1',
    prompt,
    profile,
    context: input.context,
    understanding: input.understanding,
    decisions: input.decisions,
  });
  const cached = db.stageArtifact(input.clipId, 'critical-review', key);
  if (cached?.status === 'success')
    return JSON.parse(cached.payload_json) as {
      decisions: EditingDecision[];
      reanalysis: Array<{ start: number; end: number; reason: string }>;
    };
  const folder = path.join(artifactDir(root, input.clipId), 'editing');
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, 'critical-review.json'),
    output = path.join(folder, 'critical-review-response.txt');
  const request = `${prompt}\n\nReturn ONLY JSON: {corrections:[{actionId,start?,end?,reason,needsEvidence:boolean,reanalysisStart?,reanalysisEnd?}]}. Omit any correction that is not specific.\n\nEDITING CONTEXT:\n${input.context}\n\nDEEP ACTION ANALYSIS:\n${JSON.stringify(input.understanding)}\n\nPROPOSED CUTS:\n${JSON.stringify(input.decisions)}`;
  await writeFile(path.join(folder, 'critical-review-prompt.txt'), request);
  try {
    const response = await runAgentText(
      profile.provider as Exclude<AgentProvider, 'none' | 'cursor'>,
      profile.model,
      root,
      request,
      output,
      10 * 60 * 1000,
    );
    const raw = json(response);
    const byId = new Map(input.decisions.map((d) => [d.actionId, d]));
    const reanalysis: Array<{ start: number; end: number; reason: string }> = [];
    const corrected = input.decisions.map((d) => ({ ...d }));
    for (const value of Array.isArray(raw.corrections) ? raw.corrections : []) {
      if (!value || typeof value !== 'object') continue;
      const c = value as Record<string, unknown>;
      const original = byId.get(typeof c.actionId === 'string' ? c.actionId : '');
      if (!original) continue;
      const reason =
        typeof c.reason === 'string' ? c.reason.slice(0, 800) : 'Additional evidence required';
      if (c.needsEvidence === true) {
        if (
          typeof c.reanalysisStart === 'number' &&
          typeof c.reanalysisEnd === 'number' &&
          c.reanalysisStart >= 0 &&
          c.reanalysisEnd > c.reanalysisStart &&
          c.reanalysisEnd <= input.duration + 0.1
        )
          reanalysis.push({
            start: c.reanalysisStart,
            end: Math.min(c.reanalysisEnd, input.duration),
            reason,
          });
        continue;
      }
      const target = corrected.find((d) => d.actionId === original.actionId)!;
      const start = typeof c.start === 'number' ? c.start : target.start,
        end = typeof c.end === 'number' ? c.end : target.end;
      if (target.include && start >= 0 && end > start && end <= input.duration + 0.1) {
        target.start = start;
        target.end = end;
        target.reason = `${target.reason}\nCritic correction: ${reason}`.slice(0, 1600);
      }
    }
    const result = { decisions: corrected, reanalysis };
    await writeFile(file, JSON.stringify(result, null, 2));
    await writeFile(
      path.join(folder, 'contextual-editing-corrected.json'),
      JSON.stringify(corrected, null, 2),
    );
    db.saveStageArtifact(
      input.clipId,
      'critical-review',
      key,
      profile.provider,
      profile.model,
      'success',
      file,
      result,
      null,
    );
    return result;
  } catch (error) {
    db.saveStageArtifact(
      input.clipId,
      'critical-review',
      key,
      profile.provider,
      profile.model,
      'failed',
      file,
      null,
      (error as Error).message,
    );
    throw error;
  }
}
export async function contextualUnderstanding(
  root: string,
  db: Store,
  input: {
    clipId: string;
    base: Understanding;
    domain: string;
    config: Config;
  },
) {
  const profile = profileFor(input.config, 'contextualUnderstanding');
  if (!['codex', 'claude', 'deepseek'].includes(profile.provider))
    throw new Error('Contextual understanding requires a configured AI provider');
  const prompt = await getPrompt(root, 'understanding-contextual');
  const key = hash({
    stage: 'contextual-understanding',
    prompt,
    domain: input.domain,
    base: input.base,
    profile,
  });
  const cached = db.stageArtifact(input.clipId, 'contextual', key);
  if (cached?.status === 'success') return JSON.parse(cached.payload_json);
  const folder = path.join(artifactDir(root, input.clipId), 'understanding', 'contexts');
  await mkdir(folder, { recursive: true });
  const output = path.join(folder, `${key}.response.txt`),
    file = path.join(folder, `${key}.json`);
  const request = `${prompt}\n\nDOMAIN CONTEXT:\n${input.domain}\n\nBASE UNDERSTANDING (do not overwrite it):\n${JSON.stringify(input.base)}\n\nReturn only JSON with {summary,interpretations:[{observationIndex,meaning,confidence}]}.`;
  try {
    const response = await runAgentText(
      profile.provider as Exclude<AgentProvider, 'none' | 'cursor'>,
      profile.model,
      root,
      request,
      output,
      10 * 60 * 1000,
    );
    const value = JSON.parse(response.slice(response.indexOf('{'), response.lastIndexOf('}') + 1));
    await writeFile(file, JSON.stringify(value, null, 2));
    db.saveStageArtifact(
      input.clipId,
      'contextual',
      key,
      profile.provider,
      profile.model,
      'success',
      file,
      value,
      null,
    );
    return value;
  } catch (error) {
    db.saveStageArtifact(
      input.clipId,
      'contextual',
      key,
      profile.provider,
      profile.model,
      'failed',
      file,
      null,
      (error as Error).message,
    );
    throw error;
  }
}
export function persistEditingSet(
  db: Store,
  context: string,
  highlights: Highlight[],
  key: string,
) {
  db.saveHighlightSet(context, key, highlights);
}
