---
title: "Quality Learning and Benchmarks"
description: "LawMind's quality flywheel: structured review labels, per-task quality snapshots, and repeatable benchmark evaluation."
---

# Quality Learning and Benchmarks

## Overview

LawMind 2.0 treats every lawyer review action as a **learning signal**, not just a status toggle. The quality system has three layers:

| Layer                                                     | What it does                                                |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| **Review labels** (`ReviewLabel`)                         | Structured tags attached to a review action                 |
| **Quality records** (`QualityRecord`)                     | Per-task quality snapshot persisted after review            |
| **Benchmark tasks** (`BenchmarkTask` / `BenchmarkResult`) | Golden test cases for regression testing and release gating |

## Review labels

When a lawyer reviews a draft, they can attach structured labels alongside the free-text note:

```typescript
await engine.review(draft, {
  status: "approved",
  note: "引用不足，已手动补充",
  labels: ["引用不完整", "质量范例"],
});
```

Labels are written back to:

- `LAWYER_PROFILE.md` (personal learning history)
- `assistants/<assistantId>/PROFILE.md` (per-assistant memory)
- `audit.jsonl` (`draft.review_labeled` event)

### Available labels

Current product locale uses **Chinese string identifiers** (stored in quality JSON, audit detail, etc.). `parseReviewLabels` still accepts **legacy English slugs** (for example `citation.incomplete`) and normalizes them to the Chinese form.

| Label（zh）  | Meaning                                                 |
| ------------ | ------------------------------------------------------- |
| 语气过强     | Tone too assertive; softer language advised             |
| 语气过弱     | Conclusion unclear; should be more direct               |
| 引用不完整   | Missing or untraceable citations                        |
| 引用有误     | Wrong statute or case number                            |
| 争点遗漏     | Key legal issue not covered                             |
| 争点过度论证 | Minor issue given disproportionate space                |
| 事实顺序不当 | Fact narrative order needs adjustment                   |
| 事实不准确   | Factual description is incorrect                        |
| 风险偏高     | Risk level overstated                                   |
| 风险偏低     | Risk level understated (highest priority to learn from) |
| 风险未标注   | High-risk point was not flagged                         |
| 受众定位不当 | Client-facing vs. internal framing confused             |
| 模板不匹配   | Wrong template chosen for this task type                |
| 质量范例     | Golden example; promotes to benchmark candidate         |

## Quality records

After a review, call `engine.recordQuality()` to persist a snapshot:

```typescript
const record = await engine.recordQuality(taskId, { labels, latencyMs });
```

Records are stored in `workspace/quality/<taskId>.quality.json`.

Query all records:

```typescript
import { listQualityRecords, buildQualityReportMarkdown } from "lawmind";

const records = await listQualityRecords(workspaceDir);
const report = await buildQualityReportMarkdown(workspaceDir);
```

## Benchmark tasks

LawMind ships with five built-in benchmark tasks covering core workflow types:

| ID                          | Category            | Description                        |
| --------------------------- | ------------------- | ---------------------------------- |
| `bm-contract-review-001`    | Contract review     | Penalty clause risk analysis       |
| `bm-legal-memo-001`         | Legal memo          | Civil Code guarantee reform impact |
| `bm-demand-letter-001`      | Demand letter       | Overdue payment collection         |
| `bm-litigation-outline-001` | Litigation strategy | Contract validity dispute          |
| `bm-client-brief-001`       | Client brief        | Matter update PPT                  |

### Running benchmarks

```typescript
import {
  createLawMindEngine,
  runBenchmarks,
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildBenchmarkReportMarkdown,
} from "lawmind";

const engine = createLawMindEngine({ workspaceDir, adapters });
const results = await runBenchmarks(engine, BUILTIN_BENCHMARK_TASKS);

if (!benchmarkPassesThreshold(results, 0.7)) {
  console.error("Quality gate failed — average score below 70%");
  process.exit(1);
}

console.log(buildBenchmarkReportMarkdown(results, BUILTIN_BENCHMARK_TASKS));
```

### Scoring

Each benchmark result is scored 0–1 from four sub-metrics:

| Sub-metric          | Weight |
| ------------------- | ------ |
| Task kind matched   | 30%    |
| Keyword hit rate    | 30%    |
| Risk level matched  | 20%    |
| Review gate matched | 20%    |

The default pass threshold is **70%** (`benchmarkPassesThreshold(results, 0.7)`).

## Phase B: computed metrics, dashboard, and golden promotion

- **`recordQuality`** fills `citationValidityRate`, `issueCoverageRate`, and `riskRecallRate` using the stored research snapshot (`drafts/<taskId>.research.json`), optional reasoning snapshot (`drafts/<taskId>.reasoning.json`), and `src/lawmind/evaluation/metrics.ts`.
- **`buildQualityDashboardMarkdown`** aggregates snapshots by `taskKind`, `templateId`, and assistant `presetKey`.
- **`质量范例`** on review runs **`promoteGoldenExample`**, writing `golden/<taskId>.golden.json` and appending `golden/golden.jsonl`. Audit: `golden.example_promoted`. Quality snapshots use audit kind `quality.snapshot`.

## Source

- `src/lawmind/evaluation/benchmark.ts` — benchmark definitions and runner
- `src/lawmind/evaluation/quality.ts` — quality record persistence, summary report, **dashboard**
- `src/lawmind/evaluation/metrics.ts` — citation / issue / risk metrics
- `src/lawmind/evaluation/golden.ts` — golden example promotion
- `src/lawmind/evaluation/benchmark.test.ts` — unit tests
- `src/lawmind/types.ts` — `ReviewLabel`, `QualityRecord`, `BenchmarkTask`, `BenchmarkResult`
