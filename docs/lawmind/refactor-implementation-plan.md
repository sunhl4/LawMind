---
title: LawMind refactor implementation plan
description: Implementation-level plan for LawMind's matter-centered refactor, including target contracts, module layout, and the first staged pull requests.
---

# LawMind refactor implementation plan

## Purpose

This document turns the [LawMind refactor blueprint](/lawmind/refactor-blueprint) into an implementation plan.

It is meant to answer:

- what should change first,
- what should stay compatible,
- how current LawMind contracts map to the target architecture,
- how to slice the first refactor work into safe, reviewable steps.

This plan assumes a key constraint:

**do not pause product momentum by attempting a single large rewrite.**

The refactor should be incremental, test-backed, and compatible with the current engine, agent runtime, and desktop workbench.

## Current baseline

Today LawMind already has:

- core workflow contracts in `src/lawmind/types.ts`,
- deterministic pipeline orchestration in `src/lawmind/index.ts`,
- an agent runtime in `src/lawmind/agent/`,
- memory truth sources in `src/lawmind/memory/` and `workspace/`,
- governance and quality pieces in `src/lawmind/policy/`, `src/lawmind/evaluation/`, and `src/lawmind/learning/`,
- a desktop workbench in `apps/lawmind-desktop/`.

This means the refactor should **reframe and reorganize** the system, not discard its strongest foundations.

## Refactor strategy

## Rule 1: keep current contracts running while introducing new ones

The current types are still useful:

- `TaskIntent`
- `ResearchBundle`
- `LegalReasoningGraph`
- `ArtifactDraft`
- `TaskRecord`
- `MatterIndex`
- `AuditEvent`
- `QualityRecord`

These should remain valid during the first refactor phase.

New domain contracts should be introduced alongside them, then existing workflows should progressively adopt them.

## Rule 2: separate business state from runtime state

During the first implementation phase, introduce explicit distinction between:

- **business state**
  - matter,
  - deliverable,
  - approval,
  - deadline,
  - work queue item,
  - memory node,
  - risk register entry
- **runtime state**
  - session transcript,
  - tool calls,
  - prompt assembly artifacts,
  - temporary working memory,
  - turn-level execution metadata

This should be visible in code layout, not just docs.

## Rule 3: move the UI last, not first

The workbench should not be the first place where the refactor is enforced.

Instead:

1. stabilize domain contracts,
2. add application services,
3. adapt APIs,
4. then move the workbench to matter-first views.

That reduces churn and keeps the desktop app usable while core contracts evolve.

## Target module layout

The target structure under `src/lawmind/` should move toward:

```text
src/lawmind/
  core/
    contracts/
    matter/
    deliverables/
    approvals/
    deadlines/
    risks/
    memory-graph/
    reasoning/
    queues/
  runtime/
    sessions/
    prompts/
    tools/
    hooks/
    collaboration/
    orchestration/
  governance/
    policy/
    audit/
    evaluation/
    benchmarks/
    review-learning/
  application/
    services/
    queries/
    commands/
  adapters/
    engine/
    desktop-api/
    cli/
    storage/
```

This is a target direction, not a requirement to move every file immediately.

## Transitional mapping from today's layout

| Current area               | Transitional destination                                     |
| -------------------------- | ------------------------------------------------------------ |
| `src/lawmind/types.ts`     | `core/contracts/` plus compatibility exports                 |
| `src/lawmind/index.ts`     | `adapters/engine/` backed by `application/services/`         |
| `src/lawmind/agent/*`      | `runtime/`                                                   |
| `src/lawmind/memory/*`     | `core/memory-graph/` plus `adapters/storage/markdown-memory` |
| `src/lawmind/reasoning/*`  | `core/reasoning/`                                            |
| `src/lawmind/tasks/*`      | split across `core/queues/` and `application/services/`      |
| `src/lawmind/drafts/*`     | `core/deliverables/` plus `adapters/storage/`                |
| `src/lawmind/cases/*`      | `core/matter/` plus `application/queries/`                   |
| `src/lawmind/policy/*`     | `governance/policy/`                                         |
| `src/lawmind/evaluation/*` | `governance/evaluation/`                                     |
| `src/lawmind/learning/*`   | `governance/review-learning/`                                |

## Target domain contracts

## 1. Matter

`Matter` should become the top-level business object.

Suggested first version:

```ts
type MatterStatus =
  | "intake"
  | "active"
  | "waiting_on_client"
  | "waiting_on_firm"
  | "under_review"
  | "delivered"
  | "closed";

type Matter = {
  matterId: string;
  clientId: string;
  title: string;
  status: MatterStatus;
  sensitivity: "normal" | "high" | "restricted";
  ownerLawyerId?: string;
  primaryAssistantRoleId?: string;
  strategyStatus: "missing" | "draft" | "approved" | "stale";
  openQuestionIds: string[];
  deadlineIds: string[];
  deliverableIds: string[];
  queueItemIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

## 2. Deliverable

`ArtifactDraft` remains useful, but should become one stage inside a broader `Deliverable` lifecycle.

Suggested first version:

```ts
type DeliverableKind =
  | "legal-memo"
  | "contract-review"
  | "demand-letter"
  | "litigation-outline"
  | "client-brief"
  | "evidence-timeline";

