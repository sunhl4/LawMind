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

## 并行会话（多窗口 / 多 Agent 同一克隆）

同一个克隆**同一时刻只允许一个会话写工作区**。需要在同一仓库并行时，一律 `git worktree add`，不要共用同一份工作树。

- **禁止在共享工作区跑 `git stash`**。不带 pathspec 的 `git stash push` 会把**别人**未提交的改动一起收走，`pop` 时冲突且很难判断谁丢了什么。要隔离验证就用 `git worktree add --detach <path> HEAD`（可再把 `node_modules` 软链进去）。
- **禁止 `git add -A` / `git add .` / `git commit -a`**。`workspace/` 下混有运行时产物，全量 add 会把它们卷进提交。只用显式路径列举本轮文件。
- 提交前先看 `git status`：出现不属于本轮的文件，说明有并行写入者，**不要一起提交，也不要 `git checkout -- .` 或 `git clean -fd`**。
- 同一文件被两个会话改过时，以**跑通测试的合并态**为准，并逐个核对两侧意图都还在。
- 收口时不要把 `workspace/` 里的运行时产物一起提交：其真相源在 `src/lawmind/skills/builtin/*.md` 与 `src/lawmind/agent/collaboration/*-templates.ts`。
- **别让 `markdownlint-cli2 --fix` 按 globs 跑全量**。`.markdownlint-cli2.jsonc` 的 `globs` 是 `docs/**/*.md`，所以「只修一个文件」的调用会**改写仓库里每一篇 docs**；并发时这就等于把别人的 doc 改动一起改掉，随后很容易被 `git checkout --` 连人带己丢掉（**已真实发生过一次**）。要改单篇：显式传路径并确认只动了那一篇，或者先 `--no-globs`（或在受控 worktree 里跑）。

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

## Product UI (this machine only)

The product UI is the **local Electron desktop app** on this computer. There is no web or cloud workbench. Never open Vite (`http://127.0.0.1:5174`), the docs site, or a browser tab as LawMind. To open: the installed `LawMind.app`, or `pnpm lawmind:desktop` in development. Playwright specs inject an Electron preload stub; they are tests only.

Desktop scrollbars and text fields: use tokens + `styles/controls.css` only — see **`docs/LAWMIND-DESKTOP-UI-CONTROLS.md`**.

## Build, test, format

- **Node 22+**; install: `pnpm install`
- **Tests:** `pnpm test` (Vitest — `src/lawmind/**/*.test.ts` and LawMind desktop tests)
- **Desktop typecheck:** `pnpm --filter lawmind-desktop typecheck`
- **Bundle local server:** `pnpm lawmind:bundle:desktop-server`
- **Docs site:** `pnpm lawmind:docs:build`
- **Pre-commit** (if enabled): Oxlint + Oxfmt via `git-hooks/pre-commit` and `scripts/pre-commit/`

## Agent loop admission (true-loop cassette)

When changing `turn-orchestrator*`, clarification gates, compact, steer, playbook tool locks, or the approval pipeline, **add a cassette** in `src/lawmind/agent/turn-orchestrator-cassettes.test.ts`. Do not assert that a Chinese sentence still exists in the system prompt.

Contract (Codex `test_codex`, tightened for LawMind gates):

1. Model bytes are fake (scripted JSON / SSE).
2. `runTurn`, the tool table (production names), gates, approval, compact, and steer are real.
3. Assert the **next request body** sent to the model: a tool is / is not advertised, history was rewritten, citations survived compact, steer landed in the next sample.
4. Exhausting the cassette must fail (HTTP 400). Do not silently invent a closing assistant message.

Entry: `TestLawMind.builder()` (`src/lawmind/agent/testkit/`).

Shadow replay (`src/lawmind/evaluation/shadow-engine-replay.ts`) remains **deliverable / lint recall** regression. It is not the admission ticket for orchestrator changes.

Assembler unit tests may only assert: section ids, cache-boundary hashes, and dynamically injected values (lawyer name, 法宝 provider). They must not assert “this sentence is still in the prompt.”

## Code style

- **TypeScript (ESM)**, strict; avoid `any` unless unavoidable.
- Match existing patterns in the file you edit; avoid drive-by refactors outside the request.
- Colocate tests as `*.test.ts` next to implementation.

## Automation note

Some **`.github/workflows`** (labeler, stale, CodeQL) may still assume a larger monorepo. If a workflow fails on paths that no longer exist, narrow or disable that job rather than re-introducing OpenClaw trees.
