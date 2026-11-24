# Changelog

All notable user-facing changes are recorded here. Releases follow calendar-free
semantic versioning; version tags are `v<package.json version>`.

## Unreleased

- No unreleased entries yet.

## 0.16.0

- Added a local quality benchmark for highlight proposals, including precision, recall, boundary-error, and duplicate metrics in the CLI and dashboard.
- Added safe single-clip reanalysis that preserves review feedback and missed moments as editing-only calibration.
- Detect replaced source videos and invalidate derived AI analysis without modifying originals.
- Improved the dashboard analysis workflow with local-media discovery, clearer run ownership and progress, and protection against concurrent jobs.
- Added sound-classifier calibration controls, reviewable sound-event evidence, and visual frame attachments for Deep Action Analysis.
- Improved optional-tool setup diagnostics and release documentation.

## 0.15.4

- Added a GitHub Packages mirror published as `@p-wldz/clipforge`.

## 0.15.3

- Fixed Unix portable-archive creation in the GitHub release workflow.

## 0.15.2

- Fixed portable archive verification on hosts where optional FFmpeg tools are not installed.

## 0.15.1

- Fixed npm trusted publishing from GitHub Actions by using an OIDC-compatible npm CLI and avoiding an empty token configuration.

## 0.15.0

- Added OpenAI and Anthropic API-key adapters alongside installed Codex and Claude clients.
- Added explicit local browser MP4 previews for source containers that browsers commonly cannot play.
- Added structured dashboard error references and concise, safe server logs.
- Added cross-platform CI, npm provenance publishing, and portable release archives with checksums.
- Centralized provider metadata so dashboard and CLI choices explain installed-client versus API-key authentication.
