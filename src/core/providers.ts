import { checkTool } from './process.js';

export const analysisProviders = ['codex', 'claude', 'deepseek', 'openai', 'anthropic'] as const;
export type AnalysisProvider = (typeof analysisProviders)[number];
export type ProviderAuth = 'installed-client' | 'api-key';
export const providerInfo: Record<AnalysisProvider, { auth: ProviderAuth; environment?: string }> = {
  codex: { auth: 'installed-client' },
  claude: { auth: 'installed-client' },
  deepseek: { auth: 'api-key', environment: 'DEEPSEEK_API_KEY' },
  openai: { auth: 'api-key', environment: 'OPENAI_API_KEY' },
  anthropic: { auth: 'api-key', environment: 'ANTHROPIC_API_KEY' },
};
export function isAnalysisProvider(value: unknown): value is AnalysisProvider {
  return typeof value === 'string' && (analysisProviders as readonly string[]).includes(value);
}
export function isKnownProvider(value: unknown) {
  return value === 'none' || value === 'cursor' || isAnalysisProvider(value);
}
export async function detectAgents() {
  const checks = await Promise.all([
    checkTool('codex', ['--version']),
    checkTool('claude', ['--version']),
    checkTool('cursor', ['--version']),
  ]);
  return Object.fromEntries(
    ['codex', 'claude', 'cursor'].map((name, i) => [name, checks[i]]),
  );
}
