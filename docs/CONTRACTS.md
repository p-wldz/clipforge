# Contracts and invariants

## Workspace
`.clipforge/config.json` is JSON version 1. Paths `clips/` and `.clipforge/` are relative to workspace unless absolute. `artifacts/<stable clip id>/` stores metadata, frames, audio-activity, optional transcript and highlight proposals. A source video's ID is a SHA-256 of its resolved absolute path, truncated to 16 hex digits; moving source invalidates path identity.

## SQLite
- `clips(id, source_path, duration, width, height, analyzed_at, transcript)`
- `highlights(id, clip_id, start, end, title, description, score, status, origin, created_at)`
- `projects(id, name, created_at)` and `project_items(project_id, highlight_id, position)`
- `stage_artifacts(clip_id, stage, cache_key, ...)` stores immutable, cache-keyed base/contextual understanding payloads. A failed optional stage is recorded rather than silently reused.
- `highlight_sets(context_key, cache_key)` and `highlight_set_items(...)` retain editing candidates per creative context. They never delete approved or rejected highlight rows.

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

## Security
Dashboard binds `127.0.0.1` by default. Do not expose without auth, CSRF protection, restrictive CORS and file access audit. No shell for external tools. Restrict all media access to DB-known videos, no arbitrary file fetch route. Agent output is untrusted, validated and truncated. Original inputs never overwritten.

## Next schema version
Implement migrations before changing database columns; consider stage key `(source fingerprint, config hash, provider version)` rather than only file path. Consider cleanup of old candidates on --force while preserving edited reviews, and transactionally inserting project items.
