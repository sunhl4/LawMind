---
title: Engine vs Agent entrypoints
description: When to use the deterministic LawMind engine versus the LawMind agent runtime.
---

# Engine vs Agent（双入口）

LawMind 提供两条执行入口，职责不同，**不要混用为同一套「真相源」**。

## `createLawMindEngine`（M1 管线）

- **适用**：确定性法律任务闭环——路由 → 检索 → 草稿 → 审核 → 渲染；脚本、`lawmind:ops`、单测黄金路径、需要可重复步骤的自动化。
- **特点**：步骤固定、易测、审计事件与 `TaskRecord` / `ArtifactDraft` 一致性强。

## `createLawMindAgent`（M2 智能体）

- **适用**：开放式对话、多轮澄清、工具组合、协作工作流；律师以自然语言驱动且可中断/续跑的场景。
- **特点**：由模型与工具策略驱动；**领域状态仍应通过工具写入** `tasks/`、`drafts/` 等，而不是假设「聊天记录」即案件状态。

## 共用契约

- 交付物、验收门禁、审计、模板解析 pin（`templateResolvedPin`）等以 **`src/lawmind`** 类型与服务为准。
- 会话 transcript 用于解释与复盘；**对外交付与责任边界**以任务、草稿、审核与审计事件为准。

更多边界说明见 `src/lawmind/application/domain-state.ts`。
