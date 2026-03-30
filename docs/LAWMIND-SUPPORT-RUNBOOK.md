# LawMind support runbook

Internal and partner support teams can use this runbook alongside [LawMind delivery](/LAWMIND-DELIVERY).

## Levels

- **L1**: intake, version capture, repro steps, log redaction guidance.
- **L2**: workspace inspection, config validation, escalation to engineering with minimal sensitive data.

## Information to collect

1. **App version** (desktop About or packaged build id).
2. **OpenClaw / monorepo version** if CLI is in use (`package.json` version or `openclaw --version` when relevant).
3. **OS** and architecture.
4. **Workspace path pattern** (never paste full client matter names if policy forbids).
5. **Symptom**: crash, failed task, model error, blank UI, etc.

## Logs

- **LawMind workspace**: `workspace/audit/*.jsonl`, recent `tasks/*.json`, `sessions/` if agent-related.
- **OpenClaw macOS host logs** (when debugging OpenClaw menubar gateway): use `./scripts/clawlog.sh` from the OpenClaw repo on a developer machine; LawMind desktop logs are primarily application and local-server output—capture **console** from devtools or vendor logging if enabled.

Do **not** ask customers to paste **full API keys**. Use masked values or confirm presence only.

## Quick HTTP smoke (local API already running)

From the repo root, with the desktop local server listening:

```bash
LAWMIND_DESKTOP_PORT=<port> pnpm lawmind:desktop:http-smoke
# or
pnpm lawmind:desktop:http-smoke http://127.0.0.1:<port>
```

Expects `GET /api/health` → `{ ok: true, ... }`.

## Common fixes

| Symptom                 | Check                                                        |
| ----------------------- | ------------------------------------------------------------ |
| Model 401 / missing key | `.env.lawmind` and [private deploy](/LAWMIND-PRIVATE-DEPLOY) |
| Empty retrieval         | Retrieval mode and provider env vars                         |
| Stuck tasks             | `lawmind:ops status`, disk space, permissions on workspace   |

## Upgrade and rollback

See [LawMind delivery](/LAWMIND-DELIVERY) **upgrade and rollback** section. Preserve **userData** and workspace when reinstalling the desktop app.

## Backup

- Script: `scripts/lawmind-backup.sh` with `LAWMIND_WORKSPACE_DIR` set.

https://docs.openclaw.ai/LAWMIND-SUPPORT-RUNBOOK  
https://docs.openclaw.ai/LAWMIND-DELIVERY  
https://docs.openclaw.ai/LAWMIND-PRIVATE-DEPLOY
