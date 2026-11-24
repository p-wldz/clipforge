import { deepseekChat } from './deepseek.js';
import { openaiResponses } from './openai.js';
import { anthropicMessages } from './anthropic.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider } from '../core/paths.js';
import { isAnalysisProvider, type AnalysisProvider } from '../core/providers.js';
import { run } from '../core/process.js';
import { getPrompt } from './prompts.js';
import {
  parseCodexUsage,
  parseClaudeUsage,
  parseClaudeReportedCost,
  estimateApiEquivalent,
  type TokenUsage,
  type PriceCatalog,
} from '../core/usage.js';

export interface AgentSuggestion {
  title: string;
  description: string;
  score: number;
  start: number;
  end: number;
  reason?: string;
}
export interface ClipUnderstanding {
  title: string;
  summary: string;
  story: Array<{ start: number; end: number; description: string }>;
  tags: string[];
  highlights: AgentSuggestion[];
  editorial?: {
    tone: string;
    energy: number | null;
    humor: number | null;
    action: number | null;
    speechLevel: string;
    soundscape: string[];
    bestUses: string[];
    hook: string;
    notableMoments: Array<{
      start: number;
      end: number;
      description: string;
      evidence: string;
      confidence: number;
    }>;
  };
}
export interface AgentTrace {
  status: 'success' | 'failed';
  provider: string;
  model: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  promptPath: string;
  outputPath: string;
  stdoutPath: string;
  stderrPath: string;
  error?: string;
  response?: ClipUnderstanding;
  usage?: TokenUsage | null;
  apiEquivalentUsd?: number | null;
  costStatus?: string;
  providerReportedUsd?: number | null;
}

