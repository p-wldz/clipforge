## v0.15.0: film suggestion regeneration, transitions and safe cleanup

- **Regeneration prompt:** edit `.clipforge/prompts/film-regeneration.md` under Project Settings → AI prompts. When a previous suggestion exists, the next generation includes that prompt, the previous film suggestion, and optional user notes from the Overview textarea. The exact assembled prompt is saved with the generation artifacts.
- **Suggestion effects:** Film Studio displays every AI-suggested highlight with a validated, **predefined** incoming FFmpeg transition and duration. Modify the transitions, choose **Save effects**, then **Create film from suggestion** to copy the saved edits into a normal editable montage. The first scene always starts with a hard cut. The browser preview uses cuts; crossfades and other effects appear in the MP4 render.
- **Film library cleanup:** select multiple saved film drafts in Film Studio and press **Delete selected films**. Confirmation is required; this removes the selected montage projects and generated render directories but **never** the original clips, detected highlights or transcriptions.
- **Usage, not Billing:** the dashboard focuses on reported token/image usage and provider-reported charges only. The manual price catalog is no longer exposed in the main UI.
- **Progress:** the Regenerate button stays busy while the background AI job runs, including after a dashboard refresh. Save effects and create-draft actions show their own loading state; errors are shown instead of silently clearing the spinner.
- **Existing workspaces:** existing prompts remain unchanged. The new regeneration prompt is created on first use, without overwriting user files. No project reinitialization is needed.

## v0.13.0: AI adapters, run usage, timeline speed

- **AI adapters** is now a dedicated dashboard view. It checks installed Codex, Claude Code and Cursor CLIs, displays discovered model IDs (when CLI discovery succeeds), and allows a model override for clip analysis and film suggestion. Codex model discovery uses `codex debug models` (experimental and not guaranteed); Claude uses `claude models` if supported. An empty model list does not mean the provider is unusable. Verify model access using **Test clip analysis AI**.
- **Provider usage** uses Codex CLI `exec --json` `turn.completed.usage` and Claude Code `--output-format json` `usage`. Claude may additionally report `total_cost_usd`; this figure is stored separately. The API-equivalent estimator uses configured prices and is **not billed cost**, especially on subscription plans. Neither provider exposes universal reliable per-Clipforge-run invoice data through their public account API.
- **Speed per montage segment**: 0.25x–4x in Film Studio, persisted independently from original highlight trims. Preview uses browser `playbackRate`, export uses FFmpeg `setpts` and chained `atempo`. Duration in the editor reflects speed.
- **Persistent analysis banner**: visible above all dashboard pages while analysis is running, showing the current stage and processed count. Technical logs remain hidden by default.

### Update an existing development checkout

```powershell
npm install
npm run build
npm test
npm link
```

Keep the `.clipforge` sandbox folder. Existing project items are migrated lazily to add speed with default 1.0. Run `clipforge dashboard` and navigate to AI adapters or Film Studio.

# Clipforge Local

Local-first Node.js pipeline for gameplay clips, with optional Codex/Claude agents and a built-in review dashboard. **This is an MVP, not a production-quality gameplay event detector.** It uses audio activity to propose moments, then requires review. No cloud service, API key or LLM is needed for the default workflow.

## Cross-platform dependency setup (v0.7)

Clipforge does **not** install dependencies as an npm postinstall script. After creating a workspace, run:

```sh
clipforge doctor
clipforge setup --transcription --sound-classifier --dry-run
clipforge setup --transcription --sound-classifier
# for CI or when approval has already been granted:
clipforge setup --transcription --yes
```

`setup` detects missing FFmpeg/ffprobe and suggests the available OS package manager: winget, Chocolatey, Scoop (Windows); Homebrew (macOS); apt, dnf, pacman, zypper, apk (Linux). It lists commands and asks for explicit permission before executing anything. Python 3 is required for local speech recognition. If detected, the installer creates a project-specific Python virtual environment under `.clipforge/tools/python`, installs `faster-whisper` with pip, verifies it, and updates `.clipforge/config.json` to use that interpreter. Already installed components are skipped. A virtual environment does not require activation.

