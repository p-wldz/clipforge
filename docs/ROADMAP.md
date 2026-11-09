# Development roadmap

## Now: functional vertical slice
- [x] Local workspace, JSON config, SQLite
- [x] CLI doctor without LLM; tool checks are non-destructive
- [x] Video probe, frames, activity-based candidates, optional transcription
- [x] Provider selection: none, Codex, Claude (optional invocation)
- [x] Browser dashboard review, trim, approve/reject
- [x] Create montage and render MP4
- [x] Agent contexts/skills

## Next: quality and robustness
- [x] Centralize supported provider names and authentication modes for CLI, server, and pipeline validation
- [x] Cross-platform CI and npm package pre-publish verification
- [x] Deep Action Analysis, contextual editing, and a bounded optional critical review pass with inspectable artifacts
- [ ] Add scene change, volume peaks, speech windows, and event-based candidate generation
- [ ] Add native Whisper/faster-whisper/whisper.cpp adapters and diarization
- [ ] Add true vision analysis with defined schemas for frame sequences
- [ ] Add job queue with cancel/progress/resume and stage cache keys
- [x] Offer explicit, cached local MP4 browser previews for non-MP4/WebM source containers
- [ ] Harden renderer: silence source, variable frame rates, sample aspect ratios, subtitles
- [ ] Add UI timeline, title editing and reorderable clips
- [ ] Add automated cross-platform integration tests (Windows/Linux/macOS)

## Later: domain intelligence
- [ ] Game plugin interface, HLL HUD OCR and telemetry correlation
- [ ] Human preference learning and near-duplicate scoring
- [ ] Extend provider adapters: model API, Ollama, OpenAI, Anthropic
- [ ] Optional MCP adapter over stable core
- [ ] Distributable npm package / signed desktop installer


## Media filters and search
- [x] Pre-analysis duration/audio filters with skip reasons saved in local SQLite
- [x] Timestamped Whisper-compatible segment storage and literal phrase search in CLI/dashboard
- [ ] Local faster-whisper provider with automatic environment diagnosis
- [ ] Search with stemming, FTS5 and optional semantic embeddings
- [ ] Audio event classification for explosions, shots, laughter with calibrated confidence
- [ ] Search across both transcripts and visually recognized scene events