const responseSchema = `Return ONLY JSON. Fields: title, summary (4-8 informative sentences covering narrative setup, action, aftermath and audio), story (array of {start,end,description}), tags (string[]), editorial ({tone:string, energy:number 0-100, humor:number 0-100, action:number 0-100, speechLevel:'none'|'low'|'medium'|'high', soundscape:string[], bestUses:string[], hook:string, notableMoments:array of {start,end,description,evidence:'visual'|'speech'|'audio'|'combined',confidence:number 0..1}}), highlights (array of {start,end,title,description,score 0..100,reason}). Describe the clip as a WHOLE and the editing context it would best suit: funny moments, action, cinematic montage, teamwork, chaos, tension, reaction, etc. Distinguish directly observed evidence from interpretation; an audio-classifier label alone is NOT proof of an explosion or kill. Do not claim shouting solely because loudness is high. Explicitly mark uncertainty and return 1-5 highlights, or one broader narrative highlight if the action spans most of the clip. All timestamps in seconds; never execute commands.`;
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function parseClipUnderstanding(text: string, duration: number): ClipUnderstanding {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    // Providers sometimes wrap valid JSON in prose; accept only its outer object.
    const first = cleaned.indexOf('{'),
      last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('Agent output contains no JSON object');
    raw = JSON.parse(cleaned.slice(first, last + 1));
  }
  if (
    !isObj(raw) ||
    typeof raw.title !== 'string' ||
    typeof raw.summary !== 'string' ||
    !Array.isArray(raw.highlights)
  )
    throw new Error('Invalid clip analysis: expected title, summary and highlights');
  const story = Array.isArray(raw.story)
    ? raw.story.flatMap((v) =>
        isObj(v) &&
        typeof v.start === 'number' &&
        typeof v.end === 'number' &&
        typeof v.description === 'string' &&
        v.start >= 0 &&
        v.end <= duration + 0.1 &&
        v.end > v.start
          ? [
              {
                start: v.start,
                end: v.end,
                description: v.description.slice(0, 1000),
              },
            ]
          : [],
      )
    : [];
  const highlights = raw.highlights.flatMap((v) => {
    // Invalid suggestions are discarded individually so one bad item does not hide valid ones.
    if (
      !isObj(v) ||
      typeof v.start !== 'number' ||
      typeof v.end !== 'number' ||
      typeof v.score !== 'number' ||
      typeof v.title !== 'string' ||
      typeof v.description !== 'string' ||
      !Number.isFinite(v.start) ||
      !Number.isFinite(v.end) ||
      !Number.isFinite(v.score) ||
      v.start < 0 ||
      v.end > duration + 0.1 ||
      v.end <= v.start
    )
      return [];
    return [
      {
        start: v.start,
        end: Math.min(v.end, duration),
        score: Math.round(Math.max(0, Math.min(100, v.score))),
        title: v.title.slice(0, 120),
        description: v.description.slice(0, 1200),
        reason: typeof v.reason === 'string' ? v.reason.slice(0, 1200) : undefined,
      },
    ];
  });
  if (!highlights.length)
    throw new Error('Agent returned no valid time ranges; check transcript and timestamps');
  const ed = isObj(raw.editorial) ? raw.editorial : null;
  const shortText = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
  const score = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null;
  const editorial = ed
    ? {
        tone: shortText(ed.tone),
        energy: score(ed.energy),
        humor: score(ed.humor),
        action: score(ed.action),
        speechLevel: shortText(ed.speechLevel),
        soundscape: Array.isArray(ed.soundscape)
          ? ed.soundscape.filter((s): s is string => typeof s === 'string').slice(0, 20)
          : [],
        bestUses: Array.isArray(ed.bestUses)
          ? ed.bestUses.filter((s): s is string => typeof s === 'string').slice(0, 20)
          : [],
        hook: shortText(ed.hook, 800),
        notableMoments: Array.isArray(ed.notableMoments)
          ? ed.notableMoments
              .flatMap((m) =>
                isObj(m) &&
                typeof m.start === 'number' &&
                typeof m.end === 'number' &&
                m.start >= 0 &&
                m.end > m.start &&
                m.end <= duration + 0.1
                  ? [
                      {
                        start: m.start,
                        end: m.end,
                        description: shortText(m.description, 800),
                        evidence: shortText(m.evidence, 50),
                        confidence:
                          typeof m.confidence === 'number' && Number.isFinite(m.confidence)
                            ? Math.min(1, Math.max(0, m.confidence))
                            : 0,
                      },
                    ]
                  : [],
              )
              .slice(0, 30)
          : [],
      }
    : undefined;
  return {
    title: raw.title.slice(0, 140),
    summary: raw.summary.slice(0, 5000),
    story,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((x): x is string => typeof x === 'string').slice(0, 25)
      : [],
    highlights: highlights.slice(0, 10),
    ...(editorial ? { editorial } : {}),
  };
}

