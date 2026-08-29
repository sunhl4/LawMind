# Multitask 需求单模板（可执行版）

> 目标：把“需求描述”直接转成可执行任务契约，避免只聊方案不落地。

## 1) 背景与目标

- 业务目标：
- 为什么现在做（时效/风险/收益）：
- 目标完成信号（可量化）：

## 2) 范围与边界

- in_scope：
- out_of_scope：
- 受影响目录（代码/文档/脚本）：

## 3) 并行与冲突策略

- 可并行项（按 parallel_group）：
- 必须串行项：
- shared_write_lock（共享写路径）：
- 冲突仲裁 owner：

## 4) 输入与输出

- inputs（依赖、前置状态、样例数据）：
- outputs（产物路径与格式）：
- 输出格式（JSON/MD/日志/截图）：

## 5) 验收门禁

- 验收标准（功能/质量/UI）：
- 验收命令（必须可复制执行）：
  - `pnpm lawmind:multitask:validate:strict`
  - `pnpm --filter lawmind-desktop typecheck`
  - `pnpm lawmind:docs:build`

## 6) 失败与回退

- 回退触发条件：
- 回退步骤：
- 数据保护要求：

## 7) 决策记录（Task-first vs Workspace-first）

- 采用模式：task-first | workspace-first
- 决策依据：
- 决策命令：
  - `pnpm lawmind:multitask:decision -- --task-complexity 4 --workspace-volatility 2 --dependency-density 3 --acceptance-pressure 4 --context-isolation 4`
