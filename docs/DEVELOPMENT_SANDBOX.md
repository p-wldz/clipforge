# Developing with Codex or Claude

Do not test against personal recordings or the library source checkout. Use a disposable local workspace.

```bash
npm install
npm run build
npm test
mkdir -p /tmp/clipforge-e2e
node dist/cli.js init /tmp/clipforge-e2e --name "Sandbox" --focus "Funny moments and explosions"
node dist/cli.js doctor --root /tmp/clipforge-e2e
```

Place a short synthetic MP4 in `/tmp/clipforge-e2e/clips` and run:

```bash
node dist/cli.js analyze --root /tmp/clipforge-e2e
node dist/cli.js dashboard --root /tmp/clipforge-e2e
```

No agent is needed for tests. External agent tests must be **opt-in** and must never be part of default CI due to cost and privacy.

## Suggested agent workflow

Read `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, `docs/PROJECT_WORKSPACE.md` and `docs/ROADMAP.md` before editing. Make a small change, run `npm run typecheck`, `npm test`, and an isolated sandbox analysis. Add regression tests and update docs/contracts when introducing new stages. Never modify source recordings.

## Future test tiers

- Unit: config, time windows, provider detection parsing, transcript normalization, approval state.
- Integration: synthetic WAV/MP4 generated locally by FFmpeg, no network.
- Agent integration: manually activated test with a dedicated fixture, strict token/timeout budget.
- Dashboard E2E: Playwright, mocked agent responses and isolated SQLite.
