# LawMind 产品文档站（VitePress）

对外产品站与手册：首页面向律师与客户采购，侧栏手册/交付/合规优先；工程深潜默认折叠。

## 与主仓文档的关系

- **内容源**：仓库根目录 `docs/LAWMIND-*.md` 与 `docs/lawmind/**`（单一事实来源）。
- **本站**：`pnpm run sync` 复制到本目录 `docs/` 后由 VitePress 构建；**请改根目录 `docs/`，不要只改同步产物**。
- 首页 `docs/index.md` 与 `.vitepress/` 主题为本站自有，不同步覆盖。

## 本地开发

仓库根目录：

```bash
pnpm install
pnpm lawmind:docs:dev
```

或在 `apps/lawmind-docs` 执行 `pnpm dev`。默认 <http://localhost:5173>。

## 构建与预览

```bash
pnpm lawmind:docs:build
pnpm lawmind:docs:preview
```

产物：`apps/lawmind-docs/docs/.vitepress/dist`。

桌面应用「帮助」默认打开 `https://docs.lawmind.ai`；下载页为 `https://docs.lawmind.ai/download/`（可用 `VITE_LAWMIND_*` / `LAWMIND_DOWNLOAD_PAGE_URL` 覆盖）。构建时会把 `apps/lawmind-desktop/download/index.html` 同步到本站 `/download/`。
