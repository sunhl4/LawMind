# LawMind Desktop — 对外发布前检查单

面向「像商业软件一样：选终端 → 下载 → 解压/安装 → 即用」的交付。打包命令见 [README.md](./README.md)。

## 构建与产物

- [ ] 版本号已更新：`apps/lawmind-desktop/package.json` 的 `version`。
- [ ] 分别在 **Windows x64**、**macOS（目标架构）**、**Linux x64** 上执行 `pnpm lawmind:desktop:dist`（或 CI 矩阵），确认 `apps/lawmind-desktop/release/` 下产物齐全：
  - Windows：`nsis`、`portable`、`.zip`
  - macOS：`dmg`、`zip`（内含 `.app`）
  - Linux：`AppImage`、`tar.gz`
- [ ] 文件名含 **版本 + os + arch**（`artifactName` 已配置）。
- [ ] 在干净虚拟机或新用户下 **安装包与 zip 解压版各测一条**：能打开向导、能连上本地服务、能发一条对话。

## 安全与信任

- [ ] **macOS**：计划内分发则需 Apple Developer **签名 + notarization**；当前仓库 `identity: null` 为未签名开发构建。
- [ ] **Windows**：计划内分发则 **Authenticode** 签名 `exe` / 安装包。
- [ ] 随发布提供或可索取：**SBOM**（`pnpm lawmind:sbom:cyclonedx`）、已知依赖 CVE 说明（按客户要求）。

## 法务与文档

- [x] 用户可见：**数据处理**、**免责声明**（应用内 + 文档站点）。
- [ ] 客户合同中的责任边界与「非法律意见」表述与产品一致。
- [ ] 对外下载页：**INSTALL.md** 或等效安装说明；含 **智能下载落地页**（`apps/lawmind-desktop/download/index.html`，可经 jsDelivr 或内网托管）及 **`?repo=组织/仓库`** 说明。
- [ ] **文档站**：按需部署 `pnpm lawmind:docs:build` 产物（VitePress，见 `apps/lawmind-docs/README.md`），或继续沿用 `docs.lawmind.ai` 等现有域名策略。

## 支持

- [ ] 明确 **反馈渠道**（邮件/工单/合作伙伴 IT）。
- [ ] **应用内更新**：已在桌面端集成 `electron-updater`（GitHub Release）。发版时除各平台二进制外，须将各次构建产生的 **`latest.yml` / `latest-mac.yml` / `latest-linux.yml`** 及 **`.blockmap`**（若有）一并上传到**同一 GitHub Release**，与 `package.json` 中 `build.publish` 的 `owner/repo` 一致；否则客户端只能用手动下载页升级。
- [ ] 企业可设置环境变量 **`LAWMIND_SKIP_AUTO_UPDATE=1`** 关闭自动检查；自定义下载页 URL：**`LAWMIND_DOWNLOAD_PAGE_URL`**。
