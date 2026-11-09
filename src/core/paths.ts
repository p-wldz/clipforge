import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrompts } from '../agents/prompts.js';
import { defaultPrices, validateCatalog, type PriceCatalog } from './usage.js';
import { randomUUID, createHash } from 'node:crypto';

export type AgentProvider = 'none' | 'codex' | 'claude' | 'cursor' | 'deepseek' | 'openai';
export type AiStage =
  | 'understanding'
  | 'contextualUnderstanding'
  | 'editing'
  | 'criticalReview'
  | 'filmDirection';
export type AiProfile = { provider: AgentProvider; model?: string };
export interface Config {
  version: 1;
  toolsScope?: 'project' | 'user';
  mediaDir: string;
  pricing?: PriceCatalog;
  project: {
    name: string;
    description: string;
    focus: string;
    hasAudio: boolean;
  };
  agent: { provider: AgentProvider; model?: string };
  /** Optional so v1 workspaces keep inheriting the legacy agent profile. */
  aiStages?: Partial<Record<AiStage, AiProfile>> & {
    clipAnalysis?: AiProfile;
    montage?: AiProfile;
  };
  contexts?: { domain: string; editing: string; filmDirection: string };
  analysis: {
    frameIntervalSeconds: number;
    maxImagesPerClip?: number;
    imageMaxWidth?: number;
    maxFramesPerHighlight: number;
    maxHighlightsPerClip: number;
    highlightDurationSeconds: number;
    minAudioSilenceSeconds: number;
    minDurationSeconds: number;
    maxDurationSeconds: number | null;
    requireAudio: boolean;
    criticalReviewPasses?: number;
  };
  soundClassifier: {
    enabled: boolean;
    provider: 'ast';
    model: string;
    command: string;
    windowSeconds: number;
    hopSeconds: number;
    minConfidence: number;
    maxEvents: number;
  };
  transcription: {
    enabled: boolean;
    provider?: 'whisper-cli' | 'faster-whisper';
    model?: string;
    device?: 'cpu' | 'cuda' | 'auto';
    command: string;
    args: string[];
  };
}
export const defaultConfig: Config = {
  version: 1,
  toolsScope: 'project',
  mediaDir: 'clips',
  pricing: structuredClone(defaultPrices),
  project: {
    name: 'My highlights',
    description: 'Gameplay highlights',
    focus: 'Exciting gameplay moments',
    hasAudio: true,
  },
  agent: { provider: 'none' },
  analysis: {
    frameIntervalSeconds: 3,
    maxImagesPerClip: 12,
    imageMaxWidth: 640,
    maxFramesPerHighlight: 4,
    maxHighlightsPerClip: 6,
    highlightDurationSeconds: 12,
    minAudioSilenceSeconds: 1.3,
    minDurationSeconds: 0,
    maxDurationSeconds: null,
    requireAudio: false,
    criticalReviewPasses: 0,
  },
  soundClassifier: {
    enabled: false,
    provider: 'ast',
    model: 'MIT/ast-finetuned-audioset-10-10-0.4593',
    command: '',
    windowSeconds: 5,
    hopSeconds: 2.5,
    minConfidence: 0.12,
    maxEvents: 60,
  },
  transcription: {
    enabled: false,
    provider: 'faster-whisper',
    model: 'small',
    device: 'cpu',
    command: 'python',
    args: ['{input}', '--model', 'base', '--output_format', 'json', '--output_dir', '{outputDir}'],
  },
};
export const workspaceDir = (root: string) => path.join(root, '.clipforge');
export const dbPath = (root: string) => path.join(workspaceDir(root), 'state.sqlite');
export const artifactDir = (root: string, id: string) =>
  path.join(workspaceDir(root), 'artifacts', id);
export const projectDir = (root: string) => path.join(workspaceDir(root), 'projects');
export const rendersDir = (root: string) => path.join(workspaceDir(root), 'renders');
export const stableId = (file: string) =>
  createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 16);
