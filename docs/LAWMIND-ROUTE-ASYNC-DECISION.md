# routeAsync 接入 runTurn 的架构决策记录

## 背景

LawMind 目前有两套路由：

1. **`compileIntent`**（同步）：`src/lawmind/intent/compile-intent.ts`
   - 基于关键词、文件类型、联合规则
   - 无网络调用，毫秒级返回
   - 用于 `runTurn` 决定本轮能力绑定和工具表

2. **`routeAsync`**（异步）：`src/lawmind/router/model-route.ts`
   - 有 LLM 凭据时调用模型分类
   - 失败回退到关键词 `route()`
   - 用于 `engine/planning.ts` 的任务规划

## 当前状态

`runTurn` 使用 `compileIntent`，**未接入** `routeAsync`。

## 不接入的原因（当前决策）

1. **延迟**：`routeAsync` 需要 LLM 调用，增加 500ms-2s 延迟
2. **确定性**：`compileIntent` 是同步确定性的，便于测试和调试
3. **覆盖率**：`compileIntent` 已覆盖高频法律场景（合同审查、函件、诉讼、计算等）
4. **分层**：`runTurn` 是对话层，需要快速响应；`routeAsync` 在规划层，可以慢一些

## 何时考虑接入

如果未来出现以下需求，可以重新评估：

1. **模糊指令增多**：律师输入越来越口语化，关键词覆盖不足
2. **多轮意图漂移**：需要 LLM 理解上下文语义，而不仅是关键词
3. **新办件类型**：关键词规则维护成本高，希望模型自动分类
4. **准确率数据**：有证据表明 `routeAsync` 的 LLM 分类显著优于 `compileIntent`

## 接入方案（备用）

如果决定接入，建议：

```typescript
// runTurn 里
const useModelRouter = await shouldUseModelRouter(session, config);
if (useModelRouter) {
  const modelIntent = await routeAsync({ instruction, ... });
  // 合并 modelIntent 到 compiledIntent，或作为备选
} else {
  const compiledIntent = compileIntent({ ... });
}
```

需要处理：

- 超时和降级（LLM 失败时回退 `compileIntent`）
- 结果合并策略（模型 vs 关键词冲突时谁优先）
- 缓存（相同指令不重复调用 LLM）

## 相关文件

- `src/lawmind/router/model-route.ts` — `routeAsync` 实现
- `src/lawmind/intent/compile-intent.ts` — `compileIntent` 实现
- `src/lawmind/agent/turn-orchestrator.ts` — `runTurn` 入口
- `src/lawmind/engine/planning.ts` — 当前 `routeAsync` 使用处

## 历史

- 2026-09：P0-P3 改造后，`compileIntent` 成为 `runTurn` 唯一路由，`routeAsync` 保留在规划层