/** An agent call is one auditable job per clip. Outputs are never shared between concurrent clips. */
export async function understandClip(options: {
  provider: AgentProvider;
  model?: string;
  workspace: string;
  folder: string;
  payload: unknown;
  images: string[];
  pricing?: PriceCatalog;
  onEvent?: (message: string) => void;
  timeoutMs?: number;
}): Promise<{ analysis: ClipUnderstanding; trace: AgentTrace }> {
  const { provider, model, workspace, folder, images, payload, onEvent } = options;
  if (!isAnalysisProvider(provider)) throw new Error(`Unsupported agent: ${provider}`);
  const aiDir = path.join(folder, 'ai');
  await mkdir(aiDir, { recursive: true });
  const promptPath = path.join(aiDir, 'prompt.txt'),
    outputPath = path.join(aiDir, 'response.txt'),
    stdoutPath = path.join(aiDir, 'stdout.log'),
    stderrPath = path.join(aiDir, 'stderr.log');
  const instructions = await getPrompt(workspace, 'clip-analysis');
  const selectionInstructions = await getPrompt(workspace, 'highlight-selection');
  const prompt = `${instructions}\n\nHIGHLIGHT SELECTION GUIDELINES:\n${selectionInstructions}\n\n${responseSchema}\n\nCLIP INPUT:\n${JSON.stringify(payload, null, 2).slice(0, 100_000)}\n\nIMAGE PATHS (read images if available):\n${images.join('\n')}`;
  await writeFile(promptPath, prompt);
  const startedAt = new Date().toISOString(),
    start = Date.now();
  const trace: AgentTrace = {
    status: 'failed',
    provider,
    model: model ?? null,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    promptPath,
    outputPath,
    stdoutPath,
    stderrPath,
  };
  try {
    let responseText = '';
    onEvent?.(`Invoking ${provider}${model ? ` (${model})` : ''} with ${images.length} frames`);
    if (provider === 'deepseek' || provider === 'openai' || provider === 'anthropic') {
      const result =
        provider === 'deepseek'
          ? await deepseekChat(prompt, {
              model,
              images,
              timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
            })
          : provider === 'openai'
            ? await openaiResponses(prompt, {
                model,
                images,
                timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
              })
            : await anthropicMessages(prompt, {
                model,
                images,
                timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
              });
      responseText = result.text;
      trace.model = result.model;
      trace.usage = result.usage;
      await writeFile(outputPath, responseText);
      await writeFile(stdoutPath, result.raw);
      await writeFile(stderrPath, '');
      const estimate = estimateApiEquivalent(provider, result.model, trace.usage, options.pricing);
      trace.apiEquivalentUsd = estimate.usd;
      trace.costStatus = estimate.status;
      onEvent?.(
        `${provider} usage: ${trace.usage ? JSON.stringify(trace.usage) : 'not reported'}; estimated API cost: ${estimate.usd === null ? 'unpriced' : '$' + estimate.usd.toFixed(5)}`,
      );
    } else if (provider === 'codex') {
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        ...(model ? ['--model', model] : []),
        '-o',
        outputPath,
        ...images.flatMap((x) => ['--image', x]),
        '-',
      ];
      const output = await run('codex', args, {
        cwd: workspace,
        input: prompt,
        timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
        onStdout: (t) => onEvent?.(`Codex: ${t.trim().slice(0, 240)}`),
        onStderr: (t) => onEvent?.(`Codex stderr: ${t.trim().slice(0, 240)}`),
      });
      await writeFile(stdoutPath, String(output.stdout));
      await writeFile(stderrPath, output.stderr);
      trace.usage = parseCodexUsage(String(output.stdout));
      const estimate = estimateApiEquivalent(provider, model, trace.usage, options.pricing);
      trace.apiEquivalentUsd = estimate.usd;
      trace.costStatus = estimate.status;
      onEvent?.(
        `Codex usage: ${trace.usage ? `${trace.usage.inputTokens} in / ${trace.usage.cachedInputTokens} cached / ${trace.usage.outputTokens} out` : 'not reported'}; API equivalent: ${estimate.usd === null ? 'unknown' : `$${estimate.usd.toFixed(5)}`}`,
      );
      responseText = await readFile(outputPath, 'utf8');
    } else {
      const args = ['-p', '--output-format', 'json', ...(model ? ['--model', model] : []), prompt];
      const output = await run('claude', args, {
        cwd: workspace,
        timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
        onStderr: (t) => onEvent?.(`Claude stderr: ${t.trim().slice(0, 240)}`),
      });
      await writeFile(stdoutPath, String(output.stdout));
      await writeFile(stderrPath, output.stderr);
      const parsed = JSON.parse(String(output.stdout)) as {
        result?: string;
        usage?: {
          input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        };
      };
      responseText = parsed.result ?? '';
      trace.usage = parseClaudeUsage(parsed);
      trace.providerReportedUsd = parseClaudeReportedCost(parsed);
      const estimate = estimateApiEquivalent(provider, model, trace.usage, options.pricing);
      trace.costStatus = estimate.status;
      trace.apiEquivalentUsd = estimate.usd;
      onEvent?.(
        `Claude usage: ${trace.usage ? JSON.stringify(trace.usage) : 'not reported'}; API equivalent: ${estimate.usd === null ? 'unknown' : '$' + estimate.usd.toFixed(5)}`,
      );
      await writeFile(outputPath, responseText);
    }
    const duration = isObj(payload) && typeof payload.duration === 'number' ? payload.duration : 60;
    const analysis = parseClipUnderstanding(responseText, duration);
    trace.status = 'success';
    trace.response = analysis;
    return { analysis, trace };
  } catch (error) {
    trace.error = (error as Error).message;
    await writeFile(path.join(aiDir, 'error.txt'), trace.error);
    throw error;
  } finally {
    trace.finishedAt = new Date().toISOString();
    trace.durationMs = Date.now() - start;
    await writeFile(path.join(aiDir, 'trace.json'), JSON.stringify(trace, null, 2));
    onEvent?.(
      `${provider} ${trace.status} after ${Math.round(trace.durationMs / 1000)}s${trace.error ? ': ' + trace.error : ''}`,
    );
  }
}

