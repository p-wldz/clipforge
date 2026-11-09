import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TokenUsage } from '../core/usage.js';
import { AppError } from '../core/errors.js';

export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';
export function deepseekKey() {
  return process.env.DEEPSEEK_API_KEY?.trim() || null;
}
export function parseDeepseekUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const input = u.prompt_tokens,
    output = u.completion_tokens;
  if (
    typeof input !== 'number' ||
    typeof output !== 'number' ||
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  )
    return null;
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const hit = u.prompt_cache_hit_tokens ?? details?.cached_tokens ?? 0;
  return {
    inputTokens: input,
    cachedInputTokens: typeof hit === 'number' ? Math.min(input, Math.max(0, hit)) : 0,
    outputTokens: output,
  };
}
export async function deepseekChat(
  prompt: string,
  opts: { model?: string; images?: string[]; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{
  text: string;
  usage: TokenUsage | null;
  raw: string;
  model: string;
}> {
  const key = deepseekKey();
  if (!key)
    throw new AppError(
      'DeepSeek is not configured.',
      'DEEPSEEK_KEY_MISSING',
      'Start Clipforge with --env-file <path> containing DEEPSEEK_API_KEY, then test the adapter again.',
    );
  const model = opts.model || DEFAULT_DEEPSEEK_MODEL;
  if (opts.images?.length && model !== 'deepseek-flash')
    throw new AppError(
      'The selected DeepSeek model cannot receive sampled frames.',
      'DEEPSEEK_VISION_MODEL_REQUIRED',
      'Choose a DeepSeek vision-capable model for clip analysis, or use a text-only provider for stages without frames.',
    );
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const image of opts.images ?? []) {
    const bytes = await readFile(image);
    if (bytes.length > 20 * 1024 * 1024)
      throw new Error('Frame exceeds Clipforge 20 MiB per-image safety limit');
    const ext = path.extname(image).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${mime};base64,${bytes.toString('base64')}`,
        detail: 'low',
      },
    });
  }
  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      stream: false,
      thinking: { type: 'disabled' },
    }),
    signal: opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 180000)])
      : AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  const raw = await response.text();
  if (!response.ok)
    throw new AppError(
      `DeepSeek API request failed (HTTP ${response.status}).`,
      'DEEPSEEK_API_REQUEST_FAILED',
      deepseekHint(response.status),
      response.status === 401 || response.status === 403 ? 401 : 502,
    );
  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('DeepSeek API returned an empty response');
  return { text, usage: parseDeepseekUsage(data.usage), raw, model };
}

function deepseekHint(status: number) {
  if (status === 401 || status === 403)
    return 'Check DEEPSEEK_API_KEY and its account permissions, then run the adapter test again.';
  if (status === 429)
    return 'DeepSeek rate-limited this request. Wait before retrying or reduce concurrent work.';
  return 'Check the provider status, selected model, and local run log before retrying.';
}
export async function deepseekModels(): Promise<
  Array<{ id: string; name?: string; input_modalities?: string[] }>
> {
  const key = deepseekKey();
  if (!key) return [];
  const response = await fetch(`${DEEPSEEK_API_BASE}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`DeepSeek models API HTTP ${response.status}`);
  const data = (await response.json()) as {
    data?: Array<{ id: string; name?: string; input_modalities?: string[] }>;
  };
  return (data.data ?? []).filter((x) => typeof x.id === 'string');
}
