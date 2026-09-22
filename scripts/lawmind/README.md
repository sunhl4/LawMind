# LawMind CLI & ops scripts

Executable entrypoints for `pnpm lawmind:*` live here. **Hooks** and shared helpers stay in `scripts/pre-commit/`.

- `.ts` files are run with `node --import tsx …` (see root `package.json`).
- `.mjs` files are plain Node ESM.
- `lawmind-backup.sh` — optional workspace tarball; set `LAWMIND_WORKSPACE_DIR`.
- `lawmind-daemon.ts` — local automations daemon (`pnpm lawmind:daemon -- status|start|stop`).
- `lawmind-decision-samples.ts` — 决策语料导出（第二十期 P0/P2/P3）：把逃逸/指标/事件/质量/拍板信号归一成可编译语料 + 数据体检报告；同时打印**三路径分歧 shadow 摘要**（P2.3）、**改稿范例库**（素材通道，含将注入 prompt 的块）与 **firm-specific 校准器状态**（P3，含冷启动拒绝理由）。`--dry-run` 只看报告不写盘；`--json` 出机器可读报告。
- `lawmind-round.ts` — **影子演练：跑一轮真实办件**（第二十期 P0–P5 的燃料生成器）。跑真实引擎链路（plan → confirm → research → draft → review），三种交办产齐 `lint_findings` / `lawyer_edit` / 零写入三种结果，并现场探测规则盲区与误报。产物落 `workspace/rounds/<日期>-<slug>/`（已 gitignore），随后用 `lawmind:decision-samples --workspace <该目录>` 读取。**产物是演练数据，不能用来估规则覆盖率**——工作区根写入的 `.lawmind-drill.json` 会自证这一点，`decision-samples` 据此标 `drill: true` 并出 warning。
- `lawmind-local-token.ts` — 本机 API 的 **CLI 凭据读取器**（`pnpm lawmind:local:token`；`--json` / `--status`）。从桌面端写出的 `0600` 发现文件取凭据。**cli 身份只读**（`GET`/`HEAD`/`OPTIONS`），写操作由服务端 403。模型、轮换与吊销见 `docs/lawmind/LAWMIND-LOCAL-API-AUTH.md`。
- `lawmind-skill-census.ts` — repeatable GitHub legal-skill census (`pnpm lawmind:skills:census`; `--fetch` needs `gh`).
- `lawmind-multitask-validate.ts` — commercial-grade baseline validation pass (platform contracts + guardrail + audit + functional + UI + observability + DoD report).
- `lawmind-multitask-guardrail-check.ts` — template guardrail check with structured `guardrail-*.json|md` report.
- `lawmind-multitask-audit.ts` — nine-part checklist audit with `audit-matrix-*.json|md` report.
- `lawmind-multitask-observability.ts` — windowed metrics report (`observability-*.json|md`).
- `lawmind-multitask-decision.ts` — task-first/workspace-first decision output (`decision-*.json|md`).

## Multitask Commands (repo root)

- `pnpm lawmind:multitask:validate` — baseline checks and release-ready decision.
- `pnpm lawmind:multitask:validate:strict` — baseline plus Playwright and audit `--strict` (package.json runs the validate script with `--with-playwright --strict`).
- `pnpm lawmind:multitask:guardrail` — enforce request/contract boundary fields.
- `pnpm lawmind:multitask:audit -- --strict` — fail if any checklist item is not `已满足`.
- `pnpm lawmind:multitask:observability -- --window-days 14` — generate 14-day metrics.
- `pnpm lawmind:multitask:decision -- --task-complexity 4 --workspace-volatility 2 --dependency-density 3 --acceptance-pressure 4 --context-isolation 4` — record mode recommendation.

The bundled desktop server imports `lawmind-env-loader.ts` via a repo-relative path from `apps/lawmind-desktop/server/`.
