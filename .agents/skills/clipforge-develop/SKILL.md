---
name: clipforge-develop
description: Develop and test the Clipforge local video pipeline without breaking agent neutrality or local-first storage.
---
Read AGENTS.md, docs/ARCHITECTURE.md and docs/CONTRACTS.md. Identify the relevant core/pipeline/agent module; make minimal changes. Run `npm run typecheck`, `npm test`, and `npm run build`. Preserve CLI and dashboard compatibility. Add docs and tests with behavioral changes. Never automatically install tools or invoke paid agents.
