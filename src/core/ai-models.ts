import { deepseekKey, deepseekModels } from '../agents/deepseek.js';
import { openaiKey, openaiModels } from '../agents/openai.js';
import { anthropicKey, anthropicModels } from '../agents/anthropic.js';
import { detectAgents } from './providers.js';
import { loadConfig } from './paths.js';
import { run } from './process.js';
import { codexModelCatalog, type DiscoveredModel } from './codex-models.js';

export type ModelInventoryEntry = {
  installed: boolean;
  version?: string;
  models: string[];
  modelDetails: DiscoveredModel[];
  source: 'app-server' | 'provider-api' | 'cli' | 'none';
  note: string;
  usable: boolean;
  accessVerified: false; // The model catalog is not proof of subscription entitlement.
};
const normalize = (value: string): DiscoveredModel => ({
  id: value,
  label: value,
  inputModalities: ['text', 'image'],
});
/** Never present locally configured/hard-coded IDs as if the provider grants access. */
export async function scanAiModels(root: string) {
  const [installed, config] = await Promise.all([detectAgents(), loadConfig(root)]);
  const providers: Record<string, ModelInventoryEntry> = {};
  for (const name of ['codex', 'claude', 'cursor'] as const) {
    const check = installed[name]!;
    let models: DiscoveredModel[] = [],
      source: ModelInventoryEntry['source'] = 'none';
    let note = check.installed ? 'Checking current provider catalog...' : 'CLI not installed';
    if (check.installed && name === 'codex') {
      try {
        models = await codexModelCatalog();
        source = 'app-server';
        note =
          'Current Codex app-server model catalog. Actual subscription access requires a successful model test.';
      } catch (e) {
        note = `Codex model discovery failed: ${(e as Error).message}. CLI default is available as fallback.`;
      }
    }
    if (name === 'claude') {
      try {
        if (check.installed) {
          const output = String(
            (
              await run('claude', ['models'], {
                timeoutMs: 7000,
                maxBuffer: 60000,
              })
            ).stdout,
          );
          const ids = [
            ...new Set(
              output.match(/\bclaude-(?:opus|sonnet|haiku|fable)-[a-zA-Z0-9.-]+\b/g) ?? [],
            ),
          ];
          models = ids.map(normalize);
          source = ids.length ? 'cli' : 'none';
          note = ids.length
            ? 'Models detected from Claude CLI; test the chosen model for subscription access.'
            : 'Claude Code does not expose a supported account model API here; use CLI default or provide an Anthropic API key.';
        }
      } catch (e) {
        note = `Claude model discovery unavailable: ${(e as Error).message}. CLI default is available.`;
      }
    }
    if (name === 'cursor')
      note = 'Cursor CLI detected but the analysis adapter is not implemented.';
    providers[name] = {
      installed: check.installed,
      version: check.installed ? check.version : undefined,
      models: models.map((x) => x.id),
      modelDetails: models,
      source,
      note,
      usable: check.installed && name !== 'cursor',
      accessVerified: false,
    };
  }
  const available = !!deepseekKey();
  let dsModels: DiscoveredModel[] = [],
    note = 'DEEPSEEK_API_KEY is required for live model discovery';
  let source: ModelInventoryEntry['source'] = 'none';
  if (available) {
    try {
      const models = await deepseekModels();
      dsModels = models.map((x) => ({
        id: x.id,
        label: x.name || x.id,
        inputModalities: x.input_modalities ?? ['text'],
      }));
      source = 'provider-api';
      note = 'Live DeepSeek models for this API key. Verify the selected model with Test AI.';
    } catch (e) {
      note = 'DeepSeek API model discovery failed: ' + (e as Error).message;
    }
  }
  providers.deepseek = {
    installed: available,
    models: dsModels.map((m) => m.id),
    modelDetails: dsModels,
    source,
    note,
    usable: available,
    accessVerified: false,
  };
  const openaiAvailable = !!openaiKey();
  let openai: DiscoveredModel[] = [],
    openaiNote = 'OPENAI_API_KEY is required for live model discovery';
  if (openaiAvailable) {
    try {
      openai = (await openaiModels()).map((model) => normalize(model.id));
      openaiNote = 'Live OpenAI API models for this key. Verify the selected model with Test AI.';
    } catch (error) {
      openaiNote = `OpenAI model discovery unavailable: ${(error as Error).message}`;
    }
  }
  providers.openai = {
    installed: openaiAvailable,
    models: openai.map((model) => model.id),
    modelDetails: openai,
    source: openaiAvailable ? 'provider-api' : 'none',
    note: openaiNote,
    usable: openaiAvailable,
    accessVerified: false,
  };
  const anthropicAvailable = !!anthropicKey();
  let anthropic: DiscoveredModel[] = [],
    anthropicNote = 'ANTHROPIC_API_KEY is required for live model discovery';
  if (anthropicAvailable) {
    try {
      anthropic = (await anthropicModels()).map((model) => ({
        id: model.id,
        label: model.display_name || model.id,
        inputModalities: ['text', 'image'],
      }));
      anthropicNote = 'Live Anthropic API models for this API key. Verify the selected model with Test AI.';
    } catch (error) {
      anthropicNote = `Anthropic model discovery unavailable: ${(error as Error).message}`;
    }
  }
  providers.anthropic = {
    installed: anthropicAvailable,
    models: anthropic.map((model) => model.id),
    modelDetails: anthropic,
    source: anthropicAvailable ? 'provider-api' : 'none',
    note: anthropicNote,
    usable: anthropicAvailable,
    accessVerified: false,
  };
  return {
    providers,
    stages: config.aiStages ?? {
      clipAnalysis: config.agent,
      montage: config.agent,
    },
    note: 'A catalog or API model list is not an entitlement guarantee. Test the selected model before analysis.',
  };
}
