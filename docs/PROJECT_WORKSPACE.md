# Project workspace contract

`clipforge init --interactive` creates a local project. It is independent of the library source checkout.

- `clips/` (customizable): user video assets; original files are never modified.
- `.clipforge/config.json`: project metadata, audio/transcription configuration, screenshots sampling interval, default agent.
- `.clipforge/context.md`: editable creative brief passed to the chosen agent, with focus such as funny dialogue or explosions.
- `.clipforge/workflow.json`: declarative step outline for future planner support. **Currently informational, not executed as a workflow DAG.**
- `.clipforge/state.sqlite`: canonical clip/highlight/review/project state.
- `.clipforge/artifacts/<clip-id>/`: metadata, sampled frames, optional transcripts, audio activity, heuristic highlights and optional `agent-<highlight-id>.json` decisions.
- `.clipforge/renders/`: video exports.

## User flow

1. Create a blank directory and run `clipforge init --interactive`.
2. Put recordings in the configured clips directory.
3. `clipforge doctor` checks FFmpeg/ffprobe and optional tools without calling any LLM.
4. `clipforge agents` lists installed Codex/Claude/Cursor commands. Installed does **not** mean authenticated or supported for analysis.
5. Choose `clipforge analyze --agent codex` (or `--agent claude`), or omit `--agent` for local heuristic analysis.
6. Review candidates in `clipforge dashboard`, adjust times, approve, and render.

New workspaces have no maximum clip duration by default: every eligible recording is probed and analyzed. Set `analysis.maxDurationSeconds` only when deliberately limiting processing. AI analysis uses timestamped screenshots across each full clip and favors complete setup-to-reaction sequences over isolated peaks.

## Current restrictions

- `cursor` is detected as a CLI, but its **analysis adapter is not implemented**.
- Voice transcription is optional and invokes user-installed Whisper-compatible software. It is not bundled or auto-installed.
- Vision quality depends on the agent's ability to consume the sampled frames. Claude adapter receives file paths in text but not embedded images.
- Agents may consume paid quotas or transmit data. Confirm the terms of the configured provider.
- The workflow file is a roadmap contract, not a run-time declarative execution engine.
