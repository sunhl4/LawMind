# LawMind Desktop (Electron)

Windows / macOS shell for LawMind: tasks, matters, review, chat with the legal agent, and delivery history. The local API binds **127.0.0.1** only.

**Product intent:** This app is **not** a Word replacement or a generic LLM chat window. It is a **lawyer workbench** for task-driven work: clarify intent, use workspace/project files, call into the local OS where appropriate (for example open a document in the system default app or reveal a path in the file manager), and drive toward **reviewable deliverables**—not maximum chat volume. See <https://docs.lawmind.ai/LAWMIND-VISION> (section **6.2d**).

## End users (packaged app)

If you received a **zip** (macOS `.app`) or **portable / installer** (Windows):

- **No separate Node.js install is required** — the build vendors an official Node binary under `Resources/node-runtime/` and uses it to run the bundled `lawmind-local-server.cjs`.
- Unzip or install, open the app, complete the **setup wizard** (API Key, optional Base URL/model/workspace).
- macOS unsigned test builds: use **Right-click → Open** the first time if Gatekeeper blocks the app. For wide distribution, the `.app` and embedded `node` must be **code-signed and notarized** (see <https://docs.lawmind.ai/LAWMIND-DELIVERY> §6).

**Advanced:** set `LAWMIND_NODE_BIN` to force a different Node executable.

**End users (简体中文):** 安装与系统说明见同目录 [**INSTALL.md**](./INSTALL.md)；对外发布前团队自查见 [**RELEASE-CHECKLIST.md**](./RELEASE-CHECKLIST.md)。**智能下载页**（按浏览器推断系统并高亮推荐包）见 [`download/index.html`](./download/index.html)（可经 jsDelivr/内网托管；`?repo=组织/仓库` 指向贵司 GitHub Release）。

## 终端用户：更新与下载页

- 菜单 **帮助 → 检查更新 / 下载安装包**；**设置** 底部 **应用更新** 亦提供入口。
- 打包版默认通过 **GitHub Release** 做应用内更新（`electron-updater`），须与 `package.json` 里 `build.publish` 的仓库一致；企业可用 **`LAWMIND_SKIP_AUTO_UPDATE=1`** 关闭自动检查，**`LAWMIND_DOWNLOAD_PAGE_URL`** 自定义下载落地页。

## Prerequisites (developers)

- Clone the monorepo and `pnpm install` from the repo root.
- **Node.js 22+** on `PATH` for **dev** (`tsx` + `lawmind-local-server.ts`).
- If you see **Electron failed to install correctly** (pnpm v10 may skip `postinstall` until approved): from the **repo root** run `pnpm rebuild electron` (or `pnpm approve-builds` and allow `electron`, then `pnpm install` again). Root script: `pnpm rebuild:electron`.

## Develop

From repo root:

```bash
pnpm lawmind:desktop
```

Or from this directory:

```bash
pnpm dev
```

This starts Vite on port **5174** and Electron. Use the **Electron** window only; opening `http://127.0.0.1:5174` in a normal browser shows “Preload bridge missing” (no `contextBridge`). Optional: create `.env.development.local` in `apps/lawmind-desktop` with `VITE_LAWMIND_DEV_API=http://127.0.0.1:<lawmind-server-port>` to point the UI at a running LawMind API when the Electron preload bridge is absent (browser dev or Playwright E2E).

### E2E (Playwright)

From repo root (after `pnpm install`):

```bash
pnpm --filter lawmind-desktop test:e2e:install   # once: Chromium for Playwright
pnpm lawmind:desktop:e2e
```

This starts a tiny mock API plus Vite dev with `VITE_LAWMIND_DEV_API` and runs `apps/lawmind-desktop/e2e/*.spec.ts`.

The main process resolves the monorepo root (must contain the workspace `package.json` named `lawmind` or legacy `openclaw`). Override with:

```bash
LAWMIND_REPO_ROOT=/path/to/lawmind pnpm dev
```

## Package / portable builds

From **repo root** (推荐，与 CI 一致):

```bash
pnpm lawmind:desktop:dist
```

或在本目录：

```bash
pnpm run dist:electron
```

This runs:

1. `pnpm bundle:server` — esbuild → `server/dist/lawmind-local-server.cjs`
2. `pnpm vendor:node` — downloads Node for the **current** OS/arch into `resources/node-runtime/<platform-arch>/` (see [resources/node-runtime/README.md](resources/node-runtime/README.md))
3. `vite build`
4. `electron-builder` — outputs under `release/`，文件名含 **版本与 os-arch**（`artifactName`）：
   - **macOS:** `dmg` + **`zip`**（解压后得到 `LawMind.app`）
   - **Windows:** `nsis` 安装包 + **`portable`** 绿色版 + **`zip`**
   - **Linux (x64):** **`AppImage`** + **`tar.gz`**（解压即用目录）

CI：推送 tag `lawmind-desktop-v*` 或手动运行 [LawMind desktop build](../../.github/workflows/lawmind-desktop-build.yml) 可在 Windows / macOS / Linux 上各打一份产物并上传为 artifact。

Override vendored Node version:

```bash
LAWMIND_DESKTOP_NODE_VERSION=22.14.0 pnpm -w lawmind:vendor:desktop-node
```

## First-run wizard

Writes `userData/LawMind/.env.lawmind` and `desktop-config.json`, then restarts the local API subprocess.

## Multi-assistant (desktop)

- **Assistants** live in `userData/LawMind/assistants.json` (built-in role presets plus custom intro/instructions). Usage counters are in `userData/LawMind/assistant-stats.json`.
- Local HTTP API: `GET/POST/PATCH/DELETE /api/assistants`, `GET /api/assistant-presets`, and `POST /api/chat` accepts `assistantId` (defaults to `default`).
- The default assistant cannot be deleted.

## Web search (optional)

- UI checkbox **允许联网检索** sends `allowWebSearch: true` on `POST /api/chat` and registers the `web_search` tool (Brave).
- Set `LAWMIND_WEB_SEARCH_API_KEY` or `BRAVE_API_KEY` in `LawMind/.env.lawmind`. Health reports `webSearchApiKeyConfigured`.

## Architecture

- `electron/main.mjs` — window; **dev:** `node --import tsx server/lawmind-local-server.ts` with `cwd` = monorepo root; **packaged:** `resolveNodeExecutable()` + `lawmind-local-server.cjs` with `cwd` beside the CJS file.
- `server/lawmind-local-server.ts` — HTTP API; reuses `src/lawmind` agent.
- `src/renderer` — React UI.

Default workspace: `app.getPath('userData')/LawMind/workspace`.

## Docs

- <https://docs.lawmind.ai/LAWMIND-DELIVERY>
- <https://docs.lawmind.ai/LAWMIND-USER-MANUAL>
- <https://docs.lawmind.ai/LAWMIND-PROJECT-MEMORY>
