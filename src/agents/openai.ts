import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TokenUsage } from '../core/usage.js';
import { AppError } from '../core/errors.js';

export const OPENAI_API_BASE = 'https://api.openai.com/v1';

export function openaiKey() {
  return process.env.OPENAI_API_KEY?.trim() || null;
}

export function parseOpenaiUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const input = usage.input_tokens, output = usage.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number' || input < 0 || output < 0)
    return null;
  const details = usage.input_tokens_details as Record<string, unknown> | undefined;
  const cached = details?.cached_tokens;
  return { inputTokens: input, cachedInputTokens: typeof cached === 'number' ? cached : 0, outputTokens: output };
}

export async function openaiResponses(
  prompt: string,
  opts: { model?: string; images?: string[]; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  const key = openaiKey();
  if (!key)
    throw new AppError('OpenAI is not configured.', 'OPENAI_KEY_MISSING', 'Start Clipforge with --env-file <path> containing OPENAI_API_KEY, then test the adapter again.');
  if (!opts.model)
    throw new AppError('Choose an OpenAI model first.', 'OPENAI_MODEL_REQUIRED', 'Scan models, select one for this stage, then run the adapter test.');
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: prompt }];
  for (const image of opts.images ?? []) {
    const bytes = await readFile(image);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Frame exceeds Clipforge 20 MiB per-image safety limit');
    const ext = path.extname(image).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    content.push({ type: 'input_image', image_url: `data:${mime};base64,${bytes.toString('base64')}`, detail: 'low' });
  }
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, input: [{ role: 'user', content }], store: false }),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 180000)]) : AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  const raw = await response.text();
  if (!response.ok) throw new AppError(`OpenAI API request failed (HTTP ${response.status}).`, 'OPENAI_API_REQUEST_FAILED', response.status === 401 ? 'Check OPENAI_API_KEY and its project permissions, then test again.' : 'Check the selected model and local run log before retrying.', response.status === 401 ? 401 : 502);
  const data = JSON.parse(raw) as { output_text?: string; usage?: unknown };
  if (!data.output_text) throw new Error('OpenAI API returned an empty response');
  return { text: data.output_text, usage: parseOpenaiUsage(data.usage), raw, model: opts.model };
}

export async function openaiModels() {
  const key = openaiKey();
  if (!key) return [];
  const response = await fetch(`${OPENAI_API_BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new AppError(`OpenAI model discovery failed (HTTP ${response.status}).`, 'OPENAI_MODEL_DISCOVERY_FAILED', 'Check OPENAI_API_KEY and its project permissions.');
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? []).filter((model): model is { id: string } => typeof model.id === 'string');
}
