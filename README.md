# Clipforge

**Turn gameplay recordings into reviewable highlights and editable films, locally.**

Clipforge is a local-first CLI and dashboard for finding moments in gameplay videos, reviewing them, and rendering a final montage. It keeps original recordings untouched and stores project data, cached frames, transcripts, AI traces, and renders in your project folder.

It is designed to help you review footage, not to make unchecked decisions for you. Highlight candidates, sound labels, and AI suggestions always need your review. A final render is created only when you explicitly request it.

> **Start with the dashboard.** After creating a project, run `clipforge dashboard` and open <http://127.0.0.1:4173>. It is the recommended interface for configuring AI, starting analysis, following progress, reviewing highlights, editing a film, and rendering an export.

## Why Clipforge

- **Local by default**: videos, SQLite state, artifacts, and renders stay on your machine.
- **Non-destructive**: source recordings are never modified.
- **Review before export**: trim, approve, reject, arrange, and preview moments before rendering.
- **AI when quality matters**: local analysis works without an account or API key, but AI gives the strongest descriptions and editing suggestions. Every AI run remains explicit and auditable.
- **Inspectable output**: cached frames, transcripts, media signals, and AI artifacts are saved under `.clipforge/`.

## What it does

1. Probes gameplay recordings and samples frames, audio activity, and scene changes.
2. Creates bounded highlight candidates for review.
3. Optionally adds local transcription and rough sound-event labels.
4. Optionally asks a configured AI provider to describe complete actions and suggest edits.
5. Lets you review highlights in a local browser dashboard.
6. Creates an editable film project and renders it with FFmpeg when you choose.

## Requirements