If Python is missing, setup provides a warning rather than silently installing a global Python runtime. Linux Python installations need the platform's `venv` package if absent. System installation can require elevated privileges; verify the printed commands. Reopen your terminal after system package installation if its PATH has not refreshed. `--dry-run` never installs. Only use `--yes` if you have reviewed the commands. Network access is needed to fetch dependencies and the first Whisper model.

## Local sound event classifier (v0.7)

From the project workspace:

```sh
clipforge setup
# Answer Y to speech transcription, Y to sound effects classification.
# Or use explicit flags for a scripted plan:
clipforge setup --sound-classifier --dry-run
clipforge setup --sound-classifier --yes
clipforge doctor
clipforge analyze ./clips --force
clipforge dashboard
```

The optional local classifier is the Audio Spectrogram Transformer (AST) trained on AudioSet (`MIT/ast-finetuned-audioset-10-10-0.4593`). Setup installs **CPU-only** PyTorch/torchaudio and Transformers into `.clipforge/tools/sound-classifier`, independent from Whisper's environment. It downloads the model and runs a synthetic-inference smoke test before writing `soundClassifier.enabled: true` to the workspace config. The model's safetensors weights are about 346 MB; dependencies require additional disk space and network access. First-time setup can be substantial. A Python 3 runtime compatible with current PyTorch is required (prefer 3.11 or 3.12). GPU classification is not implemented yet.

During analysis, FFmpeg extracts temporary 16 kHz mono PCM audio. The local model labels overlapping time windows, storing `sound-events.json` alongside audio peaks and transcripts. The dashboard shows estimated event labels and confidence, and the selection pipeline uses these windows when proposing highlight candidates. **These are rough multi-label predictions, not confirmed explosions, kills, or precise timestamps.** No model is downloaded when classification is disabled. Re-run `analyze --force` after enabling it. `clipforge doctor` verifies dependencies but does not repeat the costly model inference.

Configuration can be changed in the dashboard under workspace settings, but enabling classification still requires successful `clipforge setup --sound-classifier` first.

