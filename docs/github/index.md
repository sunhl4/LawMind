---
summary: "How to fetch and pull updates from the remote GitHub repository into your local clone."
read_when:
  - You want to update a local checkout from GitHub
  - You are syncing with upstream or a fork
title: "GitHub: sync your local clone"
---

## Prerequisites

- A local git clone of the repository (for example after `git clone https://github.com/openclaw/openclaw.git`).
- Network access to GitHub.
- Your default branch on this repo is typically `main`.

## See what changed on the remote (optional)

From the repository root:

```bash
git fetch origin
git status
```

`git fetch` downloads new commits and branch tips from the remote without changing your working files. `git status` compares your current branch to its upstream and reports if you are behind or ahead.

## Pull updates on the same branch (merge)

If you are on `main` (or another branch that tracks `origin/<same-name>`):

```bash
git checkout main
git pull origin main
```

This fast-forwards or merges remote commits into your local branch.

## Pull with rebase (linear history)

Many workflows prefer rebasing local commits on top of the updated remote:

```bash
git checkout main
git pull --rebase origin main
```

If you have uncommitted changes, commit or stash them first. If a rebase stops with conflicts, fix the files, then `git add` them and run `git rebase --continue`, or abort with `git rebase --abort`.

## Forks: add upstream and sync from the canonical repo

If you cloned your own fork but want updates from the main project:

```bash
git remote add upstream https://github.com/openclaw/openclaw.git
git fetch upstream
git checkout main
git pull --rebase upstream main
git push origin main
```

Use your fork URL and branch names if they differ. `git push origin main` updates your fork on GitHub after you have integrated upstream changes locally.

## After pulling (this project)

If dependencies or generated artifacts may have changed, from the repo root run install and tests as needed—for example `pnpm install` and `pnpm test`—per the instructions in the repository README and contributor docs.

## Related

- [Updating](/install/updating) describes upgrading an installed OpenClaw package; this page is about git and your local source tree.
