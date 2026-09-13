# LawMind 桌面品牌（名称 + 图标）

下次要换名字或图标，**不要到处搜**。改下面这份清单，然后跑一次：

```bash
pnpm lawmind:desktop:brand
```

开发态再 **⌘Q 后重新** `pnpm lawmind:desktop`（正在跑的 Electron 不会热更新 Dock 名和图标）。

正式安装包还要再打一次：`pnpm lawmind:desktop:dist`。

## 单一入口

| 用途 | 路径 |
| --- | --- |
| 产品名 / appId / 图标相对路径 / SVG 副本列表 | `branding/manifest.json` |
| 运行时读 manifest（窗口标题、Dock、通知、About） | `electron/brand.mjs` |
| 一次同步 SVG、生成 icns/ico、给开发用 `Electron.app` 换皮 | `scripts/lawmind/apply-desktop-brand.mjs` |

换图标：替换 `build/icon.png`（建议 1024×1024，透明圆角），再跑 `pnpm lawmind:desktop:brand`。脚本会重做 `build/icon.icns`、`build/icon.ico`、`electron/icon.png`，并同步 `manifest.json` 里的 SVG 副本。

换名字：改 `branding/manifest.json` 的 `productName`，并改 `package.json` 的 `build.productName`（须一致），再跑品牌脚本。

## 系统壳（用户看得见的 Electron / OS）

这些才是「鼠标悬停叫 Electron」「隐藏后图标变回原子」的来源。开发态跑的是 `node_modules` 里的 `Electron.app`，**必须改这个包**，只改 `BrowserWindow({ icon })` 不够。

| 表面 | 开发态谁负责 | 打包态谁负责 |
| --- | --- | --- |
| Dock 悬停名称 | `apply-desktop-brand` 写 `Electron.app` 的 `CFBundleName` / `CFBundleDisplayName` + `app.setName` | electron-builder `productName` |
| Dock / 隐藏后的磁贴 / 台前调度 | 同上，覆盖 `electron.icns` | `build/icon.icns` → `LawMind.app` |
| ⌘⇥ 切换器、Mission Control | 同上（读 **包图标**，不是 `dock.setIcon`） | 同上 |
| 菜单栏左上角应用名、关于面板 | `applyProductName`（`electron/brand.mjs`） | 同上 |
| 窗口标题、辅助窗口 | `LAWMIND_PRODUCT_NAME` + `electron/icon.png` | 同左 |
| 通知默认标题与图标 | `electron/ipc-handlers.mjs` | 同左；macOS 仍优先用包图标 |
| 对话框标题 | `electron/app-menu.mjs`、`electron/local-server.mjs` | 同左 |
| Activity Monitor 里的 Helper | 开发态把 Helper 的 DisplayName 改成 `LawMind Helper*` | electron-builder 会重命名 Helper |
| Windows 任务栏 / `.exe` 图标 | 开发态仍是 `electron.exe`（本脚本不改 PE 资源） | `build/icon.ico` |
| Linux 启动器 | 开发态无 `.desktop` | `build/icon.png` |
| 已解压的本机 `release/mac-arm64/LawMind.app` | 品牌脚本不自动改；下次 `dist` 会带上。应急可把 `build/icon.icns` 拷进 `Contents/Resources/electron.icns` | `dist` |

**不要改开发态 `CFBundleIdentifier`（`com.github.Electron`）。** 改了会把 `userData` 迁走。`pinDevUserData` 把未打包数据钉在 `Application Support/Electron/LawMind`。

## 应用内 UI

| 表面 | 文件 |
| --- | --- |
| 侧栏产品名旁的 LM 标 | `src/renderer/app/LawmindBrandMark.tsx`（侧栏 `LawmindAppSidebar.tsx` 引用） |
| 对话空状态标 | 同上，由 `lawmind-chat-messages-column.tsx` 引用 |
| 矢量稿 / favicon | `src/renderer/assets/lawmind-mark.svg` → 副本见 manifest `svgCopies`（含文档站 favicon） |
| 启动页 `<title>` | `src/renderer/index.html` |

空状态里的文件夹 emoji、设置齿轮等是功能图标，不是品牌标，不用跟这次一起换。

## 打包配置（改名时一起对）

- `apps/lawmind-desktop/package.json` → `build.productName` / `build.appId` / `build.icon` / `mac.icon` / `win.icon` / `linux.icon`
- `electron/after-pack-mac.mjs`、`electron/after-all-artifact-build-mac.mjs`（`LawMind.app` 文件名）
- 下载页文案：`download/index.html`（产品名是正文，不是 Dock）

## 刻意不改

- 用户数据目录名 `Electron`（见上）
- 开发态可执行文件仍叫 `Electron`（改可执行名会拆掉 pnpm 的 Electron 启动路径）
- Chromium / Electron 许可文件
