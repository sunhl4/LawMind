---
summary: "Sync, commit, and push between your local clone and GitHub: pull, push, and contribute upstream."
read_when:
  - You want to update a local checkout from GitHub
  - You want to commit local work and push it to GitHub
  - You are syncing with upstream or a fork
title: "GitHub: local workflow"
---

## Prerequisites

- A local git clone of the repository (for example after `git clone https://github.com/openclaw/openclaw.git`).
- Network access to GitHub.
- Authentication set up for GitHub (SSH key with `git@github.com:...` URLs, or HTTPS with a [personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) or Git credential helper).
- Your default branch on this repo is typically `main`.

## See what you changed locally

From the repository root:

```bash
git status
git diff
```

`git status` lists modified and untracked files. `git diff` shows unstaged changes; use `git diff --staged` after `git add` to review what will be committed.

## Commit your changes locally

1. Stage the files you want in the commit:

```bash
git add path/to/file
```

To stage everything under the repo (use carefully):

```bash
git add -A
```

2. Create the commit with a message:

```bash
git commit -m "Short summary of the change"
```

Use a clear, imperative subject line (for example `docs: explain GitHub push flow`).

**OpenClaw maintainers and contributors** often scope commits with the repository helper to avoid staging unrelated files:

```bash
scripts/committer "docs: explain GitHub push flow" docs/github/index.md
```

See [AGENTS.md](https://github.com/openclaw/openclaw/blob/main/AGENTS.md) in the repo for the full contributor workflow.

## Push your commits to GitHub

When your branch tracks `origin/main` (or your remote branch name):

```bash
git push origin main
```

If you are on a feature branch:

```bash
git push -u origin your-branch-name
```

The `-u` sets the upstream so later you can run `git push` without arguments.

### If `git push` is rejected (non-fast-forward)

Someone else may have pushed to the same branch. Update your local branch, then push again:

```bash
git pull --rebase origin main
git push origin main
```

Replace `main` and remote names to match your branch. Resolve any rebase conflicts before pushing.

## Contributing changes to the main OpenClaw repo

If you do not have direct push access, use a **fork**:

1. Fork [openclaw/openclaw](https://github.com/openclaw/openclaw) on GitHub and clone **your** fork.
2. Create a branch, commit, and push to **your** fork (`origin`).
3. Open a **pull request** from your branch to `openclaw/openclaw` `main`.

Read [CONTRIBUTING.md](https://github.com/openclaw/openclaw/blob/main/CONTRIBUTING.md) for review expectations and PR guidelines.

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
