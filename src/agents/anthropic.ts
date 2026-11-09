import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TokenUsage } from '../core/usage.js';
import { AppError } from '../core/errors.js';

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
export function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}
export function parseAnthropicUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const usage = raw as Record<string, unknown>;
  const input = usage.input_tokens, output = usage.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number' || input < 0 || output < 0)
    return null;
  const cached = usage.cache_read_input_tokens;
  return { inputTokens: input, cachedInputTokens: typeof cached === 'number' ? cached : 0, outputTokens: output };
}
export async function anthropicMessages(
  prompt: string,
  opts: { model?: string; images?: string[]; timeoutMs?: number; signal?: AbortSignal } = {},
) {
  const key = anthropicKey();
  if (!key)
    throw new AppError('Anthropic API is not configured.', 'ANTHROPIC_KEY_MISSING', 'Start Clipforge with --env-file <path> containing ANTHROPIC_API_KEY, then test the adapter again.');
  if (!opts.model)
    throw new AppError('Choose an Anthropic model first.', 'ANTHROPIC_MODEL_REQUIRED', 'Scan models, select one for this stage, then run the adapter test.');
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const image of opts.images ?? []) {
    const bytes = await readFile(image);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Frame exceeds Clipforge 20 MiB per-image safety limit');
    const ext = path.extname(image).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } });
  }
  const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: opts.model, max_tokens: 8192, messages: [{ role: 'user', content }] }),
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 180000)]) : AbortSignal.timeout(opts.timeoutMs ?? 180000),
  });
  const raw = await response.text();
  if (!response.ok) throw new AppError(`Anthropic API request failed (HTTP ${response.status}).`, 'ANTHROPIC_API_REQUEST_FAILED', response.status === 401 ? 'Check ANTHROPIC_API_KEY and its workspace permissions, then test again.' : 'Check the selected model and local run log before retrying.', response.status === 401 ? 401 : 502);
  const data = JSON.parse(raw) as { content?: Array<{ type?: string; text?: string }>; usage?: unknown };
  const text = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
  if (!text) throw new Error('Anthropic API returned an empty response');
  return { text, usage: parseAnthropicUsage(data.usage), raw, model: opts.model };
}
export async function anthropicModels() {
  const key = anthropicKey();
  if (!key) return [];
  const response = await fetch(`${ANTHROPIC_API_BASE}/models?limit=100`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new AppError(`Anthropic model discovery failed (HTTP ${response.status}).`, 'ANTHROPIC_MODEL_DISCOVERY_FAILED', 'Check ANTHROPIC_API_KEY and its workspace permissions.');
  const data = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  return (data.data ?? []).filter((model): model is { id: string; display_name?: string } => typeof model.id === 'string');
}
