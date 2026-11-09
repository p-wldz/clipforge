# Distribution decision note

## Decision

Publish the Node package to npm as the primary developer installation, and publish
versioned, checksummed platform archives on GitHub Releases as the no-Node-runtime
installation path. Start with the three supported desktop targets: macOS (arm64 and
x64), Linux (x64), and Windows (x64). Build each archive from the same tagged commit
as the npm package.

The executable artifact should use Node's built-in Single Executable Application
(SEA) mechanism after a feasibility spike. It avoids depending on an unmaintained
third-party packager and is supported by Clipforge's Node 22.13+ baseline. SEA is
still marked "Active development" by Node, so retain the npm distribution as a
first-class, supported route and test the artifacts on every release.

GitHub Releases are the canonical source for binary URLs, SHA-256 checksums,
release notes, and the package-manager manifests below. Do not publish a desktop
installer yet: Clipforge is a CLI/library with workspace-local state, so archives
are simpler to audit, upgrade, and remove.

## User-facing installation routes

| Audience | Route | Initial user experience |
| --- | --- | --- |
| JavaScript developers | npm | `npm install -g clipforge` or `npx clipforge ...` |
| Users without Node/npm | GitHub Release archive | Download the archive for the OS/CPU, verify the published SHA-256, add its directory to `PATH`, then run `clipforge doctor`. |
| macOS/Linux package-manager users | Homebrew tap | `brew install <org>/tap/clipforge` after the binary release process is stable. |
| Windows package-manager users | Scoop bucket | `scoop bucket add <bucket> <repo>` then `scoop install clipforge`. |
| Windows managed environments | WinGet | `winget install <Publisher>.Clipforge` after providing a silent, versioned installer or a compatible portable package. |

All routes must present the same `clipforge doctor` onboarding message: distinguish
the CLI installation from optional local media tooling and explicitly explain that
`doctor` makes no changes. Setup remains an explicit action, in line with the
project's local-first contract.

## Portable archive layout

Each tagged archive contains one versioned directory with `dist/`, a matching Node
runtime, `README.md`, and a `clipforge` launcher on macOS/Linux or `clipforge.cmd`
on Windows. Add that directory to `PATH`; no global npm installation is needed.
Verify the downloaded archive against the `SHA256SUMS` asset before extracting it.
The bundled runtime executes only Clipforge; FFmpeg, FFprobe, Python, optional
models, and AI credentials remain user-managed external dependencies.

## Release engineering requirements

1. Make a release workflow that builds and tests the npm tarball plus every binary
   target from a signed tag. Run smoke tests for `--help`, `doctor --json`, workspace
   initialization, and a short synthetic-media workflow where FFmpeg is available.
2. Create release archives named with version, OS, and CPU; attach a `SHA256SUMS`
   file and generate human-readable release notes. Do not overwrite published assets.
3. Before adopting SEA, validate bundled dashboard/template assets, ESM loading,
   subprocess paths, SQLite behavior, and optional Python-tool discovery from an
   extracted archive. SEA embeds a single bundled script; native addons require
   additional loading work. Cross-platform builds must disable SEA snapshots and
   code cache unless they are produced on the target platform.
4. Add a Homebrew formula in an upstream tap only after archive URLs and hashes are
   stable. Formulae need versioned URLs and SHA-256 values.
5. Maintain the Scoop manifest in an owned bucket alongside release automation.
   It should download the Windows archive from GitHub Releases, verify its hash,
   and expose `clipforge` as the command.
6. Submit a versioned YAML manifest to `microsoft/winget-pkgs` only after Windows
   packaging supports unattended installation and upgrades. Validate the manifest
   before submission and expect community-repository review.

See [RELEASING.md](RELEASING.md) for the executable pre-tag and post-publication checklist.

## Implemented publication guardrails

- `.github/workflows/ci.yml` runs the full verification command on Ubuntu, Windows,
  and macOS with the supported Node baseline.
- `npm run ci` runs typecheck, tests, build, dashboard syntax validation, and
  `npm pack --dry-run`; `prepublishOnly` uses the same command so a local publish
  cannot skip those checks.
- `.github/workflows/publish-npm.yml` runs only on version tags; `prepublishOnly`
  executes the same verification before `npm publish --provenance`. It does not
  create a release archive or install external media/model dependencies.
- `.github/workflows/release-archives.yml` creates portable per-platform archives
  on the same tag. Each archive contains the compiled CLI, its matching Node
  runtime, a small `clipforge`/`clipforge.cmd` launcher, and the README; the
  workflow publishes SHA-256 checksums. The archive does not install FFmpeg,
  Python, models, or an AI provider. It smoke-tests the packaged launcher with
  `--help`, disposable workspace initialization, and `doctor --json` before
  publishing any release asset. Platform jobs upload build artifacts only; one
  dependent publish job generates the single combined `SHA256SUMS` file and
  attaches every asset, avoiding concurrent release-asset updates. Build jobs
  have read-only repository permissions; only that final job can write assets.

## Non-goals for the first publication

- Do not make a global installer silently provision FFmpeg, Python, speech models,
  or an AI provider.
- Do not put API keys in binary artifacts, package manifests, or release notes.
- Do not claim one executable works across operating systems or CPU architectures.
- Do not deprecate npm merely because binary downloads are available.

## Primary sources

- [Node.js: Single executable applications](https://nodejs.org/api/single-executable-applications.html) -- `--build-sea`, embedded assets, platform constraints, and SEA stability.
- [GitHub Docs: Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) -- releases, assets, notes, and management APIs.
- [Homebrew: Create and maintain a tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap) -- tap layout, direct installation, update behavior, and checksums.
- [Microsoft Learn: Create a WinGet package manifest](https://learn.microsoft.com/en-us/windows/package-manager/package/manifest) and [submit it](https://learn.microsoft.com/en-us/windows/package-manager/package/repository) -- manifest and validation/submission process.
- [Scoop: Buckets](https://github.com/ScoopInstaller/Scoop/wiki/Buckets) -- bucket structure, custom-bucket installation, and discovery.
- [npm Docs: `npm publish`](https://docs.npmjs.com/cli/v7/commands/npm-publish/) -- package publication and immutable name/version pairs.
