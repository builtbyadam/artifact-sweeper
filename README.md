<div align="center">

# 🧹 artifact-sweeper

**Reclaim Actions storage by deleting old artifacts and caches — and see exactly how much you freed.**

Dry-run by default. It tells you what it *would* delete before it deletes anything.

<br>

[![Marketplace](https://img.shields.io/badge/Marketplace-artifact--sweeper-2088FF?logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/artifact-sweeper)
[![CI](https://github.com/builtbyadam/actions/actions/workflows/test-artifact-sweeper.yml/badge.svg)](https://github.com/builtbyadam/actions/actions/workflows/test-artifact-sweeper.yml)
[![Release](https://img.shields.io/github/v/release/builtbyadam/artifact-sweeper?sort=semver)](https://github.com/builtbyadam/artifact-sweeper/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/builtbyadam/artifact-sweeper?style=social)](https://github.com/builtbyadam/artifact-sweeper/stargazers)

</div>

> 🪞 **This is a generated mirror** of [`builtbyadam/actions`](https://github.com/builtbyadam/actions). Issues and PRs are welcome there.

---

## The problem

Actions storage quota fills up silently. Old build artifacts and stale caches pile up until you hit the limit and uploads start failing — usually mid-release, at the worst time.

## What it does

Sweeps artifacts and caches older than a threshold, reports the count and bytes reclaimed, and **defaults to a dry run** so you can see the damage before committing to it.

## Usage

Scheduled cleanup that actually deletes anything older than 30 days:

```yaml
# Weekly cleanup, scheduled
on:
  schedule:
    - cron: "0 3 * * 0"   # weekly, Sunday 03:00 UTC

jobs:
  sweep:
    runs-on: ubuntu-latest
    permissions:
      actions: write       # required to delete artifacts and caches
    steps:
      - uses: builtbyadam/artifact-sweeper@v1
        with:
          older-than-days: "30"
          confirm: "true"   # omit or set "false" for a dry run
```

Dry-run first (the default) to see what would be removed without deleting:

```yaml
      - id: sweep
        uses: builtbyadam/artifact-sweeper@v1
        with:
          older-than-days: "14"
          name-pattern: "build-*"
          # confirm defaults to "false" → nothing is deleted
      - run: echo '${{ steps.sweep.outputs.report }}'
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `older-than-days` | | `30` | Only sweep items older than this many days (non-negative integer). Artifacts age from creation; caches from last access. |
| `include-artifacts` | | `true` | Sweep workflow artifacts (`"true"`/`"false"`). |
| `include-caches` | | `true` | Sweep Actions caches (`"true"`/`"false"`). |
| `name-pattern` | | `""` | Optional glob matched against the artifact name / cache key. Supports `*`, `?`, `**`. Empty matches everything. |
| `confirm` | | `false` | **Must be `"true"` to actually delete.** Otherwise dry-run. |
| `github-token` | | `${{ github.token }}` | Token with `actions: write`. |

## Outputs

| Output | Description |
|---|---|
| `deleted-count` | Items actually deleted. **`0` in dry-run** — candidates appear in `report` with `action: "would-delete"`. |
| `reclaimed-bytes` | Bytes actually freed. **`0` in dry-run.** |
| `dry-run` | `"true"`/`"false"` echo of whether this was a dry run. |
| `report` | JSON array of `{type, id, name, created_at, size_in_bytes, action}`; `action` is `"would-delete"` (dry-run) or `"deleted"`. |

## How it works

1. **Artifacts** are listed via `actions.listArtifactsForRepo` (paginated), aged from their `created_at`, and deleted via `deleteArtifact`.
2. **Caches** are listed via `getActionsCacheList` (paginated) and deleted via `deleteActionsCacheById`. A cache's age is measured from its `last_accessed_at`, not creation time — a recently *used* cache is still valuable, so this avoids evicting a hot cache.
3. An item is a deletion candidate when it is at least `older-than-days` old and (if `name-pattern` is set) its name/key matches the glob.
4. In dry-run (`confirm` not `"true"`) the action performs **zero** DELETE calls and lists candidates in `report` with `action: "would-delete"`; `deleted-count` and `reclaimed-bytes` stay `0`. With `confirm: "true"` it deletes each candidate, and a failure on one item logs a warning and continues (partial success is reflected in the count and report).

## Safety

Dry-run is the default — deletion happens only with `confirm: "true"`, so a copy-pasted workflow can never silently destroy data. Artifacts belonging to the **currently-running workflow run** (whose `workflow_run.id` equals `GITHUB_RUN_ID`) are always excluded, even with `confirm: "true"`, so a sweep job never deletes its own run's uploads.

## Limitations

- The `github-token` needs `actions: write` to delete; with a read-only token, listing works but every deletion fails (logged as warnings).
- Caches are aged from `last_accessed_at`; if the REST API omits it, the action falls back to `created_at`.
- Cache scoping by ref/branch is not filtered beyond the optional `name-pattern` against the cache key.
- Only the current repository is swept; there is no org-wide mode.

## License

[MIT](LICENSE)
