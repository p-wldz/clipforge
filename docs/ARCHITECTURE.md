# Architecture

```text
CLI ───────────────┐
                   ├── Node core ── SQLite .clipforge/state.sqlite
Dashboard HTTP ───┘          │
                              ├── ffprobe/ffmpeg (deterministic)
                              ├── audio/silence candidate detector
                              ├── optional transcription CLI
                              ├── optional Codex/Claude adapter
                              └── reviewed montage → FFmpeg render
                                     │
                                     └── .clipforge/renders/<projectId>/final.mp4
```

## Pipeline
1. `probe`: metadata from `ffprobe`; rejects files without video.
2. `frames`: up to 30 cached JPEGs at configurable spacing.
3. `audioEvents`: `silencedetect` inverted into active intervals. This does not mean a kill or highlight.
4. `transcribe`: optional provider configured as process command + argv templates. Default is off.
5. `candidates`: interval deduplication and bounded windows, marked `pending_review`.
6. `agent`: optional explicit call to Codex/Claude for text descriptions and scores. Nonfatal failure.
7. `review`: dashboard or CLI approval; edited boundaries validated against original clip.
8. `project/render`: explicit project creation, H.264/AAC segment re-encoding, concat into MP4.

## Staged AI workflow

When AI is explicitly enabled, Clipforge runs a bounded three-stage workflow. **Deep Action Analysis** creates a reusable, timestamped account of complete actions (setup through reaction), evidence and uncertainty in `artifacts/<clip-id>/understanding/deep-action.json`; its cache key excludes creative context. **Contextual Editing** evaluates every action against the project editing brief and may select none. An optional single **Critical Review** pass adjusts only evidence-supported boundaries and writes both original and corrected proposals; unclear corrections are recorded as selective-reanalysis ranges. Existing `clip_analyses` and `highlights` remain compatible, and editing sets remain context-keyed.

Optional domain interpretations are stored separately under `understanding/contexts/`. Project contexts live in `.clipforge/contexts.json` with independent `domain`, `editing`, and `filmDirection` fields. New stage profiles (`understanding`, `contextualUnderstanding`, `editing`, `filmDirection`) are optional; old workspaces continue to inherit `agent`, `clipAnalysis`, and `montage` settings.

## Why no queue or external DB?
Single-user local processing. SQLite WAL is sufficient for metadata; artifacts are files. CLI operates one video at a time. Long-term direction: job table and worker process, resumable per-stage job state, parallel limits. Avoid Redis/Postgres until justified.

## Agent boundary
Provider choices live in `.clipforge/config.json`: `none`, `codex`, or `claude`. The CLI checks binaries without invoking LLMs. Agent runs are opt-in `analyze --agent`. Prompt text is treated as untrusted and agents must not be granted broad filesystem write access. Codex receives sample JPEG paths as `--image`; Claude adapter currently sends file paths in its prompt, not binary images, and may not visually inspect them. Plan dedicated vision provider for reliable visual descriptions.

## Important tradeoff
The MVP does not yet 'understand' gameplay. It proposes audio-driven candidate windows and accepts optional agent descriptions. A next phase should implement OCR/HUD game plugins, STT provider abstraction, motion/sound event detectors, and scoring calibrated against user feedback.

## Sound-event classifier
The optional `soundClassifier` config is persisted in `.clipforge/config.json`. `clipforge setup --sound-classifier` bootstraps a separate Python venv with CPU PyTorch, torchaudio and Transformers, then smoke-tests the AudioSet AST model before enabling it. `src/pipeline/sound-classifier.ts` resamples audio with FFmpeg, invokes `tools/classify_sound_ast.py` and stores the classifier's interval estimates in `.clipforge/artifacts/<clipid>/sound-events.json`. These events inform candidate selection and are shown in the dashboard. They are not ground truth.

### Run logging and full-clip understanding (v0.8)

Run history and stage events are stored in `.clipforge/state.sqlite`, shared between CLI and dashboard. Dashboard polls `/api/analysis/runs` and `/api/analysis/events/:runId` every two seconds. Each clip has one AI call over the sampled full-clip screenshots plus transcript and sound-event metadata. The result is validated (`title`, `summary`, `story`, `highlights`), saved in `clip_analyses` and `clip-analysis.json`, and generates the review candidates. Invalid/failed calls persist a failure record and retain labeled heuristic candidates. Debug files are private and never sent to an external server by the Clipforge dashboard.

### v0.11 Studio and project-level cuts

The `project_items` table contains ordered highlight references plus optional editor-specific start/end overrides. Browser preview reads those fields and plays `/media/:clipId` sequentially with client-side seeks. The server accepts explicit montage create/update operations through `/api/editor/projects`. The renderer reads `Store.projectItems` and uses the cut override values. No source media is modified.

There are two install axes: the Node CLI can be global or project-local (npm standard installation); model execution environments can be project-local or shared-user (`clipforge setup --scope project|user`). Project contexts, prompt templates, SQLite and review assets **always** stay local to the clips workspace.
