# LawMind 下载落地页

`index.html` 为**纯静态页**：通过 GitHub API 读取 `releases/latest`，列出含 `LawMind` 的安装包，并根据浏览器推断的 **OS / 架构**高亮一行「推荐」下载。

## 如何托管给客户

1. **jsDelivr（公开仓库默认可用）**  
   `https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html`  
   更新随 default branch 走；发版后若需固定在某次 commit，把 URL 中的 `@main` 换成 `@<commit-sha>`。

2. **企业自托管**  
   将本目录放到 HTTPS 站点即可；无需构建。

3. **指定 GitHub 仓库**  
   查询参数：`?repo=组织名/仓库名`（例如你们 fork 后的仓库）。Release 中资源需为 LawMind 构建产物（文件名含 `LawMind`）。

## 与应用内「检查更新」的关系

- **本页**：适合首次安装、手动换机、企业批量分发链接。  
- **应用内更新**：依赖同一 GitHub Release 上的 `latest.yml` / `latest-mac.yml` / `latest-linux.yml` 等（由 `electron-builder` 生成，发布时需随二进制一并上传）。详见 `../RELEASE-CHECKLIST.md`。
