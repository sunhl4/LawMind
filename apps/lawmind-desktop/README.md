# LawMind Desktop (Electron)

Windows / macOS shell for LawMind: tasks, matters, review, chat with the legal agent, and delivery history. The local API binds **127.0.0.1** only.

**Product intent:** This app is **not** a Word replacement or a generic LLM chat window. It is a **lawyer workbench** for task-driven work: clarify intent, use workspace/project files, call into the local OS where appropriate (for example open a document in the system default app or reveal a path in the file manager), and drive toward **reviewable deliverables**—not maximum chat volume. See <https://docs.lawmind.ai/archive/LAWMIND-VISION> (section **6.2d**).

## End users (packaged app)

If you received a **zip** (macOS `.app`) or **portable / installer** (Windows):

- **No separate Node.js or officecli install is required** — the build vendors an official Node binary under `Resources/node-runtime/` and OfficeCLI under `Resources/officecli/` (Apache-2.0). The local server uses them for the API and Word 修订轨 / 改稿.
- **Chat answers render Markdown tables and LaTeX in the app** — KaTeX ([GitHub](https://github.com/KaTeX/KaTeX), MIT; same engine Codex App / VS Code preview use) is a locked desktop dependency and is folded into the release renderer. No Marketplace plugin or extra config. See `src/renderer/vendor/katex/`.
- Unzip or install, open the app, complete the **setup wizard** (API Key, optional Base URL/model/workspace).
- macOS: a **Developer ID + notarized** build double-clicks after download. Unsigned/adhoc test builds still need **Right-click → Open** the first time (see <https://docs.lawmind.ai/LAWMIND-DELIVERY> §6).

**Advanced:** set `LAWMIND_NODE_BIN` to force a different Node executable.

**End users (简体中文):** 安装与系统说明见同目录 [**INSTALL.md**](./INSTALL.md)；对外发布前团队自查见 [**RELEASE-CHECKLIST.md**](./RELEASE-CHECKLIST.md)；macOS 签名 / 公证 / GitHub Secrets 的完整操作见 [**SIGNING-NOTARIZATION.md**](./SIGNING-NOTARIZATION.md)。**智能下载页**（按浏览器推断系统并高亮推荐包）：[docs.lawmind.ai/download](https://docs.lawmind.ai/download/)（源文件 [`download/index.html`](./download/index.html)；`?repo=组织/仓库` 可指向贵司 GitHub Release）。

## 终端用户：更新与下载页

- 菜单 **帮助 → 检查更新 / 下载安装包**；**设置** 底部 **应用更新** 亦提供入口。
- 左下角账号行（侧栏底部 **LawMind** 行）在有更新时点亮金色 **「更新」** 药丸（Cursor 同款）：发现新版后台自动下载时显示 `更新 NN%`，下载就绪后点击 → 确认 **「立即重启安装」**；不点也没关系，退出应用时会自动装上新版本。
- 打包版默认通过 **GitHub Release** 做应用内更新（`electron-updater`），须与 `package.json` 里 `build.publish` 的仓库一致；企业可用 **`LAWMIND_SKIP_AUTO_UPDATE=1`** 关闭自动检查，**`LAWMIND_DOWNLOAD_PAGE_URL`** 自定义下载落地页。

## Prerequisites (developers)

- Clone the monorepo and `pnpm install` from the repo root.
- **Node.js 22+** on `PATH` for **dev** (`tsx` + `lawmind-local-server.ts`).
- If you see **Electron failed to install correctly** (pnpm v10 may skip `postinstall` until approved): from the **repo root** run `pnpm install` again (runs `postinstall` → `scripts/lawmind/lawmind-electron-rebuild.mjs`) or `pnpm approve-builds` and allow `electron`, then reinstall.

## Develop

From repo root:

```bash
pnpm lawmind:desktop
```

Or from this directory:

```bash
pnpm dev
```

This starts Vite on port **5174** as the **Electron renderer** and opens the desktop window. There is no web workbench: opening `http://127.0.0.1:5174` in a browser is not supported. End users download and open the packaged LawMind app.

Dock 名称 / 系统图标 / 应用内 LM 标的更换入口见 [**BRANDING.md**](./BRANDING.md)（`pnpm lawmind:desktop:brand`）。

### E2E (Playwright)

From repo root (after `pnpm install`):

```bash
pnpm --filter lawmind-desktop test:e2e:install   # once: Chromium for Playwright
pnpm lawmind:desktop:e2e
```

This starts a mock API plus Vite (test bundler only) and runs `apps/lawmind-desktop/e2e/*.spec.ts` against an **Electron preload stub**. It is not a shipped web UI.

The main process resolves the monorepo root (must contain the workspace `package.json` named `lawmind` or legacy `openclaw`). Override with:

```bash
LAWMIND_REPO_ROOT=/path/to/lawmind pnpm dev
```

## Package / portable builds

From **repo root** (推荐，与 CI 一致):

```bash
pnpm lawmind:desktop:dist
```

macOS 要同时覆盖 Apple 芯片与 Intel（内测分发基本都要）：

```bash
pnpm lawmind:desktop:dist:mac:both   # release/mac-arm64 + release/mac（Intel），一次生成 latest-mac.yml
```

或在本目录：

```bash
pnpm run dist:electron
```

This runs:

1. `pnpm bundle:server` — esbuild → `server/dist/lawmind-local-server.cjs`
2. `pnpm vendor:node` — downloads Node for the **current** OS/arch into `resources/node-runtime/<platform-arch>/` (see [resources/node-runtime/README.md](resources/node-runtime/README.md)); `--arch arm64|x64` 可交叉 vendoring
3. `pnpm vendor:officecli` — downloads OfficeCLI for the **current** OS/arch into `resources/officecli/<platform-arch>/` (see [resources/officecli/README.md](resources/officecli/README.md)); 同样支持 `--arch`
4. `vite build`
5. `node scripts/assert-vendored-runtimes.mjs` — 目标架构的运行时必须在场且架构匹配（electron-builder 在 `extraResources` 源目录缺失时只 warn，这里改成硬失败）
6. `electron-builder` — outputs under `release/`，文件名含 **版本与 os-arch**（`artifactName`）：
   - **macOS:** `dmg` + **`zip`**（解压后得到 `LawMind.app`）；`dist:electron:mac:both` 一次出 `mac-arm64` + `mac`（Intel）两个 `.app`，dmg/zip 文件名才是 `-mac-arm64` / `-mac-x64`
   - **Windows:** `nsis` 安装包 + **`portable`** 绿色版 + **`zip`**
   - **Linux (x64):** **`AppImage`** + **`tar.gz`**（解压即用目录）

CI：推送 tag `lawmind-desktop-v*` 或手动运行 [LawMind desktop build](../../.github/workflows/lawmind-desktop-build.yml) 可在 Windows / macOS / Linux 上各打一份产物并上传为 artifact。

Override vendored Node version:

```bash
LAWMIND_DESKTOP_NODE_VERSION=22.14.0 pnpm -w lawmind:vendor:desktop-node
LAWMIND_OFFICECLI_VERSION=1.0.149 pnpm -w lawmind:vendor:officecli
```

## 内置模型凭据（开箱即用）

发给律师的安装包可以随包带一份 provider key，让「双击安装 → 直接对话」成立。

```bash
# 在本目录（apps/lawmind-desktop）生成，产物不入库
pnpm run defaults:write -- --deepseek sk-xxxxxxxxxxxxxxxx

# 只看这次打包会带上哪些（不打值）
pnpm run defaults:check
```

- 产物是 `resources/defaults/provider-defaults.json`（`chmod 600`，已在 `.gitignore` 排除）。**不要提交**：安装包里的同一份文件任何下载者都能解出来，写进 git 等于直接公开。
- electron-builder 通过 `extraResources` 把它复制到 **`Resources/defaults/provider-defaults.json`**。
- 启动时 `electron/bundled-provider-defaults.mjs` 只 **填缺口**：系统环境变量、用户 `.env.lawmind`、钥匙串里设置页写入的 key 都优先。律师换成自己的 key 之后，内置那份自动失效。
- 白名单只收 `LAWMIND_PROVIDER_DEEPSEEK_API_KEY` 这类 provider 级名字；`LAWMIND_AGENT_API_KEY` / `LAWMIND_QWEN_API_KEY` 故意不收——它们会改变「默认模型」的解析结果，内置凭据只负责「这个 provider 可用」。
- 排障开关：`LAWMIND_BUNDLED_DEFAULTS_DISABLED=1` 忽略内置凭据；`LAWMIND_BUNDLED_DEFAULTS_FILE=/path/to.json` 指定别的文件。
- `LAWMIND_E2E=1` 下自动忽略内置凭据：Playwright 的 mock provider 靠 `LAWMIND_AGENT_*` 指定，内置 key 在场会让默认模型解析绕过 mock 去打真实 API。
- `dist:electron*` 每个脚本开头都会跑一次 `defaults:check`，构建日志里能直接看到这次是否带 key。

轮换：用新的 key 重跑 `defaults:write`，重新打包；旧包无法远程失效，所以定期换 key 是唯一手段。

## First-run wizard

Writes `userData/LawMind/.env.lawmind` and `desktop-config.json`, then restarts the local API subprocess.

## Multi-assistant (desktop)

- **Assistants** live in `userData/LawMind/assistants.json` (built-in role presets plus custom intro/instructions). Usage counters are in `userData/LawMind/assistant-stats.json`.
- Local HTTP API: `GET/POST/PATCH/DELETE /api/assistants`, `GET /api/assistant-presets`, and `POST /api/chat` accepts `assistantId` (defaults to `default`).
- The default assistant cannot be deleted.

## Web search (optional)

- Main chat footer **检索** dropdown (`仅本地与案件记忆` vs `联网检索（Brave）`) sends `allowWebSearch: true` on `POST /api/chat` and registers the `web_search` tool when enabled.
- Set `LAWMIND_WEB_SEARCH_API_KEY` or `BRAVE_API_KEY` in `LawMind/.env.lawmind`. Health reports `webSearchApiKeyConfigured`; when missing, the UI still allows choosing「联网」并可用「配置联网密钥」打开设置。

## Architecture

- `electron/main.mjs` — window; **dev:** `node --import tsx server/lawmind-local-server.ts` with `cwd` = monorepo root; **packaged:** `resolveNodeExecutable()` + `lawmind-local-server.cjs` with `cwd` beside the CJS file.
- `server/lawmind-local-server.ts` — HTTP API; reuses `src/lawmind` agent.
- `src/renderer` — React UI.

Default workspace: `app.getPath('userData')/LawMind/workspace`.

## Docs

- <https://docs.lawmind.ai/LAWMIND-DELIVERY>
- <https://docs.lawmind.ai/LAWMIND-LAWYER-QUICKSTART>
- <https://docs.lawmind.ai/archive/LAWMIND-USER-MANUAL>
- <https://docs.lawmind.ai/LAWMIND-FUTURE-ISSUES>
