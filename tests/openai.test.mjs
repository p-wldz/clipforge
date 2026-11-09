import test from 'node:test';
import assert from 'node:assert/strict';
import { openaiResponses, parseOpenaiUsage } from '../dist/agents/openai.js';

test('OpenAI Responses adapter sends text and reports token usage', async () => {
  const oldKey = process.env.OPENAI_API_KEY, oldFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = 'fake-test-key';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer fake-test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'test-vision-model');
      assert.equal(body.input[0].content[0].type, 'input_text');
      assert.equal(body.store, false);
      return new Response(JSON.stringify({ output_text: '{"ok":true}', usage: { input_tokens: 8, output_tokens: 3, input_tokens_details: { cached_tokens: 2 } } }), { status: 200 });
    };
    const result = await openaiResponses('test', { model: 'test-vision-model' });
    assert.equal(result.text, '{"ok":true}');
    assert.deepEqual(result.usage, { inputTokens: 8, cachedInputTokens: 2, outputTokens: 3 });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
});

test('OpenAI usage rejects incomplete provider payloads', () => {
  assert.equal(parseOpenaiUsage({ input_tokens: 2 }), null);
});
