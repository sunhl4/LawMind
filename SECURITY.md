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

Product-facing security checklists and deployment notes: **`docs/LAWMIND-SECURITY-CHECKLIST.md`**, **`docs/LAWMIND-DATA-PROCESSING.md`**.

## Hardening notes (local API)

- **Loopback binding**: the desktop local server listens on `127.0.0.1` only; do not reverse-proxy it to the LAN without an explicit security review.
- **Bearer token**: non-dev sessions require `Authorization: Bearer` on `/api/*` (see `lawmind-local-api-auth.ts`). `LAWMIND_SKIP_API_AUTH=1` is for dev/CI only; **packaged builds ignore it** and log a warning.
- **Rate limiting**: token-bucket guard on the loopback server (`lawmind-local-rate-limit.ts`); stats exposed on `GET /api/health` → `doctor.rateLimit`.
- **Secrets**: model and integration keys belong in the OS keychain / host env, not in the workspace git tree. Inspect `doctor.skipApiAuthWarn` and integration health before firm rollout.

## Bug bounty

There is **no** formal bug bounty program. Responsible disclosure is still appreciated; fixes may be credited in release notes or advisories at maintainer discretion.
