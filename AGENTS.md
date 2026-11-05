# Clipforge: agent engineering context

Read this file before modifying code. Refer to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CONTRACTS.md](docs/CONTRACTS.md), and [docs/ROADMAP.md](docs/ROADMAP.md), [docs/PROJECT_WORKSPACE.md](docs/PROJECT_WORKSPACE.md), and [docs/DEVELOPMENT_SANDBOX.md](docs/DEVELOPMENT_SANDBOX.md).

## Purpose
Local-first, agent-optional video highlight pipeline. Source gameplay recordings are immutable. The CLI and HTTP dashboard are first-class consumers of the same SQLite/filesystem-backed core.

## Non-negotiable rules
- Local storage only by default: `.clipforge/state.sqlite`, `.clipforge/artifacts/`, `.clipforge/renders/`.
- Never upload clips, audio, or screenshots unless an explicit provider run is requested.
- Never invoke an agent from `doctor`, `init`, or ordinary default analysis.
- Never install system software without explicit user approval. `doctor` only checks.
- Never fabricate game events from audio spikes or isolated frames. Heuristic proposals are labeled as candidates.
- Avoid shell interpolation; use `spawn(command, args)` with safe argument arrays.
- No original file modifications. No implicit agent fallback. No automatic final render.
- UI must default to 127.0.0.1 (not publicly exposed). Preserve range-based video streaming.
- Keep artifacts inspectable: use JSON files and stable IDs. Add schema migrations for database changes.
- Add automated tests when changing intervals, cut behavior, agent parsing, or security.

## Typical development
`npm install && npm run typecheck && npm test && npm run build`
`npm run dev -- init --interactive` then `npm run dev -- doctor`. For isolated E2E tests, follow docs/DEVELOPMENT_SANDBOX.md.

## Where to work
- `src/core/`: config, paths, SQLite, subprocess safety, checks.
- `src/pipeline/`: metadata, extraction, candidate generation, external STT, render.
- `src/agents/`: optional agent adapters.
- `src/dashboard/`: static dashboard served by native Node HTTP.
- `tests/`: behavioral tests.

## Current MVP limitations
- Candidate selection is based on coarse audio activity, NOT reliable kill detection.
- Transcription is optional external CLI; no STT binary is automatically installed. Free local options include open-source faster-whisper and whisper.cpp with an adapter.
- Agent evaluation is explicit via `analyze --agent`; Cursor is detectable but not implemented as an analysis adapter. Codex gets frame attachments; Claude is fed frame paths in text and may require extra permissions to inspect images.
- Model cost, tool authentication, and per-provider limits belong to the user's environment.
- Dashboard is intentionally dependency-free rather than React, to keep local setup minimal.

## Definition of done
Typecheck, tests, build; manual 5-second synthetic video test; docs updated. Stop and report any unsupported platform-specific behavior.


## Filtering and transcription contracts
- Probe videos before consuming CPU/API tokens, applying `analysis.minDurationSeconds`, `maxDurationSeconds` (null = unlimited), and `requireAudio`.
- Persist reasons for skipped clips in `clip_scans`; never silently discard source files.
- Keep original media immutable and generated artifacts local to `.clipforge`.
- Transcript segments must preserve start/end and raw recognized speech; do not equate a spoken mention of an explosion with a visually verified explosion.
- Local whisper is optional; if not installed, report the missing dependency instead of fabricating transcript data.
- Transcript discovery is local SQLite FTS only; update its index atomically whenever transcript segments are replaced, and never surface obsolete segments in normal results.
- Ratings, feedback, favorites, and missed moments are user-owned annotations. Keep them separate from generated highlights and preserve them across AI reanalysis.

## Audio-first pipeline (v0.4)
- `src/pipeline/audio-signals.ts` extracts mono PCM with FFmpeg, computes 100 ms loudness/peaks, and emits **generic sound impulses**. Never present these as proven explosion/gunshot labels.
- `tools/transcribe_faster_whisper.py` is a Python worker, called by the Node.js transcription adapter. Python and the model must be explicitly installed by the user. Never automatically download large models without informing the user.
- `.clipforge/artifacts/<clipId>/audio-signals.json` and `transcript.json` are reviewable artifacts. Keep source files untouched, retain provenance and timestamps.
- Dashboard settings route is local only. Validate all new config fields on server side. Changes to configuration do not automatically invalidate existing analysis: re-run `analyze --force`.
- Next priority: locally validate YAMNet or CLAP on game sound effect examples, add temporal alignment and show labeled events with evidence and confidence.

## Dependency setup (v0.5)
- `clipforge doctor` only diagnoses and must never install anything.
- `clipforge setup --transcription --dry-run` previews any missing FFmpeg and local speech dependencies.
- `clipforge setup --transcription` requires explicit confirmation before installing; `--yes` is for intentional noninteractive use.
- System FFmpeg is installed through detected package managers. Python transcription dependencies are installed in an isolated workspace venv, never global pip.
- Do not add installation side effects to npm `postinstall`, project `init`, dashboard startup, or ordinary analysis.
- Package installation is not controlled by an LLM and must use argument arrays without shell interpolation.

## Audio sound-event classification (v0.7)
- Workspace setup can install the optional AST AudioSet classifier with `clipforge setup --sound-classifier`. It runs in an isolated `.clipforge/tools/sound-classifier` Python venv, independent of faster-whisper.
- The model uses CPU PyTorch and its predictions are rough multi-label labels for overlapping windows, not ground-truth game events or exact action boundaries.
- Do not label generic loudness peaks as explosions. Do not treat an AudioSet prediction alone as confirmation of a player kill.
- Preserve `sound-events.json` artifacts and expose them through the dashboard. Keep inference disabled unless the user explicitly enables it through setup.
- For new providers, retain the stable event schema `{start,end,label,confidence,provider}` and explicit smoke-test-before-enabling behavior.

