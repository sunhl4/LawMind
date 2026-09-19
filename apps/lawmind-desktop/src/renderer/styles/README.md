# Renderer CSS modules

Foundation tokens and large workbench surfaces are `@import`ed from the top of `styles.css`.

**desk-layout**, **shell-header**, **chat**, **modal-forms**, and **workflow-hub** are **inlined** into `styles.css` at fixed cascade positions (search for `/* ── imported:` markers). They must not be `@import`ed at the file top — that breaks layout order and caused the 2026-06 UI regression.

**controls.css**（滚动条 + 表单控件）在文件顶与 `tokens.css` 一并 `@import`。约定见 [`docs/LAWMIND-DESKTOP-UI-CONTROLS.md`](../../../../docs/LAWMIND-DESKTOP-UI-CONTROLS.md)。

## Editing workflow

1. Change the source file in this directory (e.g. `desk-layout.css`).
2. Run from repo root: `pnpm lawmind:sync:renderer-css`
3. Verify: `pnpm --filter lawmind-desktop build:renderer`

**`styles.css` 是生成物，不是编辑对象。** 直接改 `styles.css` 会在下次同步时被覆盖。

### 两道闸

```bash
pnpm lawmind:check:renderer-css       # 同步标记 + 体积 + 括号平衡（按块）
pnpm lawmind:check:renderer-css-sync  # styles.css 是否与源模块一致（陈旧检测）
```

- 同步脚本按**行号切片**把多个模块拼进一个块（如 `shell-header+chat-main` = `shell-header.css` + `chat.css[136–1194]`）。
  行号会随编辑漂移：**切点必须落在规则边界**。切在规则中间会让前一块少一个 `}`、后一块多一个 `}`。
  同步脚本现在会在写入前校验，拒绝生成不平衡的 `styles.css`，并报出是哪一块、哪一段。
- 改完上游 CSS 若忘了同步，`--check` 会点名是哪一块陈旧（旧检查只查括号/标记/体积，查不出内容陈旧）。