## Requirements
- Node.js >= 22.13 (the project uses Node's built-in `node:sqlite`, experimental in Node 22)
- npm
- FFmpeg and ffprobe on PATH
- Optional: Codex CLI or Claude Code CLI, authenticated independently
- Optional: external `whisper` CLI, configured in `.clipforge/config.json`

## Install as a library / CLI

The repository is prepared for an npm package with a `clipforge` executable, but **it has not been published to npm**. After cloning, run `npm install && npm run build && npm link` to expose `clipforge` locally. From another directory, the packaged build can be tested with `npm pack` and `npm install <generated-tgz>`.

## Interactive project initialization

```bash
mkdir my-hll-project && cd my-hll-project
clipforge init --interactive
```

The wizard asks for project name, description, creative focus, audio presence, clips directory, screenshot interval and optional transcription. For automation:

```bash
clipforge init --name "HLL funny clips" --description "Our weekly montage" --focus "Funny moments, explosions, squad voice chat" --clips-dir recordings --frame-interval 2 --audio yes --transcription no
clipforge agents
clipforge doctor
clipforge analyze --agent codex
clipforge dashboard
```

You can edit `.clipforge/context.md` to refine the creative brief for subsequent analysis. Agent choice can also be specified as `--agent claude`. Cursor CLI is detectable, but does not yet have a working analysis adapter.

## Install and try

```bash
node dist/cli.js init
node dist/cli.js doctor
# Add .mp4 clips into ./clips, then:
node dist/cli.js analyze ./clips
node dist/cli.js dashboard
# Open http://127.0.0.1:4173
```

The ZIP includes precompiled `dist/`, so these basic commands work without `npm install`. For development, install dependencies with `npm install`, then rebuild using `npm run build`.

### CLI from source

```bash
npm run dev -- init
npm run dev -- doctor
npm run dev -- analyze ./clips
npm run dev -- highlights --json
npm run dev -- dashboard
```

### Review and export
In dashboard, select a candidate, adjust seconds, and approve. Click **Create montage from approved**, then **Render MP4**. The output is `.clipforge/renders/<projectId>/final.mp4`. Alternatively:

```bash
node dist/cli.js highlights --json
node dist/cli.js approve <highlight-id>
node dist/cli.js project "My gameplay compilation"
node dist/cli.js projects
node dist/cli.js render <project-id>
```

### Connect Codex or Claude
Select the provider with `node dist/cli.js agent codex` or `node dist/cli.js agent claude`, or edit `.clipforge/config.json`:

```json
"agent": { "provider": "codex" }
```

Choices: `none` (default), `codex`, `claude`, `cursor` (detected only, analysis adapter not implemented). Then explicitly run:

```bash
node dist/cli.js analyze ./clips --agent --force
```

`--agent` alone never installs anything. Provider processes are invoked with argument arrays and timeouts, not shell commands. Codex attaches selected JPEGs using `--image`; Claude currently sees frame paths and metadata, so image understanding depends on the tools and permissions available to that Claude Code session. The agent may use plan/model quotas. For reliable video understanding, add a dedicated vision model adapter in a follow-up milestone.

### Transcription
Disabled by default. Set `transcription.enabled=true` and configure its executable and argument list. The default example expects an OpenAI Whisper-style CLI that writes `<source-name>.json` into `{outputDir}`. `doctor` checks that configured executable; it does not install or run transcription. Different CLI variants require different arguments and output adapters.

## Data and privacy
- `.clipforge/state.sqlite` contains index, candidate and approval data.
- `.clipforge/artifacts/` contains metadata, sampled frames and analysis output.
- `.clipforge/renders/` contains generated video.
- Original files are never overwritten.
- Dashboard binds localhost, with **no login**. Do not expose it on a network.
- Agent calls can transfer clip metadata and selected frames to the configured provider, only when `--agent` is specified.

## Development
See [docs/DEVELOPMENT_SANDBOX.md](docs/DEVELOPMENT_SANDBOX.md) and [docs/PROJECT_WORKSPACE.md](docs/PROJECT_WORKSPACE.md). Start with [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTRACTS.md](docs/CONTRACTS.md), and [docs/ROADMAP.md](docs/ROADMAP.md). Codex skills live under `.agents/skills`; Claude equivalents under `.claude/skills`.

```bash
npm run typecheck
npm test
npm run build
```

## Known constraints
- Audio-activity heuristics cannot identify kills, tank destruction or humor. Results remain candidates, not verified events.
- Browser playback of MKV/MOV/WebM depends on codec support; processing/rendering still uses FFmpeg.
- `--force` regenerates candidates but does not delete previous versions or their approvals.
- The pipeline currently runs sequentially; no background queue or job progress persistence.
- Rendering assumes audio is present in every source, and normalizes video to 720p H.264. Audio-less source support is a roadmap item.
- Node 22's `node:sqlite` may show an ExperimentalWarning. It can be replaced with a stable SQLite binding later.

License: MIT.


## Clip filters and searchable transcripts (v0.3)

Create a local workspace with a 60-second maximum (the default), or customize it:

```sh
clipforge init ./my-project --name "HLL funny moments" --description "My gaming highlights" --focus "Explosions and funny conversations" --clips-dir recordings --frame-interval 2 --max-duration 45 --min-duration 4 --require-audio no --transcription yes
```

`--max-duration 0` means unlimited. To change an existing project, edit `.clipforge/config.json`:

```json
"analysis": {
  "minDurationSeconds": 4,
  "maxDurationSeconds": 45,
  "requireAudio": false,
  "frameIntervalSeconds": 2
}
```

Filtering runs **after ffprobe and before all expensive stages**. Files skipped for length or missing audio are recorded in SQLite (`clip_scans`) and visible with `clipforge skipped --json`. Source media is never modified. Set `--force` on analysis to reconsider already indexed files after adjusting settings.

### Local transcription

Transcription is opt-in. The default adapter executes the open-source **OpenAI Whisper CLI** (`whisper`) to produce timestamped JSON. This is free to run locally but requires Python, the Whisper package, FFmpeg, and model downloads (no cloud API bill). Example installation via a Python virtual environment:

```sh
python -m venv .venv
# Activate the virtual environment using your platform's activation script.
python -m pip install -U openai-whisper
whisper --help
```

Ensure `whisper` is on PATH, or configure `.clipforge/config.json` `transcription.command` to its executable path. With `transcription.enabled=true`, the pipeline runs Whisper and saves `transcript.json` under `.clipforge/artifacts/<clip-id>/`. Speech segments are also indexed in local SQLite with `start`, `end`, and `text`.

```sh
clipforge analyze ./recordings
clipforge search "tank behind us" --json
clipforge dashboard
```

The dashboard includes a timestamped transcript search. At present it is a case-insensitive substring search, **not semantic search** or a robust speech-to-action classifier. Speech recognition quality varies with voice chat, background effects and music. For faster local inference, `faster-whisper` is a good future provider, but it is not bundled in this release.

### Explosion detection

The audio stage currently finds **non-silent windows** using FFmpeg. It does **not** accurately classify explosions. An optional audio-event plugin could later analyze transient characteristics or use a trained sound-event classifier (e.g. an AudioSet-based classifier), with a separate confidence field for explosions vs gunfire/voice. Do not label generic loud audio as a verified explosion.

## New in v0.4: local audio-first analysis

Clipforge now runs a deterministic audio signal pass before proposing highlights:

- `audio-signals.json` contains 100 ms RMS / peak dBFS levels, sudden intensity changes (`loud_impulse`) and long intense passages (`sustained_loud_activity`). **These are not semantic sound classifications**. Loud sounds may be speech, gunshots, music or explosions. The dashboard displays detected impulses for navigation.
- Local speech transcription via [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Install Python and then run `python -m pip install faster-whisper`, select **faster-whisper** in `.clipforge/config.json` (`transcription.provider`) and set `transcription.enabled=true`. The `transcription.command` field chooses the Python interpreter (`python` or e.g. an absolute virtualenv executable). `transcription.model` defaults to `small`. The first run downloads a model and may require network access. Subsequent runs can be local.
- Both audio and transcript intervals contribute to suggested highlight windows. The transcript is saved with word/segment timestamps and indexed in the local SQLite store.
- Dashboard **Edit settings** can modify project description, focus, screenshot interval, video filters, transcription options, and the full `context.md` creative brief. Save before re-running `clipforge analyze ./clips --force` to recompute already indexed videos.

Not implemented: semantic classification of explosions/bombardment, source separation between game voice and effects, nor a live analysis job control from the dashboard. YAMNet or CLAP integration is a recommended next experiment; validate against labeled Hell Let Loose audio before treating classes as trustworthy.

### Upgrade note from v0.3
Unpack this source release separately, build and re-link (`npm install && npm run build && npm link`). Keep your existing external sandbox intact. Existing `.clipforge/config.json` files without `transcription.provider` are supported. If your project used `whisper` CLI previously, it continues in `whisper-cli` mode until you explicitly switch to `faster-whisper`.

Example settings for local transcription:

```json
"transcription": {
  "enabled": true,
  "provider": "faster-whisper",
  "model": "small",
  "command": "python",
  "args": []
}
```

The **Edit settings** dashboard panel also includes the editable `workflow.json`. Editing its step list documents the desired workflow, but does not yet dynamically change the compiled Node pipeline's execution graph. The human-review requirement is enforced.


## Interactive dependency setup (v0.6)

Run `clipforge setup` inside an initialized project. The wizard asks whether to enable local
speech transcription, displays exactly what will be installed and requests consent.
`clipforge setup --transcription --yes` is available for automation, and
`clipforge setup --transcription --dry-run` is read-only.

When transcription is selected, setup creates/reuses `.clipforge/tools/python`, installs
compatible `faster-whisper==1.2.1` and `av==18.1.0`, runs a real short inference
smoke test using the `tiny` model, and saves a verified device (`cuda` if working,
otherwise `cpu`) to `.clipforge/config.json`. On an NVIDIA system, testing GPU
requires working CUDA 12/cuDNN libraries. Missing GPU runtime causes a CPU fallback,
not a broken enabled transcription configuration. CPU uses int8; CUDA uses float16.
This initial smoke test downloads the small `tiny` test model when not cached;
normal transcription uses the configured model (default `small`) which may download
on first use. A smoke test on silent generated audio validates runtime dependencies,
not recognition accuracy. Setup requires Python 3 already installed and network access
for package/model downloads. `--device cpu` skips CUDA checks, `--device auto` is the
default. `--device cuda` attempts CUDA and falls back to CPU if unavailable.

## v0.8: Full-clip AI understanding and observable runs

Run `clipforge analyze ./clips --agent codex --force` to ask Codex for **one full-clip analysis** (summary, event story and highlight cuts) after local audio, transcription and screenshot extraction. Claude Code works with `--agent claude`. Agent invocation is explicit and may consume usage limits.

A successful AI response replaces the heuristic suggestions for the clip. If the agent fails or returns invalid JSON, the existing candidate selection remains tagged `origin: heuristic`. The error is **persisted** and visible in the dashboard instead of being silently discarded. `--force` deletes old *pending* suggestions for the clip; previously approved and rejected suggestions are retained.

`clipforge runs` lists analysis job statuses and per-clip progress. `clipforge logs` prints the most recent run's timestamped steps, or `clipforge logs <run-id>` for a specific run. The dashboard polls the same local SQLite DB every two seconds under **Pipeline progress and agent logs**, including jobs started from another terminal. In the highlight preview, **Whole clip AI analysis** displays the clip summary, story segments, status and an expandable raw agent response/debug view.

Logs and per-clip agent artifacts are stored under `.clipforge/artifacts/<clip-id>/ai/` (`prompt.txt`, `response.txt`, `stdout.log`, `stderr.log`, `trace.json` and `error.txt` if applicable). These may contain speech, local file paths or project context; keep `.clipforge` private. No automatic network publishing is performed.

The pipeline feeds sampled full-clip screenshots to the agent, together with transcripts and sound-event predictions. It does **not** send the entire video. AI-generated descriptions and scores require human review and may be inaccurate. The local audio and transcription setup is unchanged.

## AI prompts, connection testing and video proposals (v0.9)

Project-specific, editable prompts live in `.clipforge/prompts/`:

- `clip-analysis.md`: interpret each whole clip from transcripts, sound estimates and screenshots.
- `montage.md`: propose the **final film** from saved AI highlight candidates, including title, description, hook, ordered sequence and ending.
- `agent-test.md`: tiny real AI connectivity probe.

Files are created during `clipforge init` or on first access. Editing existing prompts does **not** get overwritten on reinitialization. You may edit these files directly or via the dashboard **AI prompts and connectivity** panel.

```bash
clipforge prompts
clipforge prompts show clip-analysis
clipforge agent test codex
clipforge agent test claude
clipforge analyze ./clips --agent codex --force
clipforge suggest codex
clipforge dashboard
```

`clipforge agent test` uses a **real paid/quota-limited CLI invocation**, verifies a JSON response and saves the result to `.clipforge/agent-tests/latest.json`; do not confuse it with CLI installation detection. Run the command from the **sandbox project directory**. It does not start the Codex interactive UI: it uses `codex exec` and passes prompts through stdin. The installed CLI must already be authenticated. Test failures are reported without silently returning success.

After a completed agent-powered batch, Clipforge makes a second AI call to propose a full film. The latest proposal is in `.clipforge/projects/suggestions/latest.json`; the original prompt and response are also preserved. Proposals are **non-destructive** and do not approve or render clips. `clipforge suggest codex` regenerates the proposal using already saved highlights and summaries without retranscribing media. Only IDs present in the source candidate set are accepted.

**Important:** Prompt edits affect subsequent calls, not prior analyses. Output format requirements remain enforced by code; editors should change creative guidance rather than expecting arbitrary output schemas. The agent test checks connectivity and JSON formatting, not whether the provider actually understands game footage. Cursor is visible in configuration but does not yet have a supported non-interactive analysis adapter.


## v0.10: Dashboard workflow and per-stage AI models

Start the dashboard using `clipforge dashboard` and open `http://127.0.0.1:4173`.

- **Analyze clips**: select Codex, Claude or heuristic analysis, optionally re-analyze existing clips, then click **Start analysis**. The dashboard polls the SQLite-backed run timeline every 2 seconds. It also shows analysis started from the CLI.
- **Suggested movie**: click **Generate suggestion** after analyzing clips. The suggested highlights are editable: check/uncheck, move up/down, edit film title, then click **Create video from suggestion**. The resulting video is rendered with FFmpeg and offered as an MP4 download. Rendering never changes review decisions.
- **AI configuration, models and prompts**: open the collapsed panel, click **Scan installed CLIs**, and set independent providers and model IDs for **Clip analysis** and **Movie suggestion**. Only installed CLI availability and models advertised by the tools or already saved are shown; remote catalogs cannot be assumed complete. Leave the model field empty to use the agent CLI default. Cursor is shown as detected but unsupported as an analysis adapter.
- **Pipeline activity and detailed logs**: collapsed by default. Workspace configuration and prompts remain editable in dedicated panels.

CLI equivalents:

```bash
clipforge ai models
clipforge ai set clip codex
clipforge ai set montage claude claude-sonnet-4-5
clipforge ai test clip
clipforge analyze ./clips --agent --force
clipforge suggest
```

Stage profiles are saved in `.clipforge/config.json` under `aiStages` and are optional for older workspaces. If absent, the legacy `agent` settings are used. This release does not install agents or authenticate them; use `clipforge agent test codex` to verify connectivity before running analyses. On Windows, some providers' model-discovery subcommands may be unavailable. You can always enter a model ID manually.

**Local security:** the dashboard listens on loopback by default and should not be exposed to an untrusted network. AI-generated suggestions are untrusted proposals, and source clips remain unmodified.

## Clipforge Studio v0.11.0

The dashboard is organized around four views: **Overview**, **Highlights**, **Film studio**, and **Project settings**. Technical diagnostics and prompt editing are intentionally collapsed by default.

### Creative workflow

1. Run `clipforge dashboard` in your initialized clips workspace and select **Overview → Start analysis**.
2. In **Project settings**, edit the project name, description, priorities, and `.clipforge/context.md` creative brief. Edits are saved in the project, never the installed package.
3. In **Highlights**, review the source clip and the AI description, adjust the highlight start/end, approve/reject, or add it directly to a movie. The original media is never modified.
4. In **Film studio**, create a film from **any** analyzed highlights, or use **Create draft from AI suggestion** as an initial draft. The AI suggestion is optional and never auto-renders.
5. Reorder the editable timeline, adjust **In**/**Out** for each cut, and **Save draft**. These montage cuts are independent of each source highlight's review start/end values.
6. Click **Preview sequence** to play the cuts sequentially in the browser. This is a client-side seek-and-switch preview, with possible brief gaps between source files; it is not an encoded final movie.
7. Click **Export MP4** to run FFmpeg and download the result. Video encoding is only performed on explicit request.

The SQLite schema adds nullable `project_items.start_override` / `end_override` fields and `project_editor_metadata`. Migration is additive when older projects are opened. Source highlights and original clips are preserved. Rendered output uses montage-specific cut points.

### Editable prompt layers

Prompt files are initialized in `.clipforge/prompts/` and can be edited from **Project settings → AI prompts by stage**:

- `clip-analysis.md`: understand the whole clip and its timeline.
- `highlight-selection.md`: how to choose and justify cut points and scores.
- `montage.md`: choose a shortlist and order for a movie suggestion.
- `film-direction.md`: title, narrative arc, opening and ending.
- `agent-test.md`: connectivity smoke test.

The selection and direction prompts are **additional instructions inside the existing clip and montage LLM calls**, not additional model invocations. Pipeline stages such as FFmpeg, Whisper and AST remain deterministic and do not have LLM prompts.

### Installation scopes

**Install the Clipforge CLI globally** with `npm install -g clipforge-local` after it has been published to npm, or from the local package archive with `npm install -g ./clipforge-local-0.11.0.tgz`. For project-local installation, use `npm install -D <path-to-clipforge-local-0.11.0.tgz>` and `npx clipforge`. During active library development, use `npm link` and `npm run build` in the library folder; the clips sandbox remains separate.

The Python environments have their **own independent scope**:

```bash
clipforge setup --transcription --sound-classifier --scope project
# stores Python venvs under PROJECT/.clipforge/tools

clipforge setup --transcription --sound-classifier --scope user
# stores shared Python venvs under ~/.clipforge/tools (Windows: %USERPROFILE%\.clipforge\tools)
```

User-scope installation is a **shared, isolated per-user virtual environment**, not an installation into system-wide Python site-packages. This avoids overwriting other Python packages and works without administrative rights. Models may still use the respective provider's user-level cache. All project-specific prompts, context, SQLite data, highlights and montage drafts remain inside the project `.clipforge/` directory. Switching scope for an existing project requires rerunning setup for the enabled components so the configured executable paths are updated.

### Known limitations

- Browser preview uses source file switching and time seeking, not frame-accurate encoded transitions. Browser support for MKV varies; MP4/H.264 is the reliable preview input. The exported video is the ground truth.
- There is no visual drag-and-drop or transition animation editor yet, only move-up/down ordering and cut fields.
- AI agents/model discovery is best-effort. The user can enter a supported model ID; not all CLIs provide a complete model enumeration API. Cursor is not yet a functional analysis adapter.
- LLM scores and event descriptions are estimates and must be reviewed, especially for effects misclassified by AST.
- The per-project Python and shared-user Python execution paths are implemented, but real installation and rendering should be verified on each target OS.


## AI usage, pricing and screenshot optimization (v0.12)

`clipforge usage` shows token counts for the most recent run; `clipforge usage <run-id>` shows a specific run. The dashboard Overview shows the same summary after AI calls, with per-stage detail hidden by default. The `api/ai/usage?runId=...` endpoint is available locally.

* Codex: token usage is parsed from `codex exec --json` completion events, including cached input.
* Claude: token usage is parsed from the JSON result of `claude -p --output-format json`; Claude reports cache reads separately, which are normalized to total input.
* Other providers: extend the agent adapter and usage parser; unknown pricing is never invented.
* Film suggestion usage is included in run totals when the suggestion was part of the analysis run. Standalone suggestions are recorded without a run ID.
* Prices are **user-maintained** in Project settings → API pricing estimates, in `.clipforge/config.json`. Rates are USD per 1M tokens, keyed by provider and exact model ID. Only one published example price is prefilled. Model defaults with unknown exact IDs are not priced. An API-equivalent estimate is not necessarily the amount billed on a Codex/Claude subscription.
* Images are extracted as resized JPEGs. `analysis.frameIntervalSeconds` controls extraction; `analysis.maxImagesPerClip` controls how many images the agent receives (default 8); `analysis.imageMaxWidth` controls JPEG width (default 640). Frame selection includes beginning/end, sound/speech events and gaps across the timeline. It is heuristic and does not replace a local vision model.

The image count and image size affect model input usage, but **CLI token reports** are the best available way to estimate input cost. They may not itemize image tokens. Local Whisper/AST use zero paid API calls but consume CPU/GPU resources that are not tracked as a monetary cost.


## DeepSeek API adapter

DeepSeek is a provider alongside Codex and Claude. It calls the official API, not a local CLI, and requires a separate prepaid API key. Set `DEEPSEEK_API_KEY` in the terminal that launches Clipforge (or your OS user environment), then open **AI adapters & models** and select DeepSeek for Clip analysis or Movie suggestion. `deepseek-flash` supports screenshots; `deepseek-v4-pro` is text-only and appropriate for Movie suggestion. Models are discovered from `GET https://api.deepseek.com/models` if the key is available. Never put your key into `config.json`, `context.md`, prompts or git.

PowerShell example: `$env:DEEPSEEK_API_KEY='YOUR_KEY'` then `clipforge ai models`, `clipforge ai set clip deepseek deepseek-flash`, `clipforge ai test clip`. API usage includes input/output/cache tokens and is logged per analysis call. Default DeepSeek price catalog uses **off-peak** published rates; peak-time billing is higher, so estimates can differ from actual charges.


## v0.14.0: Resilient analysis, official billing observations and real model catalogs

- AST no longer attempts to process a trailing sound window smaller than the 400 samples required by Kaldi fbank. No Python environment reset is needed.
- Sound-classifier, transcription and basic audio analysis are optional independent steps: failures become warnings. A broken input file is recorded and skipped, and subsequent clips continue. Run status is `completed_with_warnings` when anything was skipped or degraded. See `clipforge logs` and `.clipforge/artifacts/<clip-id>/stage-errors.json`.
- Model dropdowns in **AI adapters** now use live provider catalogs instead of free-form model input. Codex discovers `model/list` via app-server, DeepSeek uses `GET /models`, Claude uses an available CLI list or `GET /v1/models` with `ANTHROPIC_API_KEY`. **Model lists are not guarantees of subscription access.** Use **Test AI** before a large run. A provider default remains available when a CLI model catalog is inaccessible.
- `clipforge billing [openai|anthropic|deepseek|all]` and Overview -> **Official provider billing** offer official read-only account data. `OPENAI_ADMIN_KEY` (or `OPENAI_ADMIN_API_KEY`) enables OpenAI's **daily organization** API-cost totals; `ANTHROPIC_ADMIN_KEY` enables Anthropic's organization cost analytics (requires relevant permissions); `DEEPSEEK_API_KEY` enables DeepSeek's **live account balance**. All keys are read from environment variables and are never saved to project files.
- For runs that invoke DeepSeek, Clipforge records account balances before and after processing when accessible, with original currencies. **These are account-wide changes**, potentially influenced by other users, jobs, top-ups or billing delays. They must not be presented as invoiced per-run cost.
- `clipforge usage [run-id]` still records provider-reported tokens and Claude CLI's `total_cost_usd` separately from optional API pricing estimates. Consumer subscriptions, including ChatGPT Plus via Codex CLI, do **not** expose guaranteed billable USD amounts per Clipforge run through these interfaces. A report saying `unavailable` is more accurate than an invented USD amount.

### Updating an existing development checkout

Unpack v0.14.0 over your library sources, but keep the sandbox (`.clipforge` directory) intact.

```powershell
cd P:\projects\clipforge
npm install
npm run build
npm test
npm link
cd P:\sandobxes\hll
clipforge analyze ./clips --agent codex --force
clipforge usage
clipforge billing deepseek
clipforge dashboard
```

Offline unit/integration tests use mock CLI/API responses and synthetic FFmpeg media. Live authenticated model selection, provider billing endpoints and AST inference on Windows still require testing on the target machine.
