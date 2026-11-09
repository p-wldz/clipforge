import test from 'node:test';
import assert from 'node:assert/strict';
import { isAnalysisProvider, isKnownProvider, providerInfo } from '../dist/core/providers.js';

test('provider registry distinguishes runnable providers and their credential route', () => {
  assert.equal(isAnalysisProvider('openai'), true);
  assert.equal(isAnalysisProvider('cursor'), false);
  assert.equal(isKnownProvider('cursor'), true);
  assert.equal(isKnownProvider('unknown'), false);
  assert.equal(providerInfo.openai.environment, 'OPENAI_API_KEY');
  assert.equal(providerInfo.openai.auth, 'api-key');
  assert.equal(providerInfo.codex.auth, 'installed-client');
  assert.match(providerInfo.anthropic.hint, /ANTHROPIC_API_KEY/);
});
