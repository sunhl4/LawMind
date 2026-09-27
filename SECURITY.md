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

Host-file access beyond the workspace (mounted folders, locate, host commands) is a **brokered** capability—not a settings toggle the lawyer must pre-enable. The agent never receives a raw POSIX handle; all host I/O goes through the Access Broker (deny-list, opposing-party fence, grants). Design: **`docs/lawmind/LAWMIND-HOST-ACCESS.md`**. Reports that the agent cannot read an unmounted path without a lawyer grant are expected.

Product-facing security checklists and deployment notes (archived snapshots): **`docs/archive/LAWMIND-SECURITY-CHECKLIST.md`**, **`docs/archive/LAWMIND-DATA-PROCESSING.md`**.

## Hardening notes (local API)

- **Loopback binding**: the desktop local server listens on `127.0.0.1` only; do not reverse-proxy it to the LAN without an explicit security review.
- **Host header**: requests must use `Host: 127.0.0.1` / `localhost` / `[::1]` (port allowed). Packaged builds reject a missing Host (DNS rebinding). See `validateLoopbackHttpHost`.
- **Credentials (per-client, derived)**: every client presents `Authorization: Bearer <credential>`, where `credential = HMAC-SHA256(installationSecret, clientId:epoch)`. The installation secret is persistent (OS keychain; fallback `0600` file **outside** the workspace) and the server stores no per-client secret — it recomputes and compares in constant time. Knowing a credential yields only that client's scope; knowing the **installation secret** yields every client's credential, so the secret is guarded like a root key (it is on the same deny-list as the old shared token for daemon/spawned processes).
  - Clients: `desktop` (Electron main), `renderer` (app window), `word-addin` (Office task pane), `cli` (scripts). **Unknown clients are denied by default.**
  - **Least privilege**: `word-addin` may only reach `/word-addin/*` and `/api/word-addin/*`; `cli` is read-only (`GET`/`HEAD`/`OPTIONS`). Violations return `403 client_scope_forbidden`.
  - **Revocation**: `localApiRevokedClients` in `<userData>/LawMind/desktop-config.json` revokes individual clients; bumping `localApiEpoch` rotates everyone (one epoch of grace keeps in-flight clients alive). Sharing a credential with a colleague is therefore **not** a supported way to collaborate — revoke the client instead.
  - Source of truth: `apps/lawmind-desktop/electron/local-api-credentials.mjs`. Runbook: **`docs/lawmind/LAWMIND-LOCAL-API-AUTH.md`**.
- **Single instance**: only one app instance per userData (`app.requestSingleInstanceLock()`; dev escape hatch `LAWMIND_ALLOW_MULTI_INSTANCE=1`). This is a **security-relevant** constraint, not just hygiene: the loopback port is a persisted contract (the sideloaded Word manifest pins it), and a second instance would be forced onto a random port, silently breaking every sideloaded client. It also prevents two instances from writing the same workspace and from deleting each other's shared CLI credential file (`<userData>/LawMind/local-api-clients.json`). If the persisted port cannot be bound, LawMind rewrites the Word manifest when the occupant is not another LawMind instance, and Settings → 体检 → Word asks the lawyer to reopen Word. Port numbers stay in the main-process log.
- **Discovery**: `GET /.well-known/lawmind-local` returns non-secret metadata (`base`, `instanceId`, `epoch`, `clients`) so clients can re-discover coordinates after a restart. It carries **no** credential; it is still behind the loopback Host check, and CORS keeps browsers from reading it. **Its reach is bounded**: it cannot recover from a _port_ change (it lives on the same base), so ports are treated as part of the persisted contract. `LAWMIND_SKIP_API_AUTH=1` is for dev/CI only; **packaged builds ignore it** and log a warning. The legacy single token (`LAWMIND_LOCAL_API_TOKEN`) is still accepted and reported as client `shared` — dev/E2E override path only.
- **Rate limiting**: token-bucket guard on the loopback server (`lawmind-local-rate-limit.ts`); stats exposed on `GET /api/health` → `doctor.rateLimit`.
- **Secrets**: model and integration keys belong in the OS keychain / host env, not in the workspace git tree. Inspect `doctor.skipApiAuthWarn` and integration health before firm rollout. Child processes started through `safeCommand` do not inherit the parent environment; loader hooks (`LD_PRELOAD`, `NODE_OPTIONS`, …), vendor key prefixes (`OPENAI_*`, …), and the installation-secret deny-list are stripped even from an explicit env (daemon may still carry `LAWMIND_*` / `BRAVE_*`). Direct HTTP egress pins the DNS answer it just checked (bracketed IPv6, `fe80::/10`, and `::ffff:` mapped addresses included). `.git/` and `.signing-secret` are not writable through the general file APIs. Untrusted document text is fenced with unique `<<<LAWMIND_UNTRUSTED_*>>>` markers, not Markdown `---`.
- **Skill signing key**: `workspace/lawmind/skills/*/SKILL.md` is injected into model context, and `SKILL.sig` is the only thing gating it. The key must come from `LAWMIND_SKILL_SIGNING_SECRET` (outside the workspace); the `<workspace>/lawmind/skills/.signing-secret` file is a single-machine fallback and **must never be committed** (`**/.signing-secret`). When no key is configured the code falls back to a value derived from the workspace path — that is **not a secret**, so a packaged build must fail closed rather than trust it. Rotation runbook: **`docs/lawmind/LAWMIND-SKILLS-SIGNING.md`**.