export function codexTextArgs(
  model: string | undefined,
  outputPath: string,
  images: string[] = [],
) {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    ...(model ? ['--model', model] : []),
    '-o',
    outputPath,
    ...images.flatMap((image) => ['--image', image]),
    '-',
  ];
}

/** Shared non-interactive agent path, with prompt over stdin to avoid Windows command-line length limits. */
export async function runAgentText(
  provider: AnalysisProvider,
  model: string | undefined,
  workspace: string,
  prompt: string,
  outputPath: string,
  timeoutMs = 120000,
  onUsage?: (usage: TokenUsage | null, providerReportedUsd?: number | null) => void,
  signal?: AbortSignal,
  onEvent?: (message: string) => void,
  images: string[] = [],
): Promise<string> {
  const started = Date.now();
  onEvent?.(
    `${provider}: starting model=${model || 'default'}, prompt=${prompt.length} chars, timeout=${Math.round(timeoutMs / 1000)}s`,
  );
  try {
    if (provider === 'deepseek' || provider === 'openai' || provider === 'anthropic') {
      const result =
        provider === 'deepseek'
          ? await deepseekChat(prompt, { model, images, timeoutMs, signal })
          : provider === 'openai'
            ? await openaiResponses(prompt, { model, images, timeoutMs, signal })
            : await anthropicMessages(prompt, { model, images, timeoutMs, signal });
      onUsage?.(result.usage);
      await writeFile(outputPath, result.text);
      onEvent?.(
        `${provider}: completed in ${Date.now() - started}ms; response=${result.text.length} chars`,
      );
      return result.text;
    }
    if (provider === 'codex') {
      onEvent?.('codex: exec --json, sandbox=read-only, JSON validated by the stage parser');
      if (images.length) onEvent?.(`codex: attaching ${images.length} image(s) via --image`);
      const output = await run('codex', codexTextArgs(model, outputPath, images), {
        cwd: workspace,
        input: prompt,
        timeoutMs,
        signal,
      });
      onUsage?.(parseCodexUsage(String(output.stdout)));
      const response = await readFile(outputPath, 'utf8');
      onEvent?.(
        `codex: completed in ${Date.now() - started}ms; response=${response.length} chars, trace=${String(output.stdout).length} chars`,
      );
      return response;
    }
    const args = ['-p', '--output-format', 'json', ...(model ? ['--model', model] : [])];
    const output = await run('claude', args, {
      cwd: workspace,
      input: prompt,
      timeoutMs,
      signal,
    });
    const parsed = JSON.parse(String(output.stdout)) as {
      result?: string;
      usage?: {
        input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
    };
    const response = parsed.result ?? '';
    onUsage?.(parseClaudeUsage(parsed), parseClaudeReportedCost(parsed));
    onEvent?.(`claude: completed in ${Date.now() - started}ms; response=${response.length} chars`);
    return response;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(
      `${provider} request failed after ${Date.now() - started}ms (model=${model || 'default'}, prompt=${prompt.length} chars): ${(error as Error).message}`,
    );
  }
}
