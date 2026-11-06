# Contracts and invariants

## Workspace
`.clipforge/config.json` is JSON version 1. Paths `clips/` and `.clipforge/` are relative to workspace unless absolute. `artifacts/<stable clip id>/` stores metadata, frames, audio-activity, optional transcript and highlight proposals. A source video's ID is a SHA-256 of its resolved absolute path, truncated to 16 hex digits; moving source invalidates path identity.

## SQLite
- `clips(id, source_path, duration, width, height, analyzed_at, transcript)`
- `highlights(id, clip_id, start, end, title, description, score, status, origin, created_at)`
- `projects(id, name, created_at)` and `project_items(project_id, highlight_id, position)`
- `stage_artifacts(clip_id, stage, cache_key, ...)` stores immutable, cache-keyed Deep Action, contextual editing, and critical-review payloads. A failed optional stage is recorded rather than silently reused. Deep Action entries contain uniquely identified complete actions, narrative phases, timestamped evidence, and uncertainty; contextual decisions must decide every action exactly once.
- `stage_artifacts` also stores `conversation-understanding` payloads. Conversation IDs, `utt-*` transcript IDs, and supplied event IDs are stable only within the associated clip artifact; relationships must reference those IDs, include evidence, confidence, and a reason. Transcripts remain unchanged.
- `highlight_sets(context_key, cache_key)` and `highlight_set_items(...)` retain editing candidates per creative context. They never delete approved or rejected highlight rows.
- `transcript_segments` has a workspace-local FTS5 index refreshed atomically with each transcript revision; normal search never returns superseded segment rows.
- `highlight_feedback` and `missed_moments` are user-owned annotations, separate from generated highlights and retained when AI candidates are regenerated.

Highlight `status`: `pending_review | approved | rejected`. `origin`: `heuristic | codex | claude`. Time units are seconds, start inclusive, end exclusive. Scores 0–100; heuristic score 50 represents an unverified candidate.

## HTTP API
- `GET /api/clips`
- `GET /api/highlights`
- `PATCH /api/highlights/:id` keys start/end/title/description/status
- `GET /api/projects`
- `POST /api/projects` `{name, highlightIds}` with *approved* IDs
- `POST /api/projects/:id/render`
- `GET /media/:clipId` with byte-range support; original media, local server only
- `GET /thumbnail/:clipId`
- `POST /api/analysis/jobs/:jobId/cancel` cooperatively cancels a dashboard analysis. In-flight agent subprocesses are terminated; local stages stop before the next clip.
- `POST /api/analysis/jobs/active/cancel` cancels the dashboard's active analysis without requiring a browser-held job ID. It never claims to stop a separately run CLI process.
- `POST /api/analysis/runs/:runId/cancel` explicitly clears an abandoned `running` record after its dashboard process has exited. It never terminates a separately run CLI process.

## Highlight deletion

The dashboard can delete one, selected, or all highlights after confirmation. This removes associated feedback, saved editing-set entries, and montage item references, but does not delete source media, clips, or inspectable analysis artifacts.

## Security
Dashboard binds `127.0.0.1` by default. Do not expose without auth, CSRF protection, restrictive CORS and file access audit. No shell for external tools. Restrict all media access to DB-known videos, no arbitrary file fetch route. Agent output is untrusted, validated and truncated. Original inputs never overwritten.

## Next schema version
Implement migrations before changing database columns; consider stage key `(source fingerprint, config hash, provider version)` rather than only file path. Consider cleanup of old candidates on --force while preserving edited reviews, and transactionally inserting project items.