## Hardening notes (local lawmindd)

After the desktop window closes, an optional **same-machine** process tree (`LAWMIND_DAEMON_SUPERVISOR=1` → fork of `LAWMIND_DAEMON=1`) can keep automations ticking. Neither process **listens on HTTP**.

- **Two layers, one tick source**: the supervisor forks a tick child and restarts it on crash; the **child** owns the pid file and the single-instance lock. The supervisor holds **no** persistent state — it must not clear the pid or release the lock, or it would erase a different running tree's state. Mutual exclusion is arbitrated solely by the child's `acquireDaemonLock` (the child is the real ticker). Starting two supervisors is therefore harmless: one child wins the lock, the other yields and exits 0, and its supervisor ends on `clean_exit`. `SIGTERM` to the supervisor tears down the whole tree.
- **Quit order**: Electron stops the loopback server first, then may spawn the supervisor. Opening the desktop again stops any leftover tree so only one process ticks.
- **Single-instance lock**: `lawmind/daemon.lock` is the mutual-exclusion primitive (`acquireDaemonLock`), held by the **tick child**. The pid file answers "who is running"; the lock answers "who is allowed to tick". A stale lock (dead pid) or a corrupt lock file is taken over; a live lock is not. Do not add a second tick source without going through this lock.
- **Env**: the tree receives `LAWMIND_*` / `BRAVE_*` plus host `PATH`/`HOME`/`TMPDIR`. It must **not** inherit `LAWMIND_LOCAL_API_TOKEN`, `LAWMIND_SKIP_API_AUTH`, or the derived-credential root (`LAWMIND_LOCAL_API_INSTALLATION_SECRET` / `_EPOCH` / `_REVOKED_CLIENTS` / `_INSTANCE_ID`) — lawmindd listens on no port, so it has no reason to hold any of them. **Both layers must go through `buildDaemonProcessEnv`**: the supervisor also builds its child's env with it (it must not hand-roll `{...process.env}`, which would leak the deny-list keys) and only adds the supervisor flag.
- **Scheduled jobs**: `processDueScheduledJobs` claims due jobs with an exclusive file lock (`claimDueScheduledJob`) so desktop and lawmindd cannot double-run the same workflow.
- **Automations** already use `claimDueAutomation`.
- **Operating files** (all under `<workspace>/lawmind/`, none of them a trust boundary): `daemon.json` (state incl. heartbeat + exit/recovery bookkeeping), `daemon.pid`, `daemon.lock`, and `daemon.log` (+ one rotated generation, capped at 1 MiB).
- **`daemon.log` is operational evidence, not proof of anything.** It exists so a lawyer reopening the desktop can see what happened while they were away (`summarizeDaemonForLawyer`), and so a crash has a cause. `GOALS.md` §二 forbids marketing log/trace presence as correctness; treat this file the same way. It must never contain credentials — the supervisor logs exit classes and backoff decisions, not argv or env values.

