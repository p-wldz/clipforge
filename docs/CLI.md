# Clipforge CLI guide

Clipforge works fully from the terminal. It stores project state, artifacts, and renders locally under `.clipforge/`; it never modifies source videos.

Use `clipforge` when installed globally, or `node dist/cli.js` from this repository after `npm run build`.

```sh
clipforge help
clipforge --root /path/to/project doctor
```

`--root <workspace>` selects a project workspace. If omitted, the current directory is used. `--env-file <path>` explicitly loads a dotenv-style credentials file; Clipforge never copies that file or its values into the workspace. Run `init` before every command other than `help` or `init`.

## Quick local workflow

```sh
# Create a project and copy recordings into ./clips/
clipforge init ./my-highlights --name "Friday squad" --focus "Funny voice chat and teamwork"

# Inspect requirements; this never installs or invokes an AI provider.
clipforge --root ./my-highlights doctor

# Analyze locally. Candidate highlights are not confirmed game events.
clipforge --root ./my-highlights analyze

# Inspect and approve moments.
clipforge --root ./my-highlights highlights
clipforge --root ./my-highlights approve <highlight-id>

# Create and explicitly render a film from approved highlights.
clipforge --root ./my-highlights project "Squad highlights"
clipforge --root ./my-highlights projects
clipforge --root ./my-highlights render <project-id>
```

## Commands

| Command | What it does | Notes / examples |
| --- | --- | --- |
| `help` | Prints the built-in command summary. | `clipforge help` |
| `init [folder]` | Creates a local workspace. | Supports `--interactive`, `--name`, `--description`, `--focus`, `--clips-dir`, `--frame-interval`, `--audio`, `--transcription`, `--min-duration`, `--max-duration`, and `--require-audio`. |
| `doctor [--json]` | Checks local tooling and configuration. | Read-only: never installs software or invokes an AI. |
| `setup` | Previews or installs optional transcription and sound-classifier tooling. | `clipforge setup --transcription --sound-classifier --dry-run`; use `--yes` only after reviewing the plan. Supports `--interactive`, `--device cpu\|cuda\|auto`, and `--scope project\|user`. |
| `analyze [file\|folder]` | Runs local candidate analysis. | `clipforge analyze`; `--force` reprocesses eligible clips while retaining approved/rejected highlights. Add `--agent codex`, `--agent claude`, or `--agent deepseek` only for an explicit AI run. |
| `dashboard [--port 4173]` | Runs the local web UI at `127.0.0.1`. | Shows a one-line terminal status. Ctrl+C stops dashboard-owned analysis and closes the server. |
| `agents` | Lists detected provider CLIs. | Detection does not prove sign-in or model access. |
| `agent [provider]` | Shows or sets the legacy default provider. | Providers: `none`, `codex`, `claude`, `cursor`, `deepseek`. `cursor` is detectable but cannot analyze clips. |
| `agent test [provider]` | Makes a real provider connection test. | Can consume provider quota. |
| `ai models` | Discovers available provider model IDs. | A model list is not an authorization guarantee. |
| `ai set <stage> <provider> [model]` | Sets a provider/model for an AI stage. | Stages: `understanding`, `contextual`, `editing`, `critical`, `direction`; aliases: `clip`, `montage`. |
| `ai test <stage>` | Makes a real connection test for the stage profile. | Can consume provider quota. |
| `prompts` | Lists project-local editable prompt paths. | `clipforge prompts show montage` prints one prompt. |
| `suggest [provider]` | Produces an editable AI film proposal from stored highlights. | Explicit AI call; choose `codex`, `claude`, or `deepseek`. It does not render or approve anything. |
| `highlights [--json]` | Lists highlight candidates and IDs. | Use the IDs with `approve` or `reject`. |
| `approve <highlight-id>` | Marks one candidate approved. | Approval is required before `project` includes it. |
| `reject <highlight-id>` | Marks one candidate rejected. | Does not alter the source video or analysis artifacts. |
| `project <name>` | Creates a film project from all approved highlights. | `clipforge project "Best squad moments"` |
| `projects` | Lists film projects. | Use the returned project ID with `render`. |
| `render <project-id>` | Explicitly creates an MP4 render. | Outputs below `.clipforge/renders/<project-id>/`. |
| `search <phrase> [--json]` | Searches timestamped local transcripts. | `clipforge search "hold the line"` |
| `skipped [--json]` | Lists clips skipped by pre-analysis filters. | Shows stored reasons rather than silently dropping clips. |
| `runs [--json]` | Lists recent analysis runs. | Useful for seeing status, errors, and run IDs. |
| `logs [run-id]` | Prints pipeline events for a run. | Without an ID, uses the most recent run. |
| `usage [run-id]` | Shows provider-reported usage and labelled estimates. | Estimates are not invoices; account balance changes are not per-run bills. |

## Useful examples

### Analyze one recording without AI

```sh
clipforge --root ./my-highlights analyze ./my-highlights/clips/match-01.mp4
```

### Run an explicit AI analysis

```sh
# Check the provider first, then make the opt-in call.
clipforge --root ./my-highlights agents
clipforge --root ./my-highlights agent test codex
clipforge --root ./my-highlights analyze --agent codex
```

### Configure DeepSeek without storing a key in the project

```sh
# Keep this file outside ./my-highlights and do not commit it.
printf 'DEEPSEEK_API_KEY=your-key-here\n' > /secure/clipforge.env
clipforge --env-file /secure/clipforge.env --root ./my-highlights agent test deepseek
clipforge --env-file /secure/clipforge.env --root ./my-highlights analyze --agent deepseek
```

The file supports `NAME=value`, quoted values, comments, and an optional `export` prefix. A value already set in the shell or CI is never overwritten.

### Review an analysis failure

```sh
clipforge --root ./my-highlights runs
clipforge --root ./my-highlights logs <run-id>
clipforge --root ./my-highlights skipped
```

### Configure optional local speech tools

```sh
# Inspect the exact local installation plan first.
clipforge --root ./my-highlights setup --transcription --dry-run

# Install only after review. This may download a local speech model.
clipforge --root ./my-highlights setup --transcription --yes
```

### Start the dashboard

```sh
clipforge --root ./my-highlights dashboard --port 4173
```

Open `http://127.0.0.1:4173`. The terminal refreshes one line with the current analysis state. Use the dashboard's **Stop analysis** control for dashboard-started work, or press Ctrl+C in this terminal to close the dashboard and cancel its active analysis.

## Safety and limits

- Local heuristic/audio candidates are review suggestions, not verified kills, explosions, or other gameplay events.
- Source recordings are immutable. Generated frames, transcripts, artifacts, SQLite state, and renders stay under `.clipforge/`.
- `doctor` is diagnostic only. `setup` asks for confirmation unless `--yes` is explicitly supplied.
- AI commands (`agent test`, `ai test`, `analyze --agent`, and `suggest`) may send the configured inputs to that provider and consume quota.
- Clipforge never auto-approves candidates or automatically renders a final film.
