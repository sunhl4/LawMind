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

- `mock` — fast local smoke test; results are **not** eligible for the release gate.
- `scripted` — runs `engine-scripted-model` shadow replay; results are eligible for the release gate.
- `real` — runs the standard benchmark suite with a live model; requires env/flag gate.

## One-line summary for product / legal readers

> 影子回放分三层：fixture-static 只验证 lint 规则没坏；engine-scripted-model 用真实引擎跑 cassette，召回/精度可以小于 1；real-model 只有配置真模型时才跑，用于最终验证。
