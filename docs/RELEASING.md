# Releasing Clipforge

## Before tagging

1. Update `package.json` and add a concise entry under `Unreleased` in [`../CHANGELOG.md`](../CHANGELOG.md). Move it to the matching version heading.
2. Run `npm run ci` and `npm run release:archive && npm run release:archive:check` locally.
3. Confirm the worktree is clean and the intended commit is on `main`.
4. Create and push the matching immutable tag: `v<package.json version>`.

## Automated publication

The tag starts two independent workflows:

- `Publish npm package` runs the package gate through `prepublishOnly` and publishes with npm provenance.
- `Publish portable archives` verifies each platform package, then attaches macOS, Linux, and Windows archives plus one combined `SHA256SUMS` file to the GitHub Release.

Both workflows reject a tag whose value does not match `package.json`. Each has
its own concurrency group, so reruns of the same release workflow are serialized
without cancelling the other publication route.

## After publication

1. Check npm shows the expected version and provenance.
2. Download one portable archive, verify its checksum, and run `clipforge doctor`.
3. Confirm the release notes link to the correct changelog entry.
4. Only after stable archive URLs and hashes exist, update the external Homebrew/Scoop manifests. Do not publish a WinGet manifest until unattended Windows upgrades are supported.
