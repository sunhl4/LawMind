# Renderer CSS modules

Foundation tokens and large workbench surfaces are `@import`ed from the top of `styles.css`.

**desk-layout**, **shell-header**, **chat**, **modal-forms**, and **workflow-hub** are **inlined** into `styles.css` at fixed cascade positions (search for `/* ── imported:` markers). They must not be `@import`ed at the file top — that breaks layout order and caused the 2026-06 UI regression.

## Editing workflow

1. Change the source file in this directory (e.g. `desk-layout.css`).
2. Run from repo root: `pnpm lawmind:sync:renderer-css`
3. Verify: `pnpm --filter lawmind-desktop build:renderer`
