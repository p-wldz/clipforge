import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnthropicUsage } from '../dist/agents/anthropic.js';
import { isAnalysisProvider, providerInfo } from '../dist/core/providers.js';
test('Anthropic API provider is separate from the installed Claude client', () => {
  assert.equal(isAnalysisProvider('anthropic'), true);
  assert.deepEqual(providerInfo.anthropic, { auth: 'api-key', environment: 'ANTHROPIC_API_KEY' });
  assert.deepEqual(parseAnthropicUsage({ input_tokens: 12, cache_read_input_tokens: 4, output_tokens: 8 }), { inputTokens: 12, cachedInputTokens: 4, outputTokens: 8 });
});