## Hardening notes (Electron shell)

The desktop app follows Electron security best practices; the implementation lives in `apps/lawmind-desktop/electron/`:

- **`contextIsolation: true`** — renderer runs in an isolated world; Node globals are not exposed to page scripts.
- **`nodeIntegration: false`** — renderer cannot call Node APIs directly; all native access goes through the narrow preload bridge.
- **Sandbox**: `sandbox: app.isPackaged` — packaged builds enable the renderer sandbox; dev keeps it off for Vite HMR.
- **CSP**: `installLawmindContentSecurityPolicy` sets a strict Content-Security-Policy on the main window. Dev allows `unsafe-eval` for Vite HMR; packaged builds do not.
- **Preload bridge**: `preload.mjs` exposes only a minimal `lawmindDesktop` API surface via `contextBridge`; no `ipcRenderer.on` is exposed to the page.
- **Path traversal guard**: `fs-bridge.mjs` validates all file-system IPC against the workspace root before touching disk.
- **Folder picker grant**: `set-project-dir` and `add-host-folder` accept only directories returned by `showOpenDialog` in this process (`picker-path-grant.mjs`). Clearing the project dir with `null` remains allowed.
- **Bearer comparison**: `timingSafeEqual` with a length pre-check prevents timing side-channels on the loopback auth check.

## Legal lint responsibility boundary

Mechanical lint (`src/lawmind/lint/`) is an **advisory consistency check**, not legal advice and not a completeness guarantee.

- A clean report means: the enumerated mechanical rules did not fire. It does **not** mean the draft is legally correct, commercially acceptable, or safe to send.
- Statute parameters (caps, limitation periods, LPR multiples) are versioned with `source` + `effectiveFrom`. A wrong parameter is worse than no rule—do not silently invent rates or treat the skeleton LPR multiple as a live rate series.
- Historical scan reads lawyer-chosen local folders (max 3 roots). It does not auto-create matters, does not silently write habits, and must not follow symlinks out of the chosen root.
- Outbound send (`send_email` and client-facing delivery) stays on the human sign-off path. Lint green never unlocks send.
- Internal `auto_deliver` only unlocks when progressive autonomy is already open (first-pass + lint-escape + sample N) **and** the draft is not outbound. Missing lint-escape series refuses unlock. Rubber-stamp first-pass alone is not enough.
- Structured stance (`workspace/lawmind/stance/`) is written only from explicit lawyer actions (redline accept, habit adopt, approved KEY_MODIFICATIONS). Historical scan never silent-writes profile or stance.

## License boundary (offline, soft gate)

Licensing is **local and offline**. It is not a security control and it is not a remote control plane.

- The license/trial record lives at `~/.lawmind/license.json` (mode `0600`), **outside every workspace**. Agent host tools cannot read it: it sits outside the workspace root and outside the brokered mount set; the deny-list (`src/lawmind/host-access/deny-list.ts`) blocks workspace files like `lawmind.policy.json`, and the license file is never a grant target.
- An activation code is `base64url(payload).base64url(ed25519 signature)` over the exact payload bytes. The verifying public key is embedded (`src/lawmind/license/keys.ts`); the private key exists only on the issuer side (dev key lives in `scripts/lawmind/lawmind-license.ts` and **must be rotated before any external release** — see that file's header).
- Rejected without exception: malformed codes, tampered payloads (signature covers the bytes), and machine-bound codes presented on another machine. Failures are reported to the lawyer, never swallowed.
- Expiry is a **soft gate**: an expired trial or expired license keeps every feature usable and only surfaces a reminder in settings. Nothing in the turn/tool pipeline consults license state, so a license failure can never block drafting, export or sign-off, and can never silently alter a deliverable.
- No network calls, no telemetry, no server-side revocation. Do not add a license check that gates the tool pipeline or the local API without a security review — that would convert a commercial reminder into an availability risk for a lawyer's live case file.

## Bug bounty

There is **no** formal bug bounty program. Responsible disclosure is still appreciated; fixes may be credited in release notes or advisories at maintainer discretion.
