# Renderer CSS modules

Foundation tokens and large workbench surfaces are `@import`ed from the top of `styles.css`.

**desk-layout**, **shell-header**, **chat**, **modal-forms**, and **workflow-hub** are **inlined** into `styles.css` at fixed cascade positions (search for `/* ── imported:` markers). They must not be `@import`ed at the file top — that breaks layout order and caused the 2026-06 UI regression.

**controls.css**（滚动条 + 表单控件）在文件顶与 `tokens.css` 一并 `@import`。约定见 [`docs/LAWMIND-DESKTOP-UI-CONTROLS.md`](../../../../docs/LAWMIND-DESKTOP-UI-CONTROLS.md)。

## Editing workflow

1. Change the source file in this directory (e.g. `desk-layout.css`).
2. Run from repo root: `pnpm lawmind:sync:renderer-css`
3. Verify: `pnpm --filter lawmind-desktop build:renderer`
