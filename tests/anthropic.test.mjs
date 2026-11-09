import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnthropicUsage } from '../dist/agents/anthropic.js';
import { isAnalysisProvider, providerInfo } from '../dist/core/providers.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('Anthropic API provider is separate from the installed Claude client', () => {
  assert.equal(isAnalysisProvider('anthropic'), true);
  assert.equal(providerInfo.anthropic.auth, 'api-key');
  assert.equal(providerInfo.anthropic.environment, 'ANTHROPIC_API_KEY');
  assert.equal(providerInfo.anthropic.label, 'Anthropic API');
  assert.deepEqual(parseAnthropicUsage({ input_tokens: 12, cache_read_input_tokens: 4, output_tokens: 8 }), { inputTokens: 12, cachedInputTokens: 4, outputTokens: 8 });
});

test('Anthropic Messages adapter sends explicit image input and preserves usage', async () => {
  const { anthropicMessages } = await import('../dist/agents/anthropic.js');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'cf-anthropic-'));
  const image = path.join(folder, 'frame.png');
  const oldKey = process.env.ANTHROPIC_API_KEY, oldFetch = globalThis.fetch;
  try {
    await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.headers['x-api-key'], 'fake-anthropic-key');
      assert.equal(options.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'claude-test');
      assert.equal(body.messages[0].content[1].type, 'image');
      assert.equal(body.messages[0].content[1].source.media_type, 'image/png');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 9, cache_read_input_tokens: 2, output_tokens: 4 } }), { status: 200 });
    };
    const result = await anthropicMessages('describe', { model: 'claude-test', images: [image] });
    assert.equal(result.text, '{"ok":true}');
    assert.deepEqual(result.usage, { inputTokens: 9, cachedInputTokens: 2, outputTokens: 4 });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
    await rm(folder, { recursive: true, force: true });
  }
});

test('Anthropic authorization failures provide a safe recovery hint', async () => {
  const { anthropicMessages } = await import('../dist/agents/anthropic.js');
  const oldKey = process.env.ANTHROPIC_API_KEY, oldFetch = globalThis.fetch;
  try {
    process.env.ANTHROPIC_API_KEY = 'fake-anthropic-key';
    globalThis.fetch = async () => new Response('{"error":{"message":"no"}}', { status: 401 });
    await assert.rejects(
      () => anthropicMessages('describe', { model: 'claude-test' }),
      (error) => error.code === 'ANTHROPIC_API_REQUEST_FAILED' && error.hint.includes('ANTHROPIC_API_KEY'),
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});
