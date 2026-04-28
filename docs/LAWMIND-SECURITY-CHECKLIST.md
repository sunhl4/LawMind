# LawMind security checklist (engineering)

This page lists **technical** security and compliance artifacts for LawMind. See [SECURITY.md](https://github.com/lawmind/lawmind/blob/main/SECURITY.md) for vulnerability reporting. It does **not** replace a formal penetration test, SOC 2 report, or legal review.

## Trust boundaries (LawMind desktop)

- **Local HTTP API** binds to **loopback only** (`127.0.0.1`). It is not exposed to the LAN by default.
- **Secrets** live in the desktop-managed **`.env.lawmind`** (or paths documented in [LawMind private deploy](/LAWMIND-PRIVATE-DEPLOY)). Do not paste full API keys into support tickets.
- **Workspace data** (tasks, drafts, audit JSONL) stays under the configured **workspace directory** on disk.
- **Telemetry**: LawMind does not ship product telemetry in the desktop shell beyond what you configure with third-party model providers.

## Audit and logs

- **Audit trail**: `workspace/audit/*.jsonl` (and collaboration audit when enabled). Use [audit export](/LAWMIND-USER-MANUAL) for Markdown reports.
- **Support bundles**: When sharing logs, **redact** secrets and client identifiers per firm policy.

## Dependency and supply chain

| Action                                             | Command / artifact                                                                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lockfile fingerprint + CycloneDX (desktop subtree) | `pnpm lawmind:sbom` → `dist/lawmind-sbom.json` + `dist/lawmind-sbom-cyclonedx-lawmind-desktop.json` when `@cyclonedx/cyclonedx-npm` succeeds (gitignored; monorepo root uses pnpm 10 — SBOM is generated from `apps/lawmind-desktop`) |
| CycloneDX only (after `pnpm install`)              | `pnpm lawmind:sbom:cyclonedx`                                                                                                                                                                                                         |
| npm audit                                          | `pnpm audit` (see [pnpm audit](https://pnpm.io/cli/audit))                                                                                                                                                                            |
| OSV (optional)                                     | Install [osv-scanner](https://google.github.io/osv-scanner/) and run against the repo or built `node_modules`                                                                                                                         |

## Vulnerability response

Report suspected vulnerabilities per [SECURITY.md](https://github.com/lawmind/lawmind/blob/main/SECURITY.md). For LawMind-specific deployment questions, start from this checklist and [LawMind private deploy](/LAWMIND-PRIVATE-DEPLOY).

## References

- [LawMind data processing](/LAWMIND-DATA-PROCESSING)
- [LawMind delivery](/LAWMIND-DELIVERY)
- [SECURITY.md on GitHub](https://github.com/lawmind/lawmind/blob/main/SECURITY.md)

https://docs.lawmind.ai/LAWMIND-SECURITY-CHECKLIST  
https://docs.lawmind.ai/LAWMIND-DATA-PROCESSING  
https://docs.lawmind.ai/LAWMIND-DELIVERY  
https://docs.lawmind.ai/LAWMIND-PRIVATE-DEPLOY  
https://github.com/lawmind/lawmind/blob/main/SECURITY.md
