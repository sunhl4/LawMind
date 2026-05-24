# LawMind 中断与恢复（Interrupt / Resume）

本文定义律师在澄清、工具批准、案件审批等场景下的**统一待处理契约**，与 LangGraph 式 human-in-the-loop 对齐，但由 LawMind 自有 runtime 实现。

## 1. 概念

| 术语               | 含义                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| **Interrupt**      | Agent 轮次暂停，等待律师输入（`awaiting_clarification` / `awaiting_approval`） |
| **RequiresAction** | 结构化待办项，供桌面「待处理」与聊天卡片消费                                   |
| **Resume**         | `POST /api/chat/resume` 提交律师决定后继续                                     |

## 2. `LawMindRequiresAction`

类型定义：`src/lawmind/platform/requires-action.ts`。

| 字段                                   | 说明                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `id`                                   | 唯一 ID，resume 时提交                                                        |
| `kind`                                 | `clarification` \| `tool_approval` \| `matter_approval` \| `workflow_blocked` |
| `threadId`                             | `matterId:taskId:sessionId`                                                   |
| `title` / `summary`                    | 律师可读文案                                                                  |
| `decisions`                            | 允许操作：`approve` \| `edit` \| `reject` \| `respond`                        |
| `toolName` / `toolCallId` / `toolArgs` | 工具批准专用                                                                  |
| `clarificationQuestions`               | 澄清专用                                                                      |
| `approvalId`                           | 案件审批专用                                                                  |

## 3. 与 `TaskExecutionState` 对照

| AgentTurn.status         | executionState.phase | RequiresAction.kind |
| ------------------------ | -------------------- | ------------------- |
| `awaiting_clarification` | `clarify`            | `clarification`     |
| `awaiting_approval`      | `approval`           | `tool_approval`     |
| `completed`              | `complete`           | （无）              |

## 4. HTTP API

### `POST /api/chat`

响应在 `status` 为 `awaiting_*` 时附带 `requiresAction: LawMindRequiresAction[]`。

### `POST /api/chat/resume`

```json
{
  "sessionId": "…",
  "actionId": "…",
  "decision": "approve",
  "clarificationAnswers": { "amount": "100万" },
  "editedArgs": {}
}
```

| decision             | 适用 kind       | 行为                                  |
| -------------------- | --------------- | ------------------------------------- |
| `respond`            | clarification   | 将答案格式化为用户消息并 `runTurn`    |
| `approve`            | tool_approval   | 下一笔同名工具自动 `__approved: true` |
| `reject`             | tool_approval   | 取消操作，回合完成                    |
| `approve` / `reject` | matter_approval | 见 `POST /api/approvals/resolve`      |

## 5. 会话持久化

- `session.pendingRequiresAction`：最后一轮中断时的待办列表
- `turn.requiresAction`：写入 `sessions/<id>.turns.jsonl` 供审计

## 6. 桌面消费

- 聊天：`LawmindRequiresActionCard` 渲染 `requiresAction`
- 全局：`LawmindActionHub` 聚合 `/api/action-summary` 与 pending approvals

https://docs.lawmind.ai/LAWMIND-INTERRUPT-RESUME
