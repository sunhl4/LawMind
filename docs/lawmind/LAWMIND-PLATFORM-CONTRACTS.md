# LawMind Platform Contracts（Big-Bang 冻结版）

本文定义平台级重构使用的统一契约，作为 ingest、agent runtime、desktop API/UI、审计与验证脚本的共享语义源。

## 1. IngestResult

目的：统一 `analyze_document` 与 `read_project_file` 的返回语义，避免“同类失败不同文案/不同字段”。

- `ok=true`：`sourceType`、`content`、`truncated`、`bytes`、`stage`
- `ok=false`：`code`、`stage`、`message`、`hint`

错误码集合（首版）：

- `INGEST_INVALID_PATH`
- `INGEST_NOT_FOUND`
- `INGEST_UNSUPPORTED_FORMAT`
- `INGEST_FILE_TOO_LARGE`
- `INGEST_BINARY_UNSUPPORTED`
- `INGEST_PARSE_FAILED`
- `INGEST_EMPTY_CONTENT`

## 2. TaskExecutionState

目的：统一 runTurn / engine workflow / desktop 展示的执行阶段。

别名：`ExecutionState`（与 `TaskExecutionState` 同义）。

- `phase`: `clarify | plan | research | draft | approval | render | complete | error`
- `status`: `running | awaiting_approval | awaiting_clarification | completed | failed`
- `linkedTaskId` / `existingTaskId`: 续跑与工作台关联语义
- `recoverable`: 是否可重试

## 3. GateDecision

目的：统一门禁判断输出，避免审批/澄清/验收在不同模块重复解释。

- `GateDecisionKind` / `gate`: `clarification_gate | intake_gate | dangerous_tool_gate | approval_gate | acceptance_gate | reasoning_gate | redline_hunks_gate`
- `decision`: `allow | block | awaiting_confirmation`
- `reason`: 可选，供 UI 与审计展示
- `GateCategory` / `category`（可选）: `safety_hard | judgment_soft` — 安全/空交付/未批准/空修订为 `safety_hard`；改稿幅度教练等为 `judgment_soft`

## 4. DeliveryOutcome

目的：统一交付结束态。

- `taskId`
- `reviewStatus`: `pending | approved | rejected | modified`
- `rendered`: 是否已生成正式交付物
- `outputPath`: 可选
- `acceptanceReady`: 可选

## 5. AuditEnvelope

目的：将 ingest / runtime / gate / delivery 的关键可观测字段写成同一审计壳层。

- `eventType`, `taskId`, `sessionId`
- `sourceType`, `ingestStage`, `errorCode`
- `durationMs`
- `gateDecisions[]`

## 6. 当前实现映射

- 类型定义：`src/lawmind/platform/contracts.ts`
- 文档摄入实现：`src/lawmind/agent/tools/legal-tools.ts`
- 执行链与上下文：`src/lawmind/agent/runtime.ts`, `src/lawmind/agent/tools/engine-tools.ts`
- API 汇总层：`apps/lawmind-desktop/server/lawmind-server-route-chat.ts`
- 严格门禁：`scripts/lawmind/lawmind-multitask-validate.ts`

## 7. 迁移原则

1. 先映射，不一次性重命名所有历史字段。
2. 新增字段必须保持向后兼容（旧 UI/脚本不崩）。
3. Strict 门禁最终以本契约字段是否完整作为判定依据之一。

## 8. Health doctor 扩展字段（desktop `/api/health`）

`doctor` 对象在桌面健康检查中扩展以下字段，供 Settings → Doctor 与 readiness strip 消费：

| 字段                   | 含义                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `matterConsistency`    | 案件投影与 `cases/` 目录一致性摘要（`ok`、`issueCount`、可选 `issues[]`）                                   |
| `rateLimit`            | 本地 API 速率限制统计；未启用时为 `null`                                                                    |
| `skipApiAuthWarn`      | 开发/打包环境是否跳过 loopback API 鉴权（`true` 时在 Doctor 显示 WARN）                                     |
| `judgmentHardControls` | 判断类硬控清单：`intakeSoftAsk` / `updateDraftAmplitudeSoft` / `emptyRedlineHard` / `sendEmailApprovalHard` |

实现：`apps/lawmind-desktop/server/lawmind-health-payload.ts`、`lawmind-server-route-health.ts`。
