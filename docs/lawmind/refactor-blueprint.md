---
title: LawMind refactor blueprint
description: A bold but staged blueprint for evolving LawMind from a legal agent workbench into a matter-centered legal production system.
---

# LawMind refactor blueprint

## Why this document exists

LawMind already has a strong foundation:

- a deterministic legal workflow engine,
- an agent runtime with tool use and session persistence,
- Markdown truth-source memory,
- review gates and audit events,
- a desktop workbench for lawyers.

The next step is not "add more chat features." The next step is to make LawMind feel more like a **real legal assistant team** and less like a generic agent with legal prompts.

This document captures the refactor direction for that shift.

## Diagnosis

LawMind is already ahead of many legal AI tools in traceability, reviewability, and memory. The current gap is structural:

- the product still feels **chat-first** in key user flows,
- the runtime still feels **tool-first** more than **work-first**,
- memory is becoming richer but is not yet a fully explicit **matter cognition system**,
- assistants exist, but they are not yet a clear **role system with bounded authority**,
- the desktop workbench still centers conversation more than **matter control, queueing, approvals, and deadlines**.

In short:

**LawMind should evolve from a legal agent workbench into a matter-centered legal production operating system.**

## External lessons worth carrying forward

### What Claude Code teaches

Claude Code's strongest lesson is not prompt quality. It is harness quality:

- the runtime loop is a first-class system,
- tools are governed, typed, and orchestrated,
- commands, agents, skills, and hooks are separated,
- context is loaded progressively,
- specialist agents are often safer than one generalist agent.

### What OpenClaw teaches

OpenClaw's strongest reusable ideas for LawMind are:

- serialized session execution,
- explicit session and transcript persistence,
- tool policy pipelines,
- Markdown truth-source memory plus derived search/index layers,
- protocol-first multi-surface architecture,
- operational thinking as part of product design rather than an afterthought.

### What LawMind must add beyond both

LawMind serves a stricter domain. To feel like a trusted legal assistant, it must add:

- matter-centric state rather than chat-centric state,
- explicit approval and escalation paths,
- visible risk and deadline management,
- institutional legal memory across firm, lawyer, client, matter, clause, and opponent,
- structured legal reasoning that survives beyond one model turn,
- role-based digital legal team behavior.

## North star

LawMind should become:

**a matter-centered legal production system with explicit reasoning, bounded roles, human approvals, and durable institutional memory.**

That means the product default should be:

- not "what would you like to ask?"
- but "what matters are active, what is blocked, what needs review, what risks are open, and what should happen next?"

## Target architecture

## 1. Make the matter the primary system object

Today, sessions and tasks are important. Going forward, the primary object should be the **matter**.

The matter should own:

- client identity and profile,
- active theory and strategy,
- parties and counterparties,
- evidence and factual chronology,
- legal issues and authorities,
- drafts and deliverables,
- open questions,
- deadlines and reminders,
- approvals and review history,
- collaboration handoffs.

The agent session remains important, but it becomes an interaction layer on top of matter state rather than the main source of continuity.

## 2. Separate domain state from agent runtime state

LawMind should explicitly distinguish:

- **domain state**: matter, deadlines, deliverables, approvals, memory graph, reasoning graph,
- **runtime state**: session history, tool calls, model replies, temporary working notes.

This separation prevents the system from overfitting to chat history and makes the legal work state auditable even when models or prompts change.

## 3. Introduce a legal work orchestration layer

The current engine is already a workflow backbone. The refactor should formalize it into a work orchestrator that tracks:

- intake,
- triage,
- research,
- reasoning,
- drafting,
- review,
- approval,
- render,
- delivery preparation,
- post-review learning.

This layer should answer:

- what is the current status,
- what is blocked,
- what is missing,
- who should act next,
- whether the matter can advance.

## Proposed subsystem split

## `lawmind-core`

Owns stable legal domain contracts and state transitions.

Examples:

- `Matter`
- `MatterRoleAssignment`
- `Deliverable`
- `DeliverableReview`
- `ApprovalRequest`
- `Deadline`
- `OpenQuestion`
- `LegalReasoningGraph`
- `MemoryNode`
- `RiskRegisterEntry`

## `lawmind-runtime`

Owns the agent loop and runtime orchestration.

Examples:

- session lifecycle,
- tool registry,
- tool execution,
- hooks,
- collaboration/delegation,
- prompt assembly,
- context shaping,
- run lifecycle events.

## `lawmind-governance`

Owns trust, policy, and measurable quality.

Examples:

