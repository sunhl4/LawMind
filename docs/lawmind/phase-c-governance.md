---
title: "Phase C governance and policy"
description: "Workspace policy file extensions, benchmark gates, and governance reports for firm and enterprise LawMind deployments."
---

# Phase C governance and policy

Phase C turns LawMind from a capable assistant into something **firms can govern and sell**: explicit **edition** labels, **policy files**, **benchmark gates**, and a **governance report** that bundles policy status, quality snapshots, golden examples, and audit volume.

## Workspace policy file

The canonical file is **`lawmind.policy.json`** in the workspace root (same path as [LawMind policy file](/LAWMIND-POLICY-FILE)). The desktop server already applies `allowWebSearch`, `retrievalMode`, and `enableCollaboration`. The engine adds **optional** keys for analytics and CI:

| Key                      | Type                                 | Purpose                                                                |
| ------------------------ | ------------------------------------ | ---------------------------------------------------------------------- |
| `edition`                | `solo` \| `firm` \| `private_deploy` | Product tier label for reports and UI                                  |
| `benchmarkGateMinScore`  | number (0–1)                         | Minimum **mean** benchmark score for a passing gate                    |
| `auditExportCadenceHint` | string                               | Suggested cadence for audit exports (e.g. `P7D`) — documentation-first |

Copy the repository sample `docs/examples/lawmind.policy.json.sample` into your workspace as `lawmind.policy.json` and adjust (do not commit secrets).

## API

```typescript
import {
  readWorkspacePolicyFile,
  evaluateBenchmarkGate,
  buildGovernanceReportMarkdown,
  runBenchmarks,
  BUILTIN_BENCHMARK_TASKS,
} from "lawmind";

const policy = readWorkspacePolicyFile(workspaceDir);
const results = await runBenchmarks(engine, BUILTIN_BENCHMARK_TASKS);
const gate = evaluateBenchmarkGate(policy, results);
if (!gate.ok) {
  console.error(`Benchmark gate failed: mean ${gate.meanScore} < ${gate.minRequired}`);
}
const md = await buildGovernanceReportMarkdown(workspaceDir);
```

## Related

- [LawMind policy file](/LAWMIND-POLICY-FILE)
- [LawMind private deploy](/LAWMIND-PRIVATE-DEPLOY)
- [Quality and benchmarks](/lawmind/quality-and-benchmarks)
- [LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY)

https://docs.lawmind.ai/lawmind/phase-c-governance  
https://docs.lawmind.ai/LAWMIND-POLICY-FILE  
https://docs.lawmind.ai/LAWMIND-PRIVATE-DEPLOY
