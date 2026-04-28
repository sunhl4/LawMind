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

## Bug bounty

There is **no** formal bug bounty program. Responsible disclosure is still appreciated; fixes may be credited in release notes or advisories at maintainer discretion.
