# LawMind compliance audit trail

This page is the **machine- and human-facing contract** for what LawMind writes under `workspace/audit/*.jsonl` when you need **defensible delivery** (internal control, customer security review, or IT handoff). It complements the product-oriented [LawMind user manual](/LAWMIND-USER-MANUAL) and the [Agent Workbench Memory](/lawmind/agent-workbench-memory) acceptance criteria.

## Export schema version

All Markdown exports (standard and compliance) include:

```
<!-- LawMind audit export format: 2 -->
- **Export schema version:** 2
```

Automated scripts can detect the version from either the HTML comment (first token) or the `Export schema version` metadata line and apply version-specific parsing. **Version 2** is the first explicitly versioned format. Older exports with no version marker are treated as version 1 (two consecutive `artifact.rendered` rows per task; see migration note below).

## Render gate

- The engine **does not** emit **`artifact.rendered`** unless **`draft.reviewStatus === "approved"`** and the renderer returns a **successful** result with an **output path**.
- Calling `render` on a non-approved draft returns an error and **no** `artifact.rendered` row for that `taskId`. This is covered by `src/lawmind/index.test.ts` and the golden path in `src/lawmind/integration/phase-a-golden-engine.test.ts`.

## Successful delivery: one row per render

For each successful docx/pptx render, the engine appends **one** `artifact.rendered` event (`actor: system`). The **`detail`** string is a single line that includes:

- Resolved template id, requested id, and resolution **source** (built-in vs upload vs fallback).
- Output **format** (`docx` / `pptx`).
- Final **output path** on disk.
- Optional **fallback reason** when the registry fell back from the requested template.

## Failed render: explicit record

When a draft is **approved** but the renderer returns an error (file write failure, unsupported format, etc.) the engine emits **`artifact.render_failed`** (`actor: system`) with `detail` containing the format, resolved template id, and error message. This allows auditors and support staff to distinguish:

| Scenario                       | Kind emitted             | Meaning                                  |
| ------------------------------ | ------------------------ | ---------------------------------------- |
| Never attempted (not approved) | _(none)_                 | Render gate blocked the call             |
| Attempted, succeeded           | `artifact.rendered`      | File exists at `outputPath` in `detail`  |
| Attempted, failed              | `artifact.render_failed` | Error reason in `detail`; no output file |

## Typical narrative kinds (not exhaustive)

Exact kinds depend on workflow (plan/research/draft/review/render tools, collaboration, etc.). For a standard lawyer pipeline toward a file artifact, expect something like:

| Phase              | Example kinds                                        | Notes                                                                                                                       |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Task lifecycle     | `task.created`, `task.confirmed`, …                  | As emitted by the engine for the intent.                                                                                    |
| Research / draft   | Research and draft persistence events as implemented | See `AuditEventKind` in `src/lawmind/types.ts`.                                                                             |
| Citation check     | `draft.citation_integrity`                           | **Non-blocking**; may appear before `draft.reviewed` when a research snapshot exists and citations need human verification. |
| Review             | `draft.reviewed`                                     | Includes lawyer actor where applicable.                                                                                     |
| Deliverable        | `artifact.rendered`                                  | **Only after approved + successful write**; includes template + path in `detail`.                                           |
| Failed deliverable | `artifact.render_failed`                             | Approved draft but renderer returned error; `detail` contains error summary.                                                |

Use **`GET /api/audit/export?compliance=true`** (desktop) or `buildComplianceAuditMarkdown` in `src/lawmind/audit/index.ts` for **kind counts + full table** with a fixed disclaimer block.

## Migration note: version 1 → version 2

Workspaces created before the version 2 format may contain **two consecutive `artifact.rendered` rows** per task:

1. A first row emitted just before the file write (template identity only, no path).
2. A second row emitted after the file write (output path, no template identity).

From version 2 onward, these are merged into **one row** containing both template and path. If your compliance script counts or parses `artifact.rendered` rows, apply this heuristic to version 1 logs: treat two adjacent `artifact.rendered` events with the same `taskId` within a short window as a single logical delivery.

Version 1 logs have no `Export schema version` metadata line and no `<!-- LawMind audit export format: ... -->` comment.

## Regression tests

- Golden path: `src/lawmind/integration/phase-a-golden-engine.test.ts` (ordering `draft.reviewed` → `artifact.rendered`, single render row, `detail` contains template and output path markers).
- Render blocked: `src/lawmind/index.test.ts` (`render returns error when draft is not approved` + no `artifact.rendered` for that task).
- Compliance Markdown shape and schema version: `src/lawmind/audit/export-report.test.ts`.

## Related

- [LawMind user manual](/LAWMIND-USER-MANUAL) (API and export parameters)
- [LawMind task checkpoints](/lawmind/task-checkpoints) (`draft.citation_integrity` timing)
- [Citation and matter detail memory](/lawmind/citation-and-matter-detail-memory) (desktop `draftCitationIntegrity`)
