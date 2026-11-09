import { checkTool } from './process.js';

export const analysisProviders = ['codex', 'claude', 'deepseek', 'openai', 'anthropic'] as const;
export type AnalysisProvider = (typeof analysisProviders)[number];
export type ProviderAuth = 'installed-client' | 'api-key';
export const providerInfo: Record<AnalysisProvider, { auth: ProviderAuth; environment?: string; label: string; hint: string }> = {
  codex: { auth: 'installed-client', label: 'Codex', hint: 'Installed Codex client. Uses its signed-in OS account and sends selected frames only for this explicit run.' },
  claude: { auth: 'installed-client', label: 'Claude', hint: 'Installed Claude client. Uses its signed-in OS account and sends analysis input only for this explicit run.' },
  deepseek: { auth: 'api-key', environment: 'DEEPSEEK_API_KEY', label: 'DeepSeek API', hint: 'DeepSeek API key. Start Clipforge with --env-file containing DEEPSEEK_API_KEY before testing or analyzing.' },
  openai: { auth: 'api-key', environment: 'OPENAI_API_KEY', label: 'OpenAI API', hint: 'OpenAI API key. Start Clipforge with --env-file containing OPENAI_API_KEY, choose a discovered model, then test it.' },
  anthropic: { auth: 'api-key', environment: 'ANTHROPIC_API_KEY', label: 'Anthropic API', hint: 'Anthropic API key. Start Clipforge with --env-file containing ANTHROPIC_API_KEY, choose a discovered model, then test it.' },
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