- Node.js **22.16+**
- [FFmpeg](https://ffmpeg.org/) and `ffprobe` available on your `PATH`

Python 3 is needed only for optional local transcription or sound classification. An AI provider is needed only for explicit AI commands.

## Install

Install globally from npm:

```sh
npm install --global clipforge
```

Or run it without a global installation:

```sh
npx clipforge --help
```

### GitHub Packages

The same release is also published to GitHub Packages as `@p-wldz/clipforge`.
Authenticate with a GitHub personal access token that has `read:packages`, then
install it from GitHub's npm registry:

```sh
npm login --scope=@p-wldz --registry=https://npm.pkg.github.com
npm install --global @p-wldz/clipforge
```

Confirm the local dependencies before processing footage. `doctor` only reports what is available: it never installs software or contacts an AI provider.

```sh
clipforge doctor
```

## Quick start: run with AI (recommended)

Local analysis is a useful private baseline, but it only turns media signals into candidates. For better results, run the optional AI stages: they inspect the full clip context, describe complete actions, and select moments that fit your editing brief. Clipforge still requires you to review and approve every suggestion.

Create a workspace and add recordings:

```sh
mkdir my-highlights
clipforge init ./my-highlights --name "Friday squad"

# Copy .mp4, .mkv, .mov, or .webm recordings into ./my-highlights/clips/
clipforge --root ./my-highlights doctor
```

Start the dashboard immediately after creating the workspace:

```sh
clipforge --root ./my-highlights dashboard
```

Open <http://127.0.0.1:4173>. **The dashboard is the recommended way to use Clipforge**: it is the local control center for AI configuration, analysis progress, logs, candidate review, trim adjustments, Film Studio, and explicit rendering. In the dashboard, scan the available providers/models, select and test your AI settings, then start the analysis. Review the proposed moments, adjust their boundaries, approve the ones you want, arrange them in Film Studio, and select **Render** when ready.

`agents` tells you whether a local client is installed. The dashboard can also scan providers and models, but neither detection path proves that your account is authorized. Use the dashboard's connection test before analyzing your recordings.

## Dashboard tour

The dashboard is where a Clipforge project is managed from first scan to final export.

### Project overview

See the project at a glance, start analysis, follow its current status, and open the relevant workspace tools.

![Clipforge Studio project overview](<docs/assets/screens/Clipforge Studio home.png>)

### AI adapters and models

Scan installed clients and available API providers, choose a provider/model for each AI stage, then run a real connection test before analyzing footage.

![Clipforge Studio AI adapters and models](<docs/assets/screens/Clipforge Studio ai models.png>)

### Highlight review

Inspect proposed moments, play them back, adjust their boundaries, and approve or reject them before they reach a film project.

![Clipforge Studio highlight review](<docs/assets/screens/Clipforge Studio highlight.png>)

### Film Studio

Build an editable sequence from selected highlights, refine its order and cuts, preview the result, and render only when you are ready.

![Clipforge Studio Film Studio](<docs/assets/screens/Clipforge Studio montage.png>)

Your workspace remains self-contained:

```text
my-highlights/
  clips/                         original recordings, never modified
  .clipforge/
    config.json                  project configuration
    state.sqlite                 reviews, projects, and run history
    artifacts/<clip-id>/         frames, signals, transcripts, AI traces
    renders/<project-id>/        explicit MP4 exports
```

## Running with AI from the dashboard

AI is recommended when you want Clipforge to produce more useful, context-aware suggestions. It can use sampled frames, optional transcripts and local media signals to identify complete actions, including setup and reaction, before proposing an edit. It is not a replacement for review and does not automatically render anything.

In the dashboard, open **AI adapters & models**, scan the available providers, choose a provider/model for the analysis stages, and run **Test clip analysis AI**. Then return to the project workflow and start analysis. This is the recommended route because setup, progress, errors, raw output, review, and rendering remain visible in one local interface.

The terminal commands below are equivalent options for scripted or terminal-first workflows.

### Installed Codex or Claude client

Sign in to the provider's own CLI first, then use it as the configured provider. Codex example:

```sh
clipforge --root ./my-highlights ai set understanding codex
clipforge --root ./my-highlights ai set editing codex
clipforge --root ./my-highlights ai test understanding
clipforge --root ./my-highlights analyze --agent
```

Replace `codex` with `claude` to use Claude's installed client. For an already configured provider, `clipforge analyze --agent codex` is also a convenient one-command override. Add `--force` only when you intentionally want to reprocess eligible clips; previously approved and rejected highlights are kept.

### OpenAI, Anthropic, or DeepSeek API

Set the provider key in your shell, or place it in a private dotenv-style file outside the workspace. Keys are never written to `.clipforge/config.json`.

```text
# /secure/clipforge.env
OPENAI_API_KEY=your-key
```

Use that file explicitly, discover a model if needed, configure the stages, then make the test call:

```sh
clipforge --env-file /secure/clipforge.env --root ./my-highlights ai models
clipforge --env-file /secure/clipforge.env --root ./my-highlights ai set understanding openai
clipforge --env-file /secure/clipforge.env --root ./my-highlights ai set editing openai
clipforge --env-file /secure/clipforge.env --root ./my-highlights ai test understanding
clipforge --env-file /secure/clipforge.env --root ./my-highlights analyze --agent
```

Use `ANTHROPIC_API_KEY` with `anthropic`, or `DEEPSEEK_API_KEY` with `deepseek`, in the same way. You can append a discovered model ID to `ai set`, for example `ai set understanding openai <model-id>`.

AI commands may send selected frames and analysis metadata to the chosen provider, consume quota, and save their prompt, result, and errors locally for inspection. Clipforge never silently falls back to a provider.

## Fully local analysis

Use the local path when you do not want any external provider call, or simply want to inspect basic candidate signals first:

```sh
clipforge --root ./my-highlights analyze
clipforge --root ./my-highlights dashboard
```

It uses video metadata, sampled frames, audio activity, and scene changes to propose moments. These signals are not verified kills, explosions, or any other gameplay event, so the results are generally less context-aware than the AI workflow.

## Optional local enrichment

Transcription and AudioSet-based sound classification are disabled by default. Preview their setup first:

```sh
clipforge --root ./my-highlights setup --transcription --sound-classifier --dry-run
```

Run the plan only after reviewing it:

```sh
clipforge --root ./my-highlights setup --transcription --sound-classifier --yes
```

Setup uses an isolated Python environment, not global `pip`. It can download local models. Sound labels are rough estimates, not proof of an in-game event.

## Common commands

| Command | Purpose |
| --- | --- |
| `clipforge init [folder]` | Create a project workspace. |
| `clipforge doctor` | Check dependencies without installing or invoking AI. |
| `clipforge analyze [file\|folder]` | Run local analysis and create review candidates. |
| `clipforge dashboard` | Open the local review dashboard on `127.0.0.1`. |
| `clipforge highlights` | List candidate highlights. |
| `clipforge approve <id>` | Approve a reviewed highlight. |
| `clipforge project <name>` | Create a film from approved highlights. |
| `clipforge render <project-id>` | Explicitly render an MP4 export. |
| `clipforge runs` / `clipforge logs [run-id]` | Inspect processing progress and errors. |

For all commands, examples, configuration, and troubleshooting, see the [CLI guide](docs/CLI.md).

The CLI is ideal for setup, automation, and diagnostics. For day-to-day work on a project, start `clipforge dashboard`: it gives you one local place to manage provider settings, run and monitor analysis, inspect logs, review highlights, build a film, and render it.

## Privacy and safety

- The dashboard listens on `127.0.0.1` by default.
- Generated files stay in `.clipforge/`; originals stay unchanged.
- API keys are read from your environment or an explicit `--env-file`, never saved in project configuration.
- `doctor` is diagnostic only. `setup` requires confirmation unless you intentionally pass `--yes`.
- Clipforge never auto-approves suggestions or automatically renders a final film.

## Current limitations

- Candidate generation is a review aid, not reliable gameplay-event detection.
- AI providers may differ in their ability to interpret sampled frames.
- Browser playback depends on the source video's codec support.
- Rendering currently expects source audio and uses FFmpeg to normalize output.

## Development

From a repository checkout:

```sh
npm install
npm run ci
```

See [AGENTS.md](AGENTS.md) for project constraints and [docs/DEVELOPMENT_SANDBOX.md](docs/DEVELOPMENT_SANDBOX.md) for safe local end-to-end testing.

## License

[MIT](LICENSE)