## Analysis observability (v0.8)
- The pipeline writes `analysis_runs`, `analysis_events`, and `clip_analyses` into workspace-local SQLite. Every stage must record a progress event; errors must be visible, not swallowed silently.
- The agent should analyze the **full clip context** (selected frames across the clip, transcription, audio events, project instructions) before generating highlight intervals. `origin=heuristic` means no valid AI interpretation was applied.
- Per-clip agent artifacts in `.clipforge/artifacts/<clip-id>/ai/` preserve prompt, raw reply, stdout, stderr, execution trace and errors. Treat this as potentially private user data.
- Test parsers against invalid timestamps, and test run logging independently of a network-connected agent. `clipforge runs` and `clipforge logs` are diagnostic interfaces.
- Do not erase existing approved/rejected clips during `--force`. Do not modify video originals.


## AI prompt files and montage proposals
- Project prompt templates are in `.clipforge/prompts/*.md`. Preserve user edits during project initialization.
- The schema guardrails for clip and montage JSON remain in code, separate from editable creative instructions.
- `clipforge agent test codex|claude` MUST execute a real model call and validate the result, not just check an executable.
- The final film proposal is a draft. Never auto-approve highlight candidates or render without explicit action.
- Montage sequence IDs must reference actual stored highlight IDs. Persist prompt, result and errors for troubleshooting.

## Conversation understanding

- Conversation Understanding is an optional, objective AI stage over existing timestamped transcript and local media evidence. It must never rewrite the source transcript, invent speakers, or infer causal links from timestamp proximity alone.
- Store its validated artifact at `understanding/conversations.json`; relationships may reference only supplied stable utterance or event IDs and must include evidence, confidence, reason, and uncertainty.
- Deep Action and contextual editing consume this artifact to preserve dialogue setup, answers, payoff, and reactions. Creative preferences belong only to editing, not conversation interpretation.


## Dashboard and AI profile invariants (v0.10)

- Keep old `.clipforge/config.json` workspaces working; `aiStages` is optional, and missing profiles inherit legacy `agent` settings.
- Keep separate analysis and montage provider/model settings. Do not pretend that a CLI exposes a complete model catalog.
- CLI and UI must share the same pipeline and SQLite run records. Never create separate business logic for UI jobs.
- Do not start two analyses concurrently from the same dashboard; expose job state and failure to users.
- Rendering a suggested montage is an explicit user action. Respect the selection order and never auto-approve/reject highlights.
- Logs and advanced prompts are collapsed by default. Use readable primary actions and clear error states.

## Studio v0.11.0 development context

- The editable movie timeline is stored in SQLite `project_items` with optional `start_override` and `end_override`. Do not change source highlight values when saving a movie-specific cut.
- The studio backend is in `src/server.ts` at `/api/editor/projects`; DB logic is in `src/core/db.ts`. The browser-only playback loop lives in `src/dashboard/app.js`, with independent `previewItems` state.
- The AI movie suggestion is optional; a user must be able to select any highlighted moments for a manual movie, including those not in an AI recommendation. Do not silently render a suggestion.
- To preserve original media, all editing is non-destructive; only FFmpeg exports create new files.
- All creative context and prompts are project-local, even when the CLI is installed with npm `-g` or Python environments use `--scope user`.
- Additional project prompts: `highlight-selection.md` layers on `clip-analysis.md`; `film-direction.md` layers on `montage.md`. Do not invoke the LLM separately per prompt layer unless explicitly requested in a future design.
- UI principle: workflows and creative choices first; debugging, raw model output and provider settings stay in collapsible advanced views.
- Test any DB migration on both a fresh initialized workspace and legacy v0.10 projects. Before shipping, run `npm run build && npm test` and check `node --check src/dashboard/app.js`.

## Video editor / AI adapter rules (v0.13)
- Every montage item has its own speed independent of the source highlight. Enforce 0.25–4 in server and SQLite, and preserve behavior in browser playback and FFmpeg audio/video filters.
- Maintain provider-specific usage parsing. Do not label API-equivalent estimates or subscription usage as real billed amounts. Prefer official per-invocation CLI telemetry to unrelated session/account totals.
- Model catalogs are best effort. Never silently assume discovery means authorization. Let users enter a manual model and verify via a real smoke test.
- Analysis progress must be visible across dashboard views while details and logs remain collapsed.


## Reliability and billing contracts (v0.14)

- Never allow a failure of an optional enrichment step (speech transcription, audio peaks, AST classification) to terminate the batch; persist stage warnings and continue with remaining signals. Bad video files should be marked `error` and skipped.
- AST audio input windows shorter than 400 samples at 16 kHz are invalid for Kaldi fbank. Do not submit these windows.
- Do not label calculated token-price estimates or total CLI usage as actual invoice charges. API billing endpoints return account or organization information, not necessarily Clipforge-run information. Keep sources and scopes explicit. Never persist API keys in the project.
- Provider model lists must come from a real CLI or authenticated endpoint. Do not invent a static list or imply the list proves subscription access. Use a test inference request to verify the selected model.

## Film generation updates (v0.15)
- Read `film-regeneration.md` for regeneration calls only. Include the previous proposal and the latest user guidance, preserving the artifact audit trail.
- Persist user changes to proposed transitions separately from the raw model output; validate all IDs, effect names and durations.
- Deleting montage projects must never remove original clips, highlight rows, or transcription files. Require confirmation in the dashboard.
- UI async actions must show immediate loading state and clear it after success or failure.
