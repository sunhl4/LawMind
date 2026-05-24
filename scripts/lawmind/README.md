# LawMind CLI & ops scripts

Executable entrypoints for `pnpm lawmind:*` live here. **Hooks** and shared helpers stay in `scripts/pre-commit/`.

- `.ts` files are run with `node --import tsx …` (see root `package.json`).
- `.mjs` files are plain Node ESM.
- `lawmind-backup.sh` — optional workspace tarball; set `LAWMIND_WORKSPACE_DIR`.
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
