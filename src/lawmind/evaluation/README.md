# LawMind Evaluation / Shadow Replay Layers

This directory contains the benchmark and shadow-replay evaluation system.

## Three layers of evidence

### 1. `fixture-static` (synthetic regression)

- `runShadowReplay` / `runWorkspaceShadowReplay`
- Runs `runLegalLint` directly on the fixture's `engineDraftText`.
- Recall is _constructively_ 1 for the planted rule IDs: the layer only checks that the lint rule still fires on the known-bad text.
- **Not engine evidence.** Use it for lint-rule regression only.

### 2. `engine-scripted-model` (real engine, scripted model)

- `runEngineShadowReplay` / `runWorkspaceEngineShadowReplay`
- The fixture's `modelScript` (a VCR-style cassette) drives the real `runTurn` pipeline.
- The engine actually calls tools (`draft_document`, `update_draft`, etc.), runs real lint, and persists real drafts.
- Recall / precision reflect the engine's actual output and are **allowed to be < 1**.
- This is the default gate evidence for releases: honest engine behavior without requiring live model access.

### 3. `real-model` (live model)

- Enabled only by `LAWMIND_SHADOW_REAL_MODEL=1` or an explicit `--mode real` / `--with-real-model` flag.
- Sends the fixture instruction to the configured real model and runs one real `runTurn`.
- Use for final validation when model/infra is available.

## Benchmark mode mapping

The `lawmind-benchmark` script exposes three modes:

- `mock` — fast local smoke test; results are **not** eligible for the release gate. `--strict` fails this mode. A mock JSON fed to `lawmind:release-readiness` exits 1 (`releaseReadinessBenchmarkExit`).
- `scripted` — runs `engine-scripted-model` shadow replay; results are eligible. `pnpm lawmind:verify:release` uses this mode.
- `real` — live model; requires env/flag gate.

## One-line summary for product / legal readers

> 影子回放分三层：fixture-static 只验证 lint 规则没坏；engine-scripted-model 用真实引擎跑 cassette，召回/精度可以小于 1；real-model 只有配置真模型时才跑，用于最终验证。

### 4. `compaction-fidelity`（压缩保真度，**合成语料自证**）

- `compaction-fidelity.ts`（运行器）+ `compaction-fidelity-cases.ts`（语料与金标）
- 问一个具体问题：**连续压缩之后，模型还能不能读到关键事实？丢在哪一类、第几轮丢？**
- 走真实 `autoCompactSessionHistory` + 真实重注；**不调模型**，所以能进 CI、可复现。
- **这不是现场证据**：语料与金标都是自撰合成。结论只用于机制回归。
  真实评测集需要律师在真案上标注「必需存活的事实」——那还没做。
  报告与 `--json` 输出都带 `provenance: "synthetic-authored"` / `isSynthetic: true`，
  并在 markdown 顶部写明「这不是现场证据」（同 `.lawmind-drill.json` 的自证纪律）。

跑法：

```bash
pnpm lawmind:compaction-fidelity            # 一页纸报告
pnpm lawmind:compaction-fidelity -- --json  # 机器可读（趋势 / CI）
pnpm lawmind:compaction-fidelity -- --rounds 6
```

口径（见 `compaction-fidelity.ts` 头注释）：**critical 全存活 = pass**；非 critical
只**测量**、不据此判失败（测量值本身就是诊断信息，它指出下一步该加固哪一类）；
**首丢轮次**比最终存活数更有诊断价值；留存体积一并报出（不靠囤着不放取胜）；
语料装配错误（金标串不在语料里）**大声失败**，绝不静默报「丢了」。
退出码 non-zero 表示有 critical 丢失，可用于门禁。

这条基准已经captured过两个真实机制缺陷（都当场修在 `agent/` 里）：
① 期限类事实在第 1 轮随要点窗口丢失 → 促成**事实台账**（`agent/compact-fact-pin.ts`）；
② 期限模式过松，填充语「逐条核对期限与金额」被误钉、把真时效挤出 12 条上限
（Chroma 的 distractor 效应）→ 模式收紧为「必须有时间量词」。

## Orchestrator admission (not this directory)

Deliverable recall lives here. **Agent loop / gate / compact / steer / tool-lock changes** must add a true-loop cassette in `src/lawmind/agent/turn-orchestrator-cassettes.test.ts` (`TestLawMind.builder()`). That harness shares the scripted model HTTP server with engine shadow replay, but asserts the next request body rather than planted-lint recall.
