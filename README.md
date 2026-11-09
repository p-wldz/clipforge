# Clipforge Local

Clipforge turns local gameplay recordings into reviewable highlights and editable films. It keeps source videos untouched, stores project state beside the project, and only contacts an AI provider when you explicitly request it.

It is a review tool, not a reliable game-event detector. Audio activity and AudioSet labels are signals, not proof of a kill, explosion, or joke. AI output is a proposal; rendering always requires an explicit user action.

## Install Clipforge

- Node.js 22.13 or newer
- FFmpeg and FFprobe on `PATH` for analysis and rendering
- Optional: authenticated Codex, Claude Code, or DeepSeek configuration for AI stages
- Optional: Python 3 for local transcription and sound classification

From a checkout of this repository:

```sh
npm install
npm run build
npm link
```

`npm link` makes the `clipforge` command available in your terminal. If you prefer not to link it globally, use `node /path/to/clipforge/dist/cli.js` in the examples below.

`clipforge doctor` reports missing tools. It never installs software or calls an AI provider.

## Create a project and add clips

```sh
mkdir my-highlights && cd my-highlights
clipforge init --interactive
```

This creates a `clips/` folder. Copy or move your recordings into that folder. Clipforge reads common `.mp4`, `.mkv`, `.mov`, and `.webm` files; it never changes them.

```text
my-highlights/
  clips/                 ← put gameplay recordings here
  .clipforge/            ← Clipforge's local state, artifacts, and renders
```

Use a different folder at creation time with `clipforge init --clips-dir recordings`, or choose it in the interactive setup. The clips folder must stay inside the project and outside `.clipforge/`.

## Make highlights

Run the local analysis after adding clips:

```sh
clipforge doctor
clipforge analyze
clipforge dashboard
```

Open `http://127.0.0.1:4173`. In the dashboard:

1. Review the candidate moments Clipforge found.
2. Trim a candidate if needed, then approve or reject it.
3. Create a film from approved highlights, or use Film Studio to arrange any available highlights manually.
4. Preview the timeline and choose **Render** when you are ready. The finished file is saved under `.clipforge/renders/`.

Local analysis uses media metadata, frames, audio activity, and any optional local enrichment you enable. It can suggest moments, but it does not prove game events.

## Use AI understanding and suggestions

To use AI analysis, choose a provider and opt in explicitly:

```sh
clipforge ai set understanding codex
clipforge ai set editing codex
clipforge analyze --agent --force
```

An AI call can transmit selected frames and analysis metadata to that provider and may consume quota. It is never part of the default analysis path. You can test a configured provider before analysing your clips:

```sh
clipforge ai test understanding
```

### DeepSeek API credentials

DeepSeek uses `DEEPSEEK_API_KEY`; the key is never stored in the workspace configuration. Put it in a private file outside the video project (copy [`.env.example`](.env.example) as a starting point), then explicitly load it for the command:

```sh
clipforge --env-file /secure/path/clipforge.env agent test deepseek
clipforge --env-file /secure/path/clipforge.env ai set clip deepseek
clipforge --env-file /secure/path/clipforge.env analyze --agent deepseek
```

The command reports only the number of variables loaded, never their values. Existing environment variables take precedence, which keeps CI and shell-injected secrets authoritative. Open **AI adapters** in the dashboard to choose a discovered model, then run its connection test before analyzing media.

