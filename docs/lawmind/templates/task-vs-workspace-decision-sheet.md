# Task-first vs Workspace-first 决策单

> 使用场景：在启动多任务并行前，先判断以“任务切片”还是“工作区稳定面”为主策略。

## 输入评分（1-5）

- taskComplexity（任务复杂度）：
- workspaceVolatility（工作区波动）：
- dependencyDensity（依赖耦合）：
- acceptancePressure（验收压力）：
- contextIsolationRequired（上下文隔离要求）：

## 执行命令

```bash
pnpm lawmind:multitask:decision -- \
  --task-complexity 4 \
  --workspace-volatility 2 \
  --dependency-density 3 \
  --acceptance-pressure 4 \
  --context-isolation 4
```

## 输出记录

- recommendation：
- taskFirst score：
- workspaceFirst score：
- rationale：

## 落地动作

- 若 `task-first`：先冻结 task contract，再按 parallel_group 并行。
- 若 `workspace-first`：先锁共享写路径，再分批恢复 task-first 交付节奏。
