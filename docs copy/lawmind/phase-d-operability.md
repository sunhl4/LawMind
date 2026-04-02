---
title: LawMind Phase D — Operability
description: Playbook write-back, acceptance pack, and quality JSON export.
---

# Phase D — Operability

Phase D closes the loop between **review labels**, **workspace memory**, and **customer-facing artifacts**.

## Playbook learning

When a draft review includes structured labels that indicate clause-level or structural issues, LawMind appends a timestamped line to `playbooks/CLAUSE_PLAYBOOK.md` under **§6 LawMind 审核学习（自动摘要）**.

Trigger labels include: `citation.incomplete`, `citation.incorrect`, `structure.template_mismatch`, `issue.missing`, `issue.over_argued`, `audience.wrong_framing`.

Each append emits an audit event `memory.playbook_updated`. Do not put matter secrets in review notes; lines are meant to be de-identified patterns.

## Acceptance pack

`buildAcceptancePackMarkdown(workspaceDir)` returns a single Markdown document combining:

- Phase C governance report (policy, quality stats, golden count, audit size)
- Quality report from `quality/*.quality.json`
- A short sign-off checklist for procurement or IT

## Quality JSON export

`writeQualityDashboardJson(workspaceDir)` writes `quality/dashboard.json` with schema version `1`, aggregate counts by `taskKind`, and the full list of quality records. Use this for dashboards or SIEM-adjacent tooling that prefers JSON over Markdown.

## API surface

Exports live on the main LawMind package: `buildAcceptancePackMarkdown`, `writeQualityDashboardJson`, and memory helpers `reviewLabelsTriggerPlaybook`, `appendClausePlaybookLearning`, `buildClausePlaybookReviewLine`.

## CLI (workspace)

From the repo root, against the default `workspace/` tree (override with `--workspace <dir>`):

- `pnpm lawmind:ops export-dashboard` — writes `quality/dashboard.json` (same aggregate as after `recordQuality`).
- `pnpm lawmind:ops acceptance-pack` — writes `exports/acceptance-pack.md` (governance + quality + checklist).