OpenAI and Anthropic API adapters work the same way with `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; select `openai` or `anthropic` after scanning its live model catalog. They are separate from the installed Codex and Claude clients, and send frames only for an explicit analysis run.

| Provider choice | Authentication route | What it means |
| --- | --- | --- |
| `none` | None | Fully local candidate analysis. |
| `codex` / `claude` | Installed, signed-in OS client | Uses that client’s account and configuration; no API key is saved by Clipforge. |
| `deepseek` / `openai` | Explicit environment variable | Uses `DEEPSEEK_API_KEY` or `OPENAI_API_KEY` from the current terminal or `--env-file`. |

An installed client and an API key are deliberately separate choices. Clipforge does not silently switch between them.

## What Clipforge does

1. **Media analysis** probes the video, samples frames, records audio activity, and optionally runs local transcription or sound classification.
2. **Deep Action Analysis** is an optional AI pass that maps complete actions from quiet setup through outcome and reaction, with timestamped evidence and uncertainty. It is independent of creative preferences and cached for reuse.
3. **Contextual understanding** is an optional domain interpretation layer. It can explain game terminology without changing the base observations.
4. **Contextual Editing** decides which complete actions fit the editing context, including exact boundaries, setup/reaction needs, and optional acceleration. It can select none.
5. **Critical Review** is optional and limited to one pass (`analysis.criticalReviewPasses: 1`); it stores original and corrected proposals and flags uncertain ranges for visual reanalysis.
6. **Film direction** selects and orders existing highlights for a separate film-direction context. It creates an editable proposal, never an automatic render.
7. **Human review and rendering** happen in the dashboard or CLI. Source recordings are never modified.

Projects have three independent contexts in `.clipforge/contexts.json`:

- `domain`: what events mean in the game or domain.
- `editing`: what makes a clip useful as a highlight.
- `filmDirection`: what the final film should feel like.

Changing an editing or film-direction context does not invalidate media analysis or base understanding. Base artifacts are stored in `.clipforge/artifacts/<clip-id>/understanding/`; context-keyed highlight sets and cache metadata are stored in the local SQLite database.

## CLI reference

See [docs/CLI.md](docs/CLI.md) for terminal-first workflows, examples, and safety notes.

Every command accepts `--root <workspace-path>` before the command. Without it, Clipforge uses the current directory. `--env-file <path>` explicitly loads credentials from a dotenv-style file without writing secrets into the project.

| Command | Description | Options |
| --- | --- | --- |
| `init [folder]` | Create a local project. | `--interactive`, `--name <name>`, `--description <text>`, `--focus <text>`, `--clips-dir <folder>`, `--frame-interval <seconds>`, `--audio <yes\|no>`, `--transcription <yes\|no>`, `--min-duration <seconds>`, `--max-duration <seconds>` (`0` means unlimited), `--require-audio <yes\|no>` |
| `doctor` | Check available dependencies; no installation or AI invocation. | `--json` |
| `setup` | Plan or explicitly install optional local transcription/classification dependencies. | `--interactive`, `--transcription`, `--sound-classifier`, `--device <cpu\|cuda\|auto>`, `--scope <project\|user>`, `--dry-run`, `--yes` |
| `analyze [file\|folder]` | Run local analysis. | `--agent [codex\|claude\|cursor\|deepseek]`, `--force` |
| `dashboard` | Start the local dashboard. | `--port <1024-65535>` |
| `agents` | Detect installed provider CLIs. | — |
| `agent [provider]` | Show or set the legacy default provider. | `none`, `codex`, `claude`, `cursor`, or `deepseek`; `agent test [provider]` makes a real call |
| `ai models` | Discover provider model IDs. Discovery does not verify access. | — |
| `ai set <stage> <provider> [model]` | Set a provider/model for a stage. | Stages: `understanding`, `contextual`, `editing`, `critical`, `direction`; compatibility aliases: `clip`, `montage` |
| `ai test <stage>` | Make a real provider connection test for a configured stage. | Same stages as `ai set` |
| `prompts` | List editable project prompt files. | `show <name>` prints one prompt |
| `suggest [provider]` | Generate an editable film proposal from stored highlights. | Provider: `codex`, `claude`, or `deepseek` |
| `highlights` | List candidate highlights. | `--json` |
| `approve <id>` / `reject <id>` | Change candidate review status. | — |
| `project <name>` | Create a project from approved highlights. | — |
| `projects` | List film projects. | — |
| `render <project-id>` | Render an existing project explicitly. | — |
| `search <phrase>` | Search timestamped transcript segments. | `--json` |
| `skipped` | List clips skipped by pre-analysis filters. | `--json` |
| `runs` | List recent analysis runs. | `--json` |
| `logs [run-id]` | Print stage events for a run. | — |
| `usage [run-id]` | Show provider-reported usage and clearly-labelled pricing estimates. | — |

`cursor` is detectable but does not have an analysis adapter. `--agent` without a provider uses the configured understanding profile. `--force` reprocesses eligible clips while preserving approved and rejected highlights.

## Where Clipforge stores your work

`clipforge init` creates this local layout:

```text
project/
  clips/                         original videos; never changed
  .clipforge/
    config.json                  project and tool configuration
    contexts.json                domain, editing, and film-direction contexts
    context.md                  legacy creative brief; retained for compatibility
    prompts/                     editable stage instructions
    state.sqlite                 clips, reviews, projects, runs, and caches
    artifacts/<clip-id>/         frames, transcripts, observations, AI traces
    renders/<project-id>/        explicit FFmpeg exports
```

If no stage profile is configured, the relevant stage inherits the default `agent` profile. Project prompts are created only when absent; Clipforge does not overwrite edits.

Prompt names include:

- `understanding-base` → `prompts/understanding/base.md`
- `understanding-contextual` → `prompts/understanding/contextual.md`
- `editing-boundary-refinement` → `prompts/editing/boundary-refinement.md`
- `clip-analysis`, `highlight-selection`, `montage`, `film-direction`, `film-regeneration`, and `agent-test`

The dashboard labels each prompt by its job and describes the guardrail it controls before showing the raw editable text. Prompt files remain advanced project instructions: they guide optional AI calls, but schema validation and human approval remain enforced in code. All dashboard requests stay local.

## Optional local enrichment

Transcription and AST sound classification are disabled by default. Preview what setup would do:

```sh
clipforge setup --transcription --sound-classifier --dry-run
```

Run the plan only after reviewing it:

```sh
clipforge setup --transcription --sound-classifier --yes
```

Setup uses an isolated project or user-scoped Python environment, never global `pip`. Initial model downloads can be large. Sound labels are rough AudioSet estimates and should never be treated as confirmed gameplay events.

## Privacy and safety

- All project state, artifacts, and renders remain local by default.
- Source videos are immutable; generated files live under `.clipforge/`.
- The dashboard binds to `127.0.0.1`; do not expose it publicly.
- Agent calls are explicit and auditable. Prompts, raw replies, execution traces, and errors are stored locally and may contain private material.
- Rendering is explicit. Suggestions do not auto-approve highlights or create films.

## Known limitations

- Candidate generation is not verified kill/explosion detection.
- AI providers may not inspect frames equally well; model discovery is not an authorization check.
- Browser playback compatibility depends on source codecs.
- Rendering currently expects audio and normalizes output through FFmpeg.
- Default CI should not perform paid or remote AI calls.

License: MIT.
