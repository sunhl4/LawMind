# Contributing to LawMind

Thanks for helping improve LawMind. This tree is **intentionally small**: the engine (`src/lawmind`), the desktop app (`apps/lawmind-desktop`), and the docs site (`apps/lawmind-docs`).

## Before you start

- Read **`AGENTS.md`** (commands, paths, style).
- Read **`docs/LAWMIND-REPO-LAYOUT.md`** for directory roles and what not to commit.
- Read **`GOALS.md` §二**（产品原则现行口径）if you change product-visible behavior; historical narrative: `docs/archive/LAWMIND-VISION.md`.
- For security-sensitive changes, read **`SECURITY.md`**.

## Development

```bash
pnpm install
pnpm test
pnpm typecheck                              # engine + scripts
pnpm --filter lawmind-desktop typecheck   # after UI/server TS changes
pnpm lawmind:desktop                         # Electron + Vite dev
pnpm lawmind:docs:dev                       # optional: VitePress
```

## Before you open a PR

```bash
pnpm lawmind:verify
pnpm lawmind:desktop:e2e:pr   # Playwright smoke + golden-path + matter-cockpit (mock API)
```

`lawmind:verify` mirrors the main CI `verify` job (tests, server bundle, desktop typecheck, HTTP smoke). PR CI also runs `lawmind:desktop:e2e:pr` in the `desktop-e2e-mock` job. See **`docs/lawmind/DEVELOPER-WORKFLOW.md`** for the full script ↔ CI map.

For Playwright locally, copy `apps/lawmind-desktop/.env.example` to `.env.e2e` if missing.

Optional for larger changes:

```bash
pnpm lawmind:multitask:validate
pnpm lawmind:env:check -- --strict
pnpm lawmind:desktop:e2e:electron   # weekly / release; needs bundle + renderer build
```

## File size guidelines (Phase 12)

Keep new code reviewable; split before adding large features:

| Area                            | Soft max lines |
| ------------------------------- | -------------- |
| Desktop renderer components     | 800            |
| Agent tool modules              | 600            |
| Desktop server route files      | 500            |
| Agent `runtime.ts` orchestrator | 900            |

Existing oversized files are being split incrementally—do not grow them without a seam PR.

## Pull requests

- Keep changes scoped; follow existing patterns in the files you touch.
- Add or update **tests** when fixing bugs or adding engine behavior (`*.test.ts`).
- Run **`pnpm test`** before submitting.

## Licensing

By contributing, you agree your contributions are licensed under the same terms as the repository (**see `LICENSE`**).
