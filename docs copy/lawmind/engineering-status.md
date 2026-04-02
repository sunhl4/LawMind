---
title: LawMind engineering status
description: How LawMind 2.0 strategy maps to code, and what is verified in CI.
---

# LawMind engineering status

This page links [LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY) to **what exists in the repository today** and how we keep **typecheck and tests** green. It is not a marketing roadmap; it is a maintainer alignment sheet.

## Typecheck and desktop app

- **Root TypeScript**: the OpenClaw repo uses `pnpm tsgo` with `ES2023` libs. LawMind code under `src/lawmind/` is included in that check.
- **LawMind Desktop** (`apps/lawmind-desktop/`): `tsconfig.json` uses **ES2023** + `allowImportingTsExtensions` so renderer imports that reference `src/lawmind/**/*.ts` match Vite and strict checking.
- **Window bridge**: `apps/lawmind-desktop/src/renderer/global.d.ts` augments `Window` with `lawmindDesktop` (the file is a module via `export {}` so augmentation applies reliably).

## Strategy pillars vs code (high level)

| 2.0 pillar (see strategy doc)                   | Primary locations in repo                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Cognitive memory graph (Markdown truth sources) | `src/lawmind/memory/`, `workspace/` playbooks and profiles as documented in [Project memory](/LAWMIND-PROJECT-MEMORY) |
| Legal reasoning substrate                       | `src/lawmind/reasoning/`, `docs/lawmind/legal-reasoning-graph`                                                        |
| Traceability and audit                          | `src/lawmind/audit/`, `docs/lawmind/compliance-audit-trail`                                                           |
| Quality measurement                             | `src/lawmind/evaluation/`, `docs/lawmind/quality-and-benchmarks`                                                      |
| Governance and policy                           | `src/lawmind/policy/`, `docs/lawmind/phase-c-governance`, `LAWMIND-POLICY-FILE`                                       |
| Operability and delivery                        | `src/lawmind/delivery/`, `docs/lawmind/phase-d-operability`, desktop HTTP API in `apps/lawmind-desktop/server/`       |
| Agent loop and tools                            | `src/lawmind/agent/`                                                                                                  |
| Learning from review                            | `src/lawmind/learning/`, `src/lawmind/memory/playbook-learning.ts`                                                    |

## What “complete” does not mean

LawMind 2.0 describes a **product north star**. The codebase implements many building blocks (engine, agent, memory layers, reasoning snapshots, benchmarks, governance helpers, desktop UI). **Not every bullet in the strategy doc is fully automated or productized**; some items remain **documentation and incremental implementation**.

When in doubt, prefer **tests and `pnpm tsgo`** over narrative completeness.

## Related docs

- [LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY)
- [LawMind architecture](/LAWMIND-ARCHITECTURE)
- [LawMind user manual](/LAWMIND-USER-MANUAL)