- tool policy,
- approval rules,
- review labels,
- benchmark gates,
- quality scorecards,
- audit export,
- edition policies,
- compliance bundles.

## `lawmind-workbench`

Owns UI surfaces only.

Examples:

- matter cockpit,
- review queue,
- deadlines and reminders,
- memory visibility panels,
- assistant role management,
- quality cockpit,
- delivery views.

The workbench should consume application services rather than directly hosting core orchestration logic.

## Target domain model

The following objects should become explicit first-class contracts:

```ts
type Matter = {
  matterId: string;
  clientId: string;
  title: string;
  status: "intake" | "active" | "waiting" | "review" | "delivered" | "closed";
  sensitivity: "normal" | "high" | "restricted";
  ownerLawyerId: string;
  activeRoleAssignments: string[];
  openQuestions: string[];
  nextActions: string[];
  deadlineIds: string[];
  deliverableIds: string[];
};

type Deliverable = {
  deliverableId: string;
  matterId: string;
  kind: "memo" | "demand-letter" | "contract-review" | "brief" | "ppt";
  audience: "internal" | "client" | "counterparty" | "court";
  status: "drafting" | "pending_review" | "approved" | "rendered" | "blocked";
  draftTaskId?: string;
  reviewStatus?: "pending" | "approved" | "rejected" | "modified";
  blockingReasons: string[];
};

type Deadline = {
  deadlineId: string;
  matterId: string;
  title: string;
  dueAt: string;
  severity: "soft" | "hard" | "critical";
  status: "open" | "snoozed" | "completed" | "missed";
  relatedOpenQuestionIds: string[];
};
```

These are not replacements for Markdown truth sources. They are structured operating contracts derived from them.

## Memory refactor

## Memory should become a visible cognition graph

LawMind already has the right truth-source philosophy: Markdown first, derived layers second.

The refactor should preserve that, but make the derived layer more explicit. Memory should be modeled as:

- `FIRM_PROFILE.md`
- `LAWYER_PROFILE.md`
- `CLIENT_PROFILE.md`
- `CASE.md`
- `MATTER_STRATEGY.md`
- `CLAUSE_PLAYBOOK.md`
- `COURT_AND_OPPONENT_PROFILE.md`
- project files and evidence notes
- collaboration artifacts

On top of those files, LawMind should build a **Memory Graph Index** with nodes like:

- profile preference,
- delivery rule,
- client communication norm,
- matter strategy decision,
- clause fallback pattern,
- opponent tendency,
- unresolved factual gap.

Each node should ideally include:

- source file,
- source range or anchor,
- scope,
- updated time,
- confidence,
- conflict flag,
- adoption status.

## Memory write-back should be explicit

Do not silently mutate institutional memory in the background.

LawMind should support three write-back modes:

- `suggested`: queued for adoption,
- `approved`: explicitly accepted into a profile or playbook,
- `temporary`: stored only as runtime working context.

This keeps the system inspectable and lawyer-trustworthy.

## Reasoning refactor

## `LegalReasoningGraph` should become mandatory for high-value work

The reasoning layer is one of LawMind's biggest differentiation opportunities.

For important deliverables, the path should become:

`instruction -> retrieval -> reasoning graph -> draft -> review -> render`

The system should not jump straight from retrieved claims to fluent draft text when the work product is high-risk.

The graph should explicitly support:

- issue trees,
- element-by-element analysis,
- factual support mapping,
- evidence mapping,
- authority comparison,
- conflict resolution notes,
- confidence per issue,
- delivery risk suggestions,
- missing information gates.

## Add a risk register

The reasoning graph should feed a distinct `RiskRegister` object.

This should capture:

- what could be wrong,
- what is unsupported,
- what depends on missing evidence,
- what needs lawyer judgment,
- what can be stated strongly and what must stay hedged.

This will help LawMind feel more like a careful legal assistant than a text generator.

## Role system refactor

## Replace persona-style assistants with bounded legal roles

LawMind should stop treating assistants mostly as named profiles and instead model them as **roles in a digital legal team**.

Recommended default roles:

- intake and triage analyst,
- legal research analyst,
- evidence and chronology analyst,
- drafting analyst,
- review and quality controller,
- client communication drafter,
- compliance and conflict analyst.

Each role should have:

- bounded mission,
- visible tool set,
- visible memory scope,
- risk ceiling,
- default deliverable types,
- review checklist,
- escalation rules,
- learning sink.

## Main agent vs specialist agents

Borrow the Claude Code lesson here:

- the main agent should receive the lawyer's instruction and coordinate the workflow,
- specialist agents should perform narrow jobs like chronology extraction, issue spotting, authority conflict review, tone review, or citation validation.

