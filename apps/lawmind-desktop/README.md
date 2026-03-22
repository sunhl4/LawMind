# LawMind Desktop (Electron)

Windows / macOS shell for LawMind: in-app chat with the legal agent, task list, and delivery history. The local API binds **127.0.0.1** only.

## End users (packaged app)

If you received a **zip** (macOS `.app`) or **portable / installer** (Windows):

- **No separate Node.js install is required** — the build vendors an official Node binary under `Resources/node-runtime/` and uses it to run the bundled `lawmind-local-server.cjs`.
- Unzip or install, open the app, complete the **setup wizard** (API Key, optional Base URL/model/workspace).
- macOS unsigned test builds: use **Right-click → Open** the first time if Gatekeeper blocks the app. For wide distribution, the `.app` and embedded `node` must be **code-signed and notarized** (see <https://docs.openclaw.ai/LAWMIND-DELIVERY> §6).

**Advanced:** set `LAWMIND_NODE_BIN` to force a different Node executable.

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

This starts Vite on port **5174** and Electron. Use the **Electron** window only; opening `http://127.0.0.1:5174` in a normal browser shows “Preload bridge missing” (no `contextBridge`). Optional: create `.env.development.local` in `apps/lawmind-desktop` with `VITE_LAWMIND_DEV_API=http://127.0.0.1:<lawmind-server-port>` if you need to tweak the UI in a browser while the local server runs elsewhere.

The main process resolves the monorepo root (must contain `openclaw` `package.json`). Override with:

```bash
LAWMIND_REPO_ROOT=/path/to/openclaw pnpm dev
```

## Package / portable builds

From this directory:

```bash
pnpm run dist:electron
```

This runs:

1. `pnpm bundle:server` — esbuild → `server/dist/lawmind-local-server.cjs`
2. `pnpm vendor:node` — downloads Node for the **current** OS/arch into `resources/node-runtime/<platform-arch>/` (see [resources/node-runtime/README.md](resources/node-runtime/README.md))
3. `vite build`
4. `electron-builder` — outputs under `release/`:
   - **macOS:** `dmg` + **`zip`** (green: unzip `LawMind.app` and run)
   - **Windows:** `nsis` + **`portable`**

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

- <https://docs.openclaw.ai/LAWMIND-DELIVERY>
- <https://docs.openclaw.ai/LAWMIND-USER-MANUAL>
- <https://docs.openclaw.ai/LAWMIND-PROJECT-MEMORY>