export const newId = () => randomUUID();
export async function initWorkspace(
  root: string,
  options: {
    name?: string;
    description?: string;
    focus?: string;
    hasAudio?: boolean;
    mediaDir?: string;
    frameIntervalSeconds?: number;
    transcriptionEnabled?: boolean;
    maxDurationSeconds?: number | null;
    minDurationSeconds?: number;
    requireAudio?: boolean;
  } = {},
) {
  await mkdir(workspaceDir(root), { recursive: true });
  const clipsDir = options.mediaDir ?? 'clips';
  if (
    path.isAbsolute(clipsDir) ||
    !inside(root, path.resolve(root, clipsDir)) ||
    clipsDir.startsWith('.clipforge')
  )
    throw new Error('Clips folder must be inside the project and outside .clipforge');
  await mkdir(path.join(root, clipsDir), { recursive: true });
  await mkdir(path.join(workspaceDir(root), 'artifacts'), { recursive: true });
  await mkdir(projectDir(root), { recursive: true });
  await mkdir(rendersDir(root), { recursive: true });
  const configPath = path.join(workspaceDir(root), 'config.json');
  try {
    await readFile(configPath);
  } catch {
    const config: Config = {
      ...defaultConfig,
      mediaDir: clipsDir,
      project: {
        ...defaultConfig.project,
        name: options.name ?? path.basename(root),
        description: options.description ?? defaultConfig.project.description,
        focus: options.focus ?? defaultConfig.project.focus,
        hasAudio: options.hasAudio ?? true,
      },
      analysis: {
        ...defaultConfig.analysis,
        frameIntervalSeconds:
          options.frameIntervalSeconds ?? defaultConfig.analysis.frameIntervalSeconds,
        maxDurationSeconds:
          options.maxDurationSeconds === undefined
            ? defaultConfig.analysis.maxDurationSeconds
            : options.maxDurationSeconds,
        minDurationSeconds: options.minDurationSeconds ?? defaultConfig.analysis.minDurationSeconds,
        requireAudio: options.requireAudio ?? defaultConfig.analysis.requireAudio,
      },
      transcription: {
        ...defaultConfig.transcription,
        enabled: options.transcriptionEnabled ?? false,
      },
    };
    validateAnalysis(config.analysis);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    await writeFile(
      path.join(workspaceDir(root), 'context.md'),
      `# ${config.project.name}\n\n## Description\n${config.project.description}\n\n## Highlight priorities\n${config.project.focus}\n\n## Instructions for agents\n- Base descriptions on evidence in screenshots and transcripts.\n- Never invent kills, speech or events.\n- Propose start/end timestamps, preserving important lead-in and reactions.\n- Human approval is required before rendering.\n`,
    );
    await writeFile(
      path.join(workspaceDir(root), 'contexts.json'),
      JSON.stringify(
        {
          domain: '',
          editing: config.project.focus,
          filmDirection: config.project.focus,
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      path.join(workspaceDir(root), 'workflow.json'),
      JSON.stringify(
        {
          version: 1,
          steps: [
            'probe',
            'frames',
            'audio-activity',
            'transcribe',
            'classify-sounds',
            'detect-candidates',
            'agent-review',
            'human-review',
            'render',
          ],
          reviewRequired: true,
        },
        null,
        2,
      ) + '\n',
    );
  }
  await ensurePrompts(root);
  return configPath;
}
export async function loadConfig(root: string): Promise<Config> {
  const file = await readFile(path.join(workspaceDir(root), 'config.json'), 'utf8');
  const input = JSON.parse(file) as Partial<Config>;
  if (
    input.version !== 1 ||
    !['none', 'codex', 'claude', 'cursor', 'deepseek', 'openai'].includes(input.agent?.provider ?? '')
  )
    throw new Error(
      'Invalid config: expected version=1 and agent.provider=none|codex|claude|cursor|deepseek|openai',
    );
  const config = {
    ...defaultConfig,
    ...input,
    pricing: input.pricing ? validateCatalog(input.pricing) : structuredClone(defaultPrices),
    project: { ...defaultConfig.project, ...input.project },
    analysis: { ...defaultConfig.analysis, ...input.analysis },
    soundClassifier: {
      ...defaultConfig.soundClassifier,
      ...input.soundClassifier,
    },
    transcription: {
      ...defaultConfig.transcription,
      ...input.transcription,
      provider:
        input.transcription?.provider ??
        (input.transcription?.command === 'whisper' ? 'whisper-cli' : 'faster-whisper'),
    },
    agent: { ...defaultConfig.agent, ...input.agent },
    contexts: input.contexts
      ? {
          domain: input.contexts.domain ?? '',
          editing: input.contexts.editing ?? input.project?.focus ?? '',
          filmDirection: input.contexts.filmDirection ?? input.project?.focus ?? '',
        }
      : undefined,
    aiStages: input.aiStages ? { ...input.aiStages } : undefined,
  };
  if (!['project', 'user'].includes(config.toolsScope ?? 'project'))
    throw new Error('Invalid tools scope');
  validateAnalysis(config.analysis);
  return config;
}
export const inside = (base: string, child: string) => {
  const rel = path.relative(path.resolve(base), path.resolve(child));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};

export function validateAnalysis(a: Config['analysis']) {
  if (!Number.isFinite(a.frameIntervalSeconds) || a.frameIntervalSeconds <= 0)
    throw new Error('Frame interval must be positive');
  if (
    !Number.isInteger(a.maxImagesPerClip ?? 8) ||
    (a.maxImagesPerClip ?? 8) < 1 ||
    (a.maxImagesPerClip ?? 8) > 30
  )
    throw new Error('Image limit must be 1-30');
  if (
    !Number.isInteger(a.imageMaxWidth ?? 640) ||
    (a.imageMaxWidth ?? 640) < 256 ||
    (a.imageMaxWidth ?? 640) > 1920
  )
    throw new Error('Image width must be 256-1920');
  if (
    !Number.isInteger(a.criticalReviewPasses ?? 0) ||
    (a.criticalReviewPasses ?? 0) < 0 ||
    (a.criticalReviewPasses ?? 0) > 1
  )
    throw new Error('Critical review passes must be 0 or 1');
  if (!Number.isFinite(a.minDurationSeconds) || a.minDurationSeconds < 0)
    throw new Error('Minimum duration must be nonnegative');
  if (
    a.maxDurationSeconds !== null &&
    (!Number.isFinite(a.maxDurationSeconds) ||
      a.maxDurationSeconds <= 0 ||
      a.maxDurationSeconds < a.minDurationSeconds)
  )
    throw new Error('Invalid maximum duration');
}

export async function saveConfig(root: string, config: Config) {
  if (
    config.version !== 1 ||
    !['none', 'codex', 'claude', 'cursor', 'deepseek', 'openai'].includes(config.agent.provider)
  )
    throw new Error('Invalid provider');
  if (!['project', 'user'].includes(config.toolsScope ?? 'project'))
    throw new Error('Invalid tools scope');
  validateAnalysis(config.analysis);
  if (config.pricing) config.pricing = validateCatalog(config.pricing);
  for (const stage of Object.values(config.aiStages ?? {})) {
    if (!stage) continue;
    if (!['none', 'codex', 'claude', 'deepseek', 'openai'].includes(stage.provider))
      throw new Error('Unsupported AI stage provider');
    if (stage.model && (stage.model.length > 180 || /[\r\n]/.test(stage.model)))
      throw new Error('Invalid AI model identifier');
  }
  if (
    !config.project.name.trim() ||
    !config.mediaDir.trim() ||
    path.isAbsolute(config.mediaDir) ||
    !inside(root, path.resolve(root, config.mediaDir)) ||
    path.relative(root, path.resolve(root, config.mediaDir)).split(path.sep).includes('.clipforge')
  )
    throw new Error('Invalid project name or clips directory');
  if (
    !Number.isFinite(config.analysis.maxHighlightsPerClip) ||
    config.analysis.maxHighlightsPerClip < 1 ||
    !Number.isFinite(config.analysis.highlightDurationSeconds) ||
    config.analysis.highlightDurationSeconds <= 0
  )
    throw new Error('Invalid highlight settings');
  if (
    !['ast'].includes(config.soundClassifier.provider) ||
    !Number.isFinite(config.soundClassifier.windowSeconds) ||
    config.soundClassifier.windowSeconds < 1 ||
    config.soundClassifier.windowSeconds > 20 ||
    !Number.isFinite(config.soundClassifier.hopSeconds) ||
    config.soundClassifier.hopSeconds <= 0 ||
    !Number.isFinite(config.soundClassifier.minConfidence) ||
    config.soundClassifier.minConfidence < 0 ||
    config.soundClassifier.minConfidence > 1 ||
    !Number.isInteger(config.soundClassifier.maxEvents) ||
    config.soundClassifier.maxEvents < 1
  )
    throw new Error('Invalid sound classifier settings');
  if (config.transcription.device && !['cpu', 'cuda', 'auto'].includes(config.transcription.device))
    throw new Error('Invalid transcription device');
  if (!['faster-whisper', 'whisper-cli'].includes(config.transcription.provider ?? 'whisper-cli'))
    throw new Error('Invalid transcription provider');
  await mkdir(path.join(root, config.mediaDir), { recursive: true });
  await writeFile(
    path.join(workspaceDir(root), 'config.json'),
    JSON.stringify(config, null, 2) + '\n',
  );
}
