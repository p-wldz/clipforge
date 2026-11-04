# Claude Code project context

Start with `AGENTS.md`, then `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md` and `docs/ROADMAP.md`.

This repository is agent-neutral. Do not insert Claude-specific logic into core. Extend the `src/agents` adapter boundary, and never edit original user videos. Run `npm run typecheck && npm test` after changes. Do not install system packages or execute paid model requests without authorization. The core pipeline must remain useful when `agent.provider = "none"`.