type Deliverable = {
  deliverableId: string;
  matterId: string;
  taskId?: string;
  kind: DeliverableKind;
  audience: "internal" | "client" | "counterparty" | "court";
  status: "planned" | "drafting" | "pending_review" | "approved" | "rendered" | "blocked";
  templateId?: string;
  currentDraftTaskId?: string;
  currentReviewId?: string;
  blockingReasonIds: string[];
  createdAt: string;
  updatedAt: string;
};
```

## 3. Approval

Approval should be a first-class contract rather than only a review state attached to a draft.

```ts
type ApprovalRequest = {
  approvalId: string;
  matterId: string;
  deliverableId?: string;
  requestedBy: string;
  requestedRole?: string;
  requestedAt: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "needs_changes";
  resolvedBy?: string;
  resolvedAt?: string;
};
```

## 4. Deadline

The first version can be simple but explicit:

```ts
type Deadline = {
  deadlineId: string;
  matterId: string;
  title: string;
  dueAt: string;
  severity: "soft" | "hard" | "critical";
  source: "manual" | "case_memory" | "project_file" | "calendar_import";
  status: "open" | "snoozed" | "completed" | "missed";
  notes?: string;
};
```

## 5. Work queue

This is one of the most important new objects.

```ts
type QueueKind =
  | "need_client_input"
  | "need_evidence"
  | "need_conflict_check"
  | "need_lawyer_review"
  | "need_partner_approval"
  | "ready_to_draft"
  | "ready_to_render"
  | "blocked_by_deadline"
  | "blocked_by_missing_strategy";

