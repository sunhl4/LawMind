# Contributing to LawMind

Thanks for helping improve LawMind. This tree is **intentionally small**: the engine (`src/lawmind`), the desktop app (`apps/lawmind-desktop`), and the docs site (`apps/lawmind-docs`).

## Before you start

- Read **`AGENTS.md`** (commands, paths, style).
- Read **`docs/LAWMIND-REPO-LAYOUT.md`** for directory roles and what not to commit.
- Read **`docs/LAWMIND-VISION.md`** if you change product-visible behavior.
- For security-sensitive changes, read **`SECURITY.md`**.

## Development

```bash
pnpm install
pnpm test
pnpm --filter lawmind-desktop typecheck   # after UI/server TS changes
pnpm lawmind:desktop                         # Electron + Vite dev
pnpm lawmind:docs:dev                       # optional: VitePress
```

## Pull requests

- Keep changes scoped; follow existing patterns in the files you touch.
- Add or update **tests** when fixing bugs or adding engine behavior (`*.test.ts`).
- Run **`pnpm test`** before submitting.

## Licensing

By contributing, you agree your contributions are licensed under the same terms as the repository (**see `LICENSE`**).
