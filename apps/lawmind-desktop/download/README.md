# LawMind 下载落地页

`index.html` 为**纯静态页**：读取 GitHub `releases/latest`，列出 LawMind 安装包，并按浏览器推断的 OS / 架构高亮「推荐」行。

## 正式对外 URL

**`https://docs.lawmind.ai/download/`**

随产品文档站（VitePress）发布：`pnpm lawmind:docs:build` 时由 `apps/lawmind-docs/scripts/sync-docs.mjs` 从本文件复制到 `docs/.vitepress/public/download/`。

桌面应用默认打开同一地址（`LAWMIND_DOWNLOAD_PAGE_URL` / `VITE_LAWMIND_DOWNLOAD_PAGE_URL` 可覆盖）。

## 其他托管方式

1. **企业自托管** — 将本目录放到 HTTPS 站点即可；无需构建。
2. **指定 GitHub 仓库** — `?repo=组织名/仓库名`（fork 后的 Release）。
3. **jsDelivr 镜像（备用）** —  
   `https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html`  
   仅作未部署文档站时的临时通道；对外宣传请用正式域名。

## 与应用内「检查更新」的关系

- **本页**：首次安装、换机、批量分发链接。
- **应用内更新**：同一 GitHub Release 上的 `latest.yml` / `latest-mac.yml` / `latest-linux.yml`（见 `../RELEASE-CHECKLIST.md`）。
