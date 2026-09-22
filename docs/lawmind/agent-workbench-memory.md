# Agent Workbench Memory

## Objective

Build a desktop-first Agent Workbench for legal workflows that matches the usability and polish of successful commercial software while preserving reference multi-channel stack's auditable execution model.

## Benchmark Standard

- Product benchmark: Cursor/VSCode-grade desktop workbench UX (fast context switching, discoverable controls, low-friction workflows).
- Quality benchmark: clear hierarchy, predictable settings, and deterministic output behavior.
- Domain benchmark: legal-grade delivery pipeline with traceability, review gates, and repeatable templates.

## Core Product Requirements

### 1) Workbench UX

- Provide a dedicated agent control surface in macOS settings.
- Keep global controls easy to discover and reduce time-to-configure.
- Present runtime context clearly: active workspace, template mode, and recent resources.

### 2) Agent Configuration and Interaction

- Support baseline agent controls for legal execution:
  - default workspace,
  - workspace override mode,
  - template mode preferences,
  - output safety behavior (approval-first render).
- Prefer explicit controls over hidden automation.

### 3) Workspace and File Switching

- Support quick switching among:
  - default workspace (global),
  - case/session override workspace,
  - recent and favorite workspace paths,
  - recently used files for context injection.
- Maintain explicit precedence:
  1. session override,
  2. case override,
  3. global default workspace.

### 4) Template System (Word/PPT)

- Built-in template families:
  - Word: legal memo, contract review, demand letter.
  - PPT: client brief, hearing strategy, evidence timeline.
- User-upload templates:
  - `.docx`/`.pptx` validation,
  - placeholder mapping,
  - template versioning and enable/disable status,
  - deterministic fallback to built-in templates when invalid/disabled.

### 5) Lawyer Instruction Pipeline

- Pipeline target:
  - instruction -> route -> retrieve -> draft -> review -> render.
- Must preserve:
  - citation traceability in outputs,
  - review gate before final render,
  - audit events for each phase.

### 6) Role-based legal team

- The workbench should expose assistants as **legal roles**, not only generic chat personas.
- Baseline roles should cover:
  - contract review,
  - legal research,
  - litigation strategy,
  - evidence and chronology,
  - client communication,
  - review and quality control.
- Each role should show:
  - objective,
  - preferred template families,
  - risk threshold,
  - active memory sources,
  - review checklist.

### 7) Quality cockpit

- The workbench should surface measurable quality signals for lawyers and operators:
  - citation integrity,
  - first-pass approval rate,
  - edit rate after review,
  - issue coverage confidence,
  - recent render success or failure,
  - benchmark status by workflow type.
- Prefer visible scorecards and drill-down audit links over hidden heuristics.

### 8) Memory graph visibility

- The workbench should make active memory sources explicit, including:
  - firm profile,
  - lawyer profile,
  - client profile,
  - matter strategy,
  - assistant profile,
  - recent project files and playbooks.
- Operators should be able to tell which memory layers influenced the current draft before approving delivery.

## Architecture Decisions

### Decision A: Keep LawMind engine as the orchestrator

- Continue using `src/lawmind/index.ts` as the authoritative pipeline entry.
- Add template registry resolution inside render dispatch, not in route logic.

### Decision B: Template policy as data + strategy

- Keep `templateId` as the external selector.
- Resolve to a strategy that may point to:
  - built-in renderer variant, or
  - uploaded template metadata with mapping.

### Decision C: Workspace controls split by responsibility

- Global default lives in reference multi-channel stack config (`agents.defaults.workspace`).
- Overrides and recents/favorites are managed by workbench-specific state for operator ergonomics.

### Decision D: Quality signals are first-class product data

- Review outcomes should feed structured learning, not only status updates.
- The workbench should preserve a human-readable trail while also emitting machine-usable quality metrics.

### Decision E: Memory remains explicit and inspectable

- Do not hide important firm, lawyer, or matter guidance inside opaque prompt assembly.
- Prefer inspectable memory panels and write-back flows over silent background mutation.

## Non-Goals (Current Iteration)

- No full WYSIWYG template editor.
- No external document management integration.
- No automated legal judgment replacement; final approval remains human-controlled.
- No silent self-rewriting memory system without user-visible adoption controls.

## Milestones

### Milestone 1

- Memory document created and adopted.
- Desktop agent control surface added.
- Workspace/file switching baseline integrated with config persistence.

### Milestone 2

- Template registry implemented and used at render time.
- Built-in Word/PPT template variants available via `templateId`.

### Milestone 3

- User-upload template metadata and validation flow.
- Mapping + versioning + fallback behavior tested.
- Lawyer pipeline includes audit-ready template dispatch details.

### Milestone 4

- Role-based assistant system exposed in the workbench.
- Active memory layers visible before review and render.
- Structured review labels feed lawyer and assistant learning memory.

### Milestone 5

- Quality cockpit with workflow metrics and benchmark health.
- Golden-task evaluation runs linked to workbench release confidence.

## Acceptance Criteria

- Operator can configure and switch workspaces without editing raw config files.
- Operator can select a built-in template and get deterministic docx/pptx output.
- Operator can register uploaded templates with mapping metadata and see safe fallback when unavailable.
- Render is blocked unless draft review status is approved.
- Audit trail captures key steps with template identity and output path.
- Operator can see which memory layers informed a draft before approval.
- Operator can distinguish role-specific assistants by responsibility, risk posture, and template defaults.
- Review outcomes can be labeled and later reused for explicit learning and quality measurement.

For **kind ordering, render gate, and `artifact.rendered` semantics** (including compliance exports), see [LawMind compliance audit trail](/lawmind/compliance-audit-trail).

## Update Policy

- Update this document when:
  - new template families are introduced,
  - precedence rules change,
  - workflow gates or audit semantics change,
  - UI control surface changes meaningfully,
  - role system behavior changes,
  - quality metrics or benchmark semantics change,
  - memory-layer visibility changes.

## Milestone Progress Notes

- 2026-03-26: Added desktop `Agent Workbench` settings tab with workspace scope controls, project root controls, and context file shortcuts.
- 2026-03-26: Implemented workspace precedence behavior in UI (`session -> case -> default`) and added quick override reset actions.
- 2026-03-26: Added legal template registry with built-in IDs, user-upload registration, enable/disable toggles, placeholder mapping, and fallback resolution.
- 2026-03-26: Connected lawyer workflow rendering to template resolution so output dispatch is auditable and deterministic.
- 2026-03-26: Added template upload and toggle controls in macOS Agent Workbench settings for operator-side template management.
- 2026-03-26: Added one-click lawyer instruction playbooks and workbench activity timeline for operational traceability.
- 2026-03-26: Added playbook direct run action through gateway agent invocation with in-panel execution feedback.
- 2026-03-26: Enhanced template preview with placeholder mapping render examples for quick validation before delivery.
- 2026-03-26: Added run-state tracking on playbooks (queued/running/rendered) and surfaced output artifact path when gateway agent events include it.
- 2026-03-26: Added per-playbook 120 s timeout watchdog, visual status badge (queued/running/rendered/timed out/failed), Retry/Re-run button, and one-click "Show in Finder" for output artifact paths. Removed duplicate @State declarations that caused compile errors.
- 2026-03-29: Documented compliance audit trail; engine emits a **single** `artifact.rendered` only after approved draft and successful file write, with template + path in `detail` (see [LawMind compliance audit trail](/lawmind/compliance-audit-trail)).
- 2026-04-01: Upgraded this memory document for LawMind 2.0 direction: role-based legal team, quality cockpit, and explicit memory-layer visibility are now part of the product target rather than nice-to-have enhancements.