type WorkQueueItem = {
  queueItemId: string;
  matterId: string;
  kind: QueueKind;
  status: "open" | "in_progress" | "resolved" | "dismissed";
  priority: "low" | "normal" | "high" | "critical";
  title: string;
  detail?: string;
  relatedTaskId?: string;
  relatedDeliverableId?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 6. Memory graph node

Markdown stays the truth source, but the derived layer should be explicit.

```ts
type MemoryNode = {
  nodeId: string;
  scope: "firm" | "lawyer" | "client" | "matter" | "playbook" | "opponent" | "project";
  kind: "preference" | "rule" | "strategy" | "risk" | "clause_pattern" | "fact_gap";
  sourcePath: string;
  sourceAnchor?: string;
  summary: string;
  confidence?: number;
  conflictStatus?: "none" | "possible_conflict" | "conflict";
  adoptionStatus: "truth_source" | "suggested" | "approved" | "dismissed";
  updatedAt: string;
};
```

## Compatibility mapping from existing types

The following mappings should be introduced explicitly in code or docs:

| Existing type         | Transitional role in target architecture |
| --------------------- | ---------------------------------------- |
| `TaskIntent`          | runtime/request planning input           |
| `ResearchBundle`      | evidence acquisition artifact            |
| `LegalReasoningGraph` | core reasoning artifact                  |
| `ArtifactDraft`       | content payload inside `Deliverable`     |
| `TaskRecord`          | execution log and status adapter         |
| `MatterIndex`         | read model for matter cockpit queries    |
| `AuditEvent`          | governance event log                     |
| `QualityRecord`       | governance quality snapshot              |

This mapping is important because it prevents the refactor from becoming a naming-only exercise.

## Application services to introduce first

The first real architectural improvement should be a service layer.

Recommended services:

- `MatterService`
  - create matter read models
  - update matter status
  - summarize next actions
- `DeliverableService`
  - create and progress deliverables
  - connect drafts, reviews, renders
- `ApprovalService`
  - request, resolve, and query approvals
- `QueueService`
  - create blocked and waiting items
  - drive next-step recommendations
- `MemoryGraphService`
  - derive memory nodes from Markdown truth sources
  - track adoption state
- `ReasoningService`
  - require or skip reasoning graph based on risk
- `QualityService`
  - aggregate review labels, quality snapshots, and golden examples

These services should sit between storage and the desktop/API layer.

## API direction

The desktop server should gradually move from route handlers that call many domain helpers directly to route handlers that call application services.

Recommended medium-term API groups:

- `/api/matters/*`
- `/api/deliverables/*`
- `/api/approvals/*`
- `/api/queues/*`
- `/api/memory/*`
- `/api/reasoning/*`
- `/api/quality/*`
- `/api/roles/*`

The goal is not to make the API bigger for its own sake. The goal is to let the workbench consume a matter-first model.

## Workbench target information architecture

The desktop app should gradually move toward six primary surfaces:

### 1. Matter cockpit

Shows:

- matter headline,
- current strategy status,
- next actions,
- open questions,
- key risks,
- deadlines,
- active deliverables,
- blocked items.

### 2. Review queue

Shows:

- pending draft reviews,
- pending approvals,
- high-risk outputs waiting for signoff,
- recent review labels and repeat problems.

### 3. Memory inspector

Shows:

- active memory layers,
- truth source files,
- which memory influenced a draft,
- suggested memory writes waiting for adoption.

### 4. Reasoning board

Shows:

- issue tree,
- authority conflicts,
- evidence gaps,
- confidence,
- delivery risks,
- what still needs lawyer judgment.

### 5. Quality cockpit

Shows:

- citation integrity,
- issue coverage,
- first-pass approval rate,
- edit rate,
- benchmark status by workflow type,
- golden-example health.

### 6. Role board

Shows:

- active legal roles,
- current responsibilities,
- handoffs,
- specialist review status,
- escalation ownership.

## First three PR slices

These slices are intentionally chosen to create structure without forcing a big-bang rewrite.

## PR 1: Matter core contracts and adapters

### Goal

Introduce matter-centered business contracts and application services without breaking current engine and desktop behavior.

### Scope

- add `Matter`, `Deliverable`, `ApprovalRequest`, `Deadline`, `WorkQueueItem`, and `MemoryNode` contracts,
- add compatibility adapters from `TaskRecord`, `ArtifactDraft`, and `MatterIndex`,
- add `MatterService` and `DeliverableService` read models,
- keep current APIs working,
- add tests for mappings and state transitions.

### Suggested file areas

- `src/lawmind/core/contracts/`
- `src/lawmind/application/services/`
- compatibility layer from `src/lawmind/types.ts`

### Acceptance criteria

- current engine and desktop tests still pass,
- new matter read model can be derived from existing workspace files,
- at least one adapter test proves current data can populate the new contracts,
- no UI rewrite required yet.

## PR 2: Queue and approval layer

### Goal

Make blocked and waiting work explicit instead of implicit in task or draft status.

### Scope

- introduce `QueueService` and `ApprovalService`,
- derive queue items from current review, draft, and matter states,
- support explicit statuses like `need_lawyer_review`, `need_client_input`, `need_evidence`,
- persist approval requests separately from draft status when needed,
- expose queue and approval query endpoints.

### Suggested file areas

- `src/lawmind/core/queues/`
- `src/lawmind/core/approvals/`
- `src/lawmind/application/services/queue-service.ts`
- `src/lawmind/application/services/approval-service.ts`

### Acceptance criteria

- a pending high-risk draft creates a queue item and approval request,
- review actions resolve or update queue state,
- desktop API can list pending queue items without reconstructing them ad hoc in the UI,
- tests cover queue derivation and approval transitions.

## PR 3: Matter cockpit desktop baseline

### Goal

Shift the desktop app from chat-first navigation to matter-first navigation without deleting the chat workflow.

### Scope

- add a matter cockpit summary panel,
- show next actions, deadlines, blocked items, deliverables, and open approvals,
- keep current review workbench but integrate queue visibility,
- make chat one panel inside the matter workspace rather than the only primary entry.

### Suggested file areas

- `apps/lawmind-desktop/src/renderer/`
- `apps/lawmind-desktop/server/`

### Acceptance criteria

- operator can open a matter and see business state beyond raw conversation,
- pending approvals and blocked items are visible without opening a draft first,
- memory and reasoning visibility can be linked from the matter cockpit,
- no regression to existing chat, review, or artifact access flows.

## Follow-up PR candidates

After the first three PRs, the likely next slices are:

- role-bound assistant capabilities and escalation rules,
- memory graph derivation and adoption queue,
- reasoning-required gates for high-risk deliverables,
- quality cockpit and benchmark release gating,
- event and hook bus for matter lifecycle automation.

## Test strategy for the refactor

Each phase should expand tests in three categories:

### Contract tests

- ensure new domain contracts can be built from current persisted state,
- ensure transitions are valid and explicit,
- ensure compatibility mappings remain stable.

### Service tests

- verify queue derivation,
- verify approval creation and resolution,
- verify deliverable lifecycle behavior,
- verify matter summaries and next-action logic.

### UI integration tests

- verify matter cockpit payload shape,
- verify review queue visibility,
- verify no regression in current draft review and render flows.

## What not to do

Avoid these mistakes during implementation:

- do not rename files or move modules only for aesthetics,
- do not make the new contracts depend on UI concerns,
- do not silently replace Markdown truth-source memory with opaque JSON-only storage,
- do not hide approval logic inside prompt wording,
- do not let role design become only branding without bounded capabilities.

## Recommended next action

If implementation starts immediately, begin with:

1. add new business contracts and compatibility adapters,
2. derive matter and deliverable read models from current persisted files,
3. write tests before UI movement,
4. then expose queue and approval summaries to the desktop app.

That path provides the highest leverage with the lowest migration risk.
