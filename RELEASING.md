# Release Guide

## Version Scheme

[Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Bump | When | Example |
|------|------|---------|
| PATCH (1.0.x) | Bug fixes, typos, dependency updates | Fix QR display on Windows |
| MINOR (1.x.0) | New features, backward compatible | Add `msg send-video` command |
| MAJOR (x.0.0) | Breaking changes | Change CLI argument format |

## How a release works

Publishing is automated. Creating a GitHub release triggers `.github/workflows/release.yml`, which:

1. **verify** — checks the release tag equals `v<package.json version>`, then runs typecheck, lint, format check and tests.
2. **binaries** — builds standalone executables for linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64, writes `SHA256SUMS`, and uploads everything to the release.
3. **npm** — publishes the package to npm with provenance (uses `NPM_TOKEN`; Bun cannot produce provenance attestations, so this one step uses `npm publish`).

Do not run `npm publish` by hand.

## Release Checklist

### 1. Ensure clean state

```bash
git status                  # No uncommitted changes
bun run check               # Typecheck, lint, format check and tests all pass
bun outdated                # No critical outdated deps
```

### 2. Bump version

```bash
# Patch release (bug fix)
bun pm version patch -m "release: v%s"

# Minor release (new feature)
bun pm version minor -m "release: v%s"

# Major release (breaking change)
bun pm version major -m "release: v%s"
```

This updates the `package.json` version, creates a git commit, and tags it.

### 3. Push commit + tag

```bash
git push origin main --tags
```

### 4. Create GitHub release

```bash
VERSION=$(bun -p "require('./package.json').version")
gh release create "v${VERSION}" \
  --title "v${VERSION}" \
  --generate-notes
```

`--generate-notes` auto-generates changelog from commits since last release. Publishing the release starts the workflow above; follow it with `gh run watch`.

## Quick One-Liner

```bash
# Patch release (most common)
bun run check && bun pm version patch -m "release: v%s" && git push origin main --tags && gh release create "v$(bun -p "require('./package.json').version")" --title "v$(bun -p "require('./package.json').version")" --generate-notes

# Minor release
bun run check && bun pm version minor -m "release: v%s" && git push origin main --tags && gh release create "v$(bun -p "require('./package.json').version")" --title "v$(bun -p "require('./package.json').version")" --generate-notes
```

## Commit Messages Between Releases

Use [Conventional Commits](https://www.conventionalcommits.org/) so `--generate-notes` produces clean changelogs:

```
feat: add video message support      → shows in "New Features"
fix: handle expired QR gracefully     → shows in "Bug Fixes"
docs: update proxy setup guide        → shows in "Documentation"
chore: bump dependencies              → shows in "Maintenance"
```

## Rollback

If a release has issues:

```bash
# Delete the release
gh release delete v1.0.1 --yes

# Delete the tag
git tag -d v1.0.1
git push origin :refs/tags/v1.0.1

# Revert the version bump commit
git revert HEAD
git push origin main
```
