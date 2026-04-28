---
title: "Legal Reasoning Graph"
description: "Structured intermediate reasoning layer between retrieval and drafting — how LawMind structures legal arguments, issue trees, and authority conflicts."
---

# Legal Reasoning Graph

## What it is

The **Legal Reasoning Graph** (`LegalReasoningGraph`) is LawMind's structured intermediate reasoning step placed between the retrieval layer (`ResearchBundle`) and the drafting layer (`ArtifactDraft`).

Its purpose is to make the system **reason like a legal team**, not just write fluently. Instead of going directly from "sources found" to "document generated", LawMind now builds an explicit reasoning structure:

```
ResearchBundle
    └─ buildLegalReasoningGraph()
        └─ LegalReasoningGraph
            └─ buildDraft() / buildDraftAsync()
                └─ ArtifactDraft
```

## What the graph captures

| Component               | Description                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| **Issue tree**          | Each legal issue as a node with elements, facts, evidence, authority references, and open questions |
| **Argument matrix**     | Our position, supporting authority, likely counterarguments, rebuttal paths                         |
| **Authority conflicts** | Where statutes, judicial interpretations, precedents, or internal memos contradict each other       |
| **Delivery risks**      | Where the draft must use cautious language rather than confident conclusions                        |

## How to use it

```typescript
import { buildLegalReasoningGraph, serializeLegalReasoningGraph } from "lawmind";

const graph = buildLegalReasoningGraph({ intent, bundle });

// Inspect the reasoning before drafting
console.log(graph.issueTree.length, "issues identified");
console.log(graph.authorityConflicts.length, "conflicts detected");
console.log("Overall confidence:", Math.round(graph.overallConfidence * 100) + "%");

// Serialize to Markdown for lawyer review or MATTER_STRATEGY.md log
const markdown = serializeLegalReasoningGraph(graph);
```

## Confidence scoring

Each `LegalIssueNode` carries a `confidence` value (0–1) derived from the `ResearchClaim.confidence` scores in the upstream bundle. The `overallConfidence` of the graph is the mean of all issue nodes.

Low-confidence issues (`< 0.5`) automatically generate an additional delivery risk entry advising the drafter to use hedged language.

## Authority conflict detection

Two claims conflict when they share the same source ID but have a confidence gap greater than 0.3. Conflicting pairs are surfaced in `authorityConflicts` with a suggested resolution note asking the lawyer to adjudicate.

## Persistence

**Phase B (automatic JSON):** When a draft is produced, the engine writes `drafts/<taskId>.reasoning.json` next to the research snapshot. This powers `computeIssueCoverageRate` during `recordQuality`.

## Markdown export (optional)

Use `serializeLegalReasoningGraph()` to produce Markdown, then append it to the relevant `MATTER_STRATEGY.md` decision log:

```typescript
import { appendMatterStrategyDecision } from "lawmind";
import { serializeLegalReasoningGraph } from "lawmind";

const md = serializeLegalReasoningGraph(graph);
await appendMatterStrategyDecision(workspaceDir, matterId, md);
```

## Source

`src/lawmind/reasoning/legal-graph.ts` — build, serialize, and parse.  
Tests: `src/lawmind/reasoning/legal-graph.test.ts`
