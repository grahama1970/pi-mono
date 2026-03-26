---
description: How to release a new version of pi-mono
---

# Release Workflow

This workflow guides you through the process of releasing a new version of the pi-mono packages.
We follow **lockstep versioning** (all packages share the same version) and **semantic versioning**.

## 1. Verify Clean State

First, ensure you are on the `main` branch and have a clean working directory.

```bash
git status
```

> [!IMPORTANT]
> If there are uncommitted changes, stash or commit them before proceeding.
> If you are not on `main`, checkout `main` and pull the latest changes.

## 2. Check Changelogs

Review the `[Unreleased]` section of the CHANGELOG.md files for affected packages.
Ensure all changes since the last release are documented.

```bash
# Check the root package log (example) or specific packages
cat packages/agent/CHANGELOG.md | grep -A 10 "\[Unreleased\]"
```

## 3. Determine Release Type

Decide on the version bump type:

- **patch**: Bug fixes and new features (no breaking changes).
- **minor**: API breaking changes.
- **major**: Do NOT use (we do not do major releases yet).

## 4. Execute Release

Run the appropriate release script. This will automatically:

1.  Bump versions in `package.json`
2.  Finalize CHANGELOGs
3.  Commit and Tag
4.  Publish to registry

**Option A: Patch Release (Fixes/Features)**
// turbo

```bash
npm run release:patch
```

**Option B: Minor Release (Breaking Changes)**
// turbo

```bash
npm run release:minor
```

## 5. Post-Release Verification

Verify that the `[Unreleased]` section has been reset in the changelogs.

```bash
cat packages/agent/CHANGELOG.md | grep -A 5 "\[Unreleased\]"
```
