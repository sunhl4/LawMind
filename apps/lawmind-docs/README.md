# LawMind 文档站（VitePress）

面向**商业交付**的 LawMind 独立文档站点，采用 **[VitePress](https://vitepress.dev/)**（Vite 官方栈，与 Vue 3、Markdown 生态一致，国内国际文档站常见选型）。

## 与主仓文档的关系

- **内容源**：仓库根目录 `docs/LAWMIND-*.md` 与 `docs/lawmind/**`（单一事实来源）。
- **本站**：`pnpm run sync` 将其复制到本目录下的 `docs/`，再运行 VitePress；**请改根目录 `docs/`，不要只改编译产物**。
- 已加入 `.gitignore` 的同步副本路径，避免与 `index.md`、`.vitepress/` 混淆。

## 本地开发

在 **仓库根目录**：

```bash
pnpm install
pnpm lawmind:docs:dev
```

或在 `apps/lawmind-docs`：

```bash
pnpm dev
```

浏览器默认 <http://localhost:5173>（若端口占用以终端为准）。

## 构建与预览

```bash
pnpm lawmind:docs:build
pnpm lawmind:docs:preview
```

产物在 `apps/lawmind-docs/docs/.vitepress/dist`，可部署到 **GitHub Pages / Cloudflare Pages / Vercel / Netlify / 企业 Nginx**。

## 部署建议

| 场景 | 说明 |
|------|------|
| **独立子域** | 如 `lawmind.example.com`，VitePress `base` 保持默认 `/`。 |
| **主站子路径** | 在 `docs/.vitepress/config.mts` 中设置 `base: '/lawmind/'`，并配置托管方重定向。 |

对外 URL 若需与历史一致（如 `docs.lawmind.ai/LAWMIND-USER-MANUAL`），由托管平台把本站 **路由到同名 path** 即可（`cleanUrls` 已开启）。

## CI

仓库含 `.github/workflows/lawmind-docs.yml`，用于在 PR/主干上验证 `pnpm lawmind:docs:build` 可通过。
