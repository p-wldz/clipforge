---
name: clipforge-review
description: Review and approve candidate highlights from local videos using Clipforge CLI and dashboard.
---
Use `clipforge doctor`, then `clipforge highlights --json` to inspect candidates. Read JSON artifacts when necessary. Be conservative when describing gameplay action. For user review, run `clipforge dashboard`; ask for explicit acceptance before final rendering. Approved highlights can be assembled with `clipforge project "name"` then `clipforge render <project-id>`. Never change source videos.
