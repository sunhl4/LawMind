# Security Policy (LawMind)

If you believe you’ve found a **security vulnerability** in this repository (LawMind engine, desktop shell, or bundled local API), please report it **privately** first so we can fix it before public disclosure.

## Reporting

1. **Preferred:** Open a **private** security advisory on this GitHub repository (Security → Advisories), or email the maintainers if your org uses a different channel.
2. Include the items under **Report contents** below. Reports that are only scanner output without a reproducible path are likely to be deprioritized.

This tree is **LawMind-only** (no OpenClaw gateway, ClawHub, or mobile apps). Do not route reports to legacy OpenClaw contacts unless you are explicitly tracking a fork still aligned with that project.

## Report contents

1. **Title** and short summary
2. **Severity** (your assessment) and **impact** (who is affected, what breaks)
3. **Affected surface** (e.g. `apps/lawmind-desktop/server`, Electron IPC, `src/lawmind` tool policy)
4. **Reproduction** (steps, version/commit, OS)
5. **Environment** (packaged app vs dev, workspace layout if relevant)
6. **Suggested fix** (optional)

## Trust model (short)

LawMind’s desktop **local HTTP API** is intended to bind to **loopback** and to operate on the **lawyer’s workspace** on their machine. Findings that assume full Internet exposure of that API, or that equate “operator can do X locally” with privilege escalation without crossing an unexpected boundary, may be classified as **hardening** rather than a vulnerability—but please report anyway if unsure.

Product-facing security checklists and deployment notes (archived snapshots): **`docs/archive/LAWMIND-SECURITY-CHECKLIST.md`**, **`docs/archive/LAWMIND-DATA-PROCESSING.md`**.

## Hardening notes (local API)

- **Loopback binding**: the desktop local server listens on `127.0.0.1` only; do not reverse-proxy it to the LAN without an explicit security review.
- **Bearer token**: non-dev sessions require `Authorization: Bearer` on `/api/*` (see `lawmind-local-api-auth.ts`). `LAWMIND_SKIP_API_AUTH=1` is for dev/CI only; **packaged builds ignore it** and log a warning.
- **Rate limiting**: token-bucket guard on the loopback server (`lawmind-local-rate-limit.ts`); stats exposed on `GET /api/health` → `doctor.rateLimit`.
- **Secrets**: model and integration keys belong in the OS keychain / host env, not in the workspace git tree. Inspect `doctor.skipApiAuthWarn` and integration health before firm rollout.

## Hardening notes (local lawmindd)

After the desktop window closes, an optional **same-machine** process (`LAWMIND_DAEMON=1`) can keep automations ticking. It does **not** listen on HTTP.

- **Quit order**: Electron stops the loopback server first, then may spawn lawmindd. Opening the desktop again stops any leftover lawmindd so only one process ticks.
- **Env**: lawmindd receives `LAWMIND_*` / `BRAVE_*` plus host `PATH`/`HOME`/`TMPDIR`. It must **not** inherit `LAWMIND_LOCAL_API_TOKEN` or `LAWMIND_SKIP_API_AUTH` (see `buildDaemonProcessEnv`).
- **Scheduled jobs**: `processDueScheduledJobs` claims due jobs with an exclusive file lock (`claimDueScheduledJob`) so desktop and lawmindd cannot double-run the same workflow.
- **Automations** already use `claimDueAutomation`.

## Hardening notes (Electron shell)

The desktop app follows Electron security best practices; the implementation lives in `apps/lawmind-desktop/electron/`:

- **`contextIsolation: true`** — renderer runs in an isolated world; Node globals are not exposed to page scripts.
- **`nodeIntegration: false`** — renderer cannot call Node APIs directly; all native access goes through the narrow preload bridge.
- **Sandbox**: `sandbox: app.isPackaged` — packaged builds enable the renderer sandbox; dev keeps it off for Vite HMR.
- **CSP**: `installLawmindContentSecurityPolicy` sets a strict Content-Security-Policy on the main window. Dev allows `unsafe-eval` for Vite HMR; packaged builds do not.
- **Preload bridge**: `preload.mjs` exposes only a minimal `lawmindDesktop` API surface via `contextBridge`; no `ipcRenderer.on` is exposed to the page.
- **Path traversal guard**: `fs-bridge.mjs` validates all file-system IPC against the workspace root before touching disk.
- **Bearer comparison**: `timingSafeEqual` with a length pre-check prevents timing side-channels on the loopback auth check.

## Legal lint responsibility boundary

Mechanical lint (`src/lawmind/lint/`) is an **advisory consistency check**, not legal advice and not a completeness guarantee.

- A clean report means: the enumerated mechanical rules did not fire. It does **not** mean the draft is legally correct, commercially acceptable, or safe to send.
- Statute parameters (caps, limitation periods, LPR multiples) are versioned with `source` + `effectiveFrom`. A wrong parameter is worse than no rule—do not silently invent rates or treat the skeleton LPR multiple as a live rate series.
- Historical scan reads lawyer-chosen local folders (max 3 roots). It does not auto-create matters, does not silently write habits, and must not follow symlinks out of the chosen root.
- Outbound send (`send_email` and client-facing delivery) stays on the human sign-off path. Lint green never unlocks send.
- Internal `auto_deliver` only unlocks when progressive autonomy is already open (first-pass + lint-escape + sample N) **and** the draft is not outbound. Missing lint-escape series refuses unlock. Rubber-stamp first-pass alone is not enough.
- Structured stance (`workspace/lawmind/stance/`) is written only from explicit lawyer actions (redline accept, habit adopt, approved KEY_MODIFICATIONS). Historical scan never silent-writes profile or stance.

## Bug bounty

There is **no** formal bug bounty program. Responsible disclosure is still appreciated; fixes may be credited in release notes or advisories at maintainer discretion.
