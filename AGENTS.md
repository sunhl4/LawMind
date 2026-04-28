# LawMind — Agent / contributor guidelines

This repository is **LawMind only** (legal workbench: `src/lawmind`, `apps/lawmind-desktop`, `apps/lawmind-docs`). There is no OpenClaw gateway, extensions workspace, or multi-channel core in this tree.

## References and paths

- In chat, use **repo-root-relative** paths only (example: `src/lawmind/agent/runtime.ts:120`). Never use absolute paths or `~/...`.
- Product vision and architecture live under **`docs/LAWMIND-*.md`** and **`docs/lawmind/`**; full tree map: **`docs/LAWMIND-REPO-LAYOUT.md`**.
- Goals and checklist: **`GOALS.md`**.

## Git / GitHub

- For `gh` comments with multiline bodies, prefer a single-quoted heredoc (`-F - <<'EOF'`) so shell metacharacters and backticks do not corrupt the message.
- For auto-linking issues/PRs, use plain `#123` (not wrapped in backticks) when you want GitHub to link.
- Before treating a bugfix as done, prefer **repro + failing test or logs + code path** over narrative-only claims.

## Security

- Read **`SECURITY.md`** before triaging anything that touches trust boundaries, local API exposure, or workspace file access.
- Do not bypass **`CODEOWNERS`** (if present) on restricted paths unless an owner is involved.

## Layout (what to touch)

| Area                                     | Path                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Engine (tasks, drafts, agent, policy, …) | `src/lawmind/`                                                                            |
| Desktop shell + local HTTP API sources   | `apps/lawmind-desktop/`                                                                   |
| VitePress docs app                       | `apps/lawmind-docs/`                                                                      |
| LawMind CLI scripts                      | `scripts/lawmind/`（`pnpm lawmind:*` 入口）· `scripts/pre-commit/`（本地 git hooks 辅助） |

## Build, test, format

- **Node 22+**; install: `pnpm install`
- **Tests:** `pnpm test` (Vitest — `src/lawmind/**/*.test.ts` and LawMind desktop tests)
- **Desktop typecheck:** `pnpm --filter lawmind-desktop typecheck`
- **Bundle local server:** `pnpm lawmind:bundle:desktop-server`
- **Docs site:** `pnpm lawmind:docs:build`
- **Pre-commit** (if enabled): Oxlint + Oxfmt via `git-hooks/pre-commit` and `scripts/pre-commit/`

## Code style

- **TypeScript (ESM)**, strict; avoid `any` unless unavoidable.
- Match existing patterns in the file you edit; avoid drive-by refactors outside the request.
- Colocate tests as `*.test.ts` next to implementation.

## Automation note

Some **`.github/workflows`** (labeler, stale, CodeQL) may still assume a larger monorepo. If a workflow fails on paths that no longer exist, narrow or disable that job rather than re-introducing OpenClaw trees.