This is safer and easier to govern than one omnipotent legal assistant.

## Workflow refactor

## Move from tool chains to work queues

A human legal assistant does not think in terms of tool calls. They think in terms of work items.

LawMind should add explicit work queue objects such as:

- `NeedClientInput`
- `NeedEvidence`
- `NeedLawyerApproval`
- `NeedConflictCheck`
- `ReadyToDraft`
- `ReadyToRender`
- `BlockedByDeadline`

These queue objects should be visible in the workbench and should drive next-step recommendations.

## Add escalation and handoff rules

The system should know when to:

- stop and ask,
- stop and escalate,
- continue autonomously,
- request specialist review,
- wait for external input.

This is essential if LawMind is meant to feel like a careful assistant rather than an eager autocomplete.

## Hook and event system

LawMind should formalize more lifecycle events so behavior does not stay trapped inside a single runtime file.

Recommended events:

- `matter_opened`
- `instruction_received`
- `intake_classified`
- `source_ingested`
- `reasoning_built`
- `deliverable_created`
- `review_requested`
- `review_completed`
- `approval_requested`
- `approval_granted`
- `approval_denied`
- `deadline_created`
- `deadline_due_soon`
- `memory_adoption_requested`
- `memory_adopted`
- `quality_snapshot_written`
- `golden_example_promoted`

These events should power:

- UI updates,
- reminder surfaces,
- automation,
- audit records,
- future integrations.

## Workbench refactor

## The default screen should be a matter cockpit, not a blank chat

The desktop workbench should center:

- active matters,
- pending approvals,
- blocked work items,
- upcoming deadlines,
- recent deliverables,
- quality regressions,
- visible memory layers.

Chat remains available, but it should not be the only or primary organizing surface.

## Recommended primary views

- **Matter cockpit**: status, strategy, risks, deadlines, deliverables, next actions
- **Review queue**: drafts waiting for lawyer review, by urgency and audience
- **Memory inspector**: which memory layers are active and which ones influenced the current draft
- **Reasoning board**: issue tree, authority conflicts, confidence, open questions
- **Quality cockpit**: benchmark health, first-pass approval rate, citation integrity, edit rate
- **Role board**: which digital roles are assigned to a matter and what each is doing

## Product behavior that should feel more human

To become "closer to a real assistant," LawMind should proactively handle:

- deadline reminders,
- missing client information,
- open evidence gaps,
- unresolved approval gates,
- mismatched tone for audience,
- stale matter strategy,
- repeated review feedback patterns,
- drafts that should not be rendered yet.

This is where LawMind can move beyond both a generic coding agent and a generic legal copilot.

## Suggested migration path

## Phase 1: stabilize contracts

- freeze the domain contracts around matter, deliverable, approval, deadline, and reasoning graph,
- keep existing engine and agent paths working,
- introduce application services around those contracts,
- reduce direct coupling in desktop server dispatch.

## Phase 2: add explicit orchestration

- introduce work queue states,
- add role-based execution plans,
- formalize escalation rules,
- wire structured events through review, quality, and memory adoption paths.

## Phase 3: move the UI to matter-first

- make matter cockpit the primary surface,
- expose queues, deadlines, approvals, and risks,
- demote chat to one interaction panel inside the matter workspace.

## Phase 4: harden the legal production OS

- benchmark gates as release gates,
- stronger edition-aware governance,
- customer-facing acceptance and support exports,
- richer integration surfaces for enterprise deployment.

## Immediate implementation priorities

If work starts now, the highest-leverage near-term refactor tasks are:

1. Define the matter-centered domain contracts and adopt them in engine and desktop APIs.
2. Turn `LegalReasoningGraph` from a useful feature into a required checkpoint for high-risk drafting.
3. Replace loose assistant behavior with role-bound capabilities and review thresholds.
4. Add explicit work queues for blocked, pending review, pending approval, and waiting-on-client states.
5. Rework the desktop information architecture around matter cockpit, review queue, and memory visibility.

## Non-goals for this refactor

- replacing lawyer judgment,
- hiding key governance logic inside prompt text,
- silently mutating long-term memory without adoption controls,
- expanding to many external channels before the matter operating model is stable,
- prioritizing generic chat polish over legal work-state clarity.

## Final position

OpenClaw demonstrates how to build a robust agent platform. Claude Code demonstrates how to build a governed, extensible agent harness. LawMind should build on both, but its real opportunity is narrower and stronger:

**be the software system that helps legal teams run matters, not only generate legal text.**
