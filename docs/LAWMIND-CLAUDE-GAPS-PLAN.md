# Claude Code 借鉴 — 缺口复盘与执行计划

> 对照 `GOALS.md` 第十期、`LAWMIND-CLAUDE-CODE-SOURCE-REPO-LESSONS.md` §16。  
> **范围**：P0+P1 缺口；**批次 C（P2）** 已于 2026-05-22 落地（子进程工具沙箱、workflow snapshot、团队记忆同步脚手架）。

## 一、已完成项 Review（可合并 PR）

| 模块         | 关键文件                                            | Review 结论                                               |
| ------------ | --------------------------------------------------- | --------------------------------------------------------- |
| 消息预处理   | `lawmind-message-preprocess.ts`                     | 5 步管道清晰；Brief/工具组/澄清置顶与 LawMind 责任链兼容  |
| 虚拟列表     | `LawmindChatMessagesVirtualList.tsx`                | threshold=100 合理；与 preprocess 输出配合                |
| Compose      | `useLawmindChatSend.ts`、`lawmind-compose-prefs.ts` | 队列 ref+microtask 正确；permissionMode 已到 server       |
| 执行内核     | `runtime.ts`、`compact.ts`、`tool-concurrency.ts`   | compact 边界+tool pair；并发批已接入                      |
| Memory       | `relevant-recall.ts`、`session-summary.ts`          | manifest 扫描+去重注入；`append_session_summary` 单路径写 |
| API          | `lawmind-server-route-sessions.ts`、chat SSE        | context-budget/compact/resume；SSE 事件齐全               |
| 批准/任务 UI | `LawmindToolApprovalDialog`、`LawmindTaskDrawer`    | 6 模板+律师免责声明；Dialog 已挂 App                      |
| 运维         | `lawmind-doctor.ts`、policy PATCH                   | MEMORY 计数+高安全一键                                    |

**风险（已接受或待补，P3+）**：流式 compact 未进聊天区；`lm-compose-attachments` 引用文件 chips；`bridge/` 远程控制面；§14 矩阵状态列待 PR 勾选维护。

## 二、缺口清单与执行顺序

### 批次 A — 体验闭环（本次执行）

| #   | 项                                                            | 验收                                           |
| --- | ------------------------------------------------------------- | ---------------------------------------------- |
| A1  | `useLawmindChatSend` 接 `onTokenBudget` / `onCompactBoundary` | 发送中 token 条更新；聊天区出现 compact notice |
| A2  | 命令面板 10 条 + `/review` 跳转                               | palette 含 10 项；review 切主视图              |
| A3  | Action Hub 三 tab（对话 / 案件 / 队列）                       | tab 切换不丢数据                               |
| A4  | TaskDrawer：委派列表 + jobs 轮询                              | 第三 tab「委派」；jobs 8s 刷新                 |
| A5  | `LawmindWorkflowSuggestBanner`                                | 钉选路径匹配 `*.docx` 等时顶栏提示             |
| A6  | E2E：排队 + strict 下拉保留                                   | golden-path 两条                               |
| A7  | SOURCE §16 勾选与 `[~]` 部分项                                | 文档与代码一致                                 |

### 批次 B — 引擎加深（已完成 2026-05-22）

| #   | 项                                              | 验收                                                                                           |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| B1  | `shouldExtractSessionSummary` + turn 末自动追加 | `session-summary.ts` + `runtime.ts`                                                            |
| B2  | recall 小文件优先                               | `lawmind.policy.json` → `memoryRecall.preferSmallFiles` 或 `LAWMIND_RECALL_PREFER_SMALL_FILES` |
| B3  | compact attachment 复灌                         | `collectCompactAttachmentNotes`（草稿/队列/澄清）                                              |
| B4  | 委派 `delegations/<id>.transcript.jsonl`        | `message-bus` + `appendTranscriptLines` opts                                                   |
| B5  | E2E + strict 门禁                               | `approval-queue.spec.ts`；render strict → HTTP 422                                             |
| B6  | TaskDrawer job SSE                              | 运行中 job 最多 3 路 EventSource                                                               |
| B7  | Doctor MCP 说明                                 | `LawmindSettingsDoctor` 配置片段                                                               |

### 批次 C — P2（已完成 2026-05-22）

| #   | 项                          | 验收                                                                                                         |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| C1  | 子进程工具沙箱 + Doctor     | `tool-sandbox.ts` + `subprocessSandboxMiddleware`；`doctor.p2.toolSandbox`；设置页 P2 区块                   |
| C2  | workflow snapshot 入队/预约 | `enqueueWorkflowRun` 写入 `workflowSnapshot`；`processDueScheduledJobs` 无快照则 `missing_workflow_snapshot` |
| C3  | Team Memory 同步脚手架      | `team-memory-sync.ts` firm+opt-in+密钥扫描；默认关闭                                                         |

---

_创建：2026-05-22 · 批次 A 已落地（2026-05-22）_

### 批次 A 完成项

- A1 流式 token/compact → `useLawmindChatSend` + `streamCompactLabels` + composeExtras 提升
- A2 命令面板 10 条 + `/review`
- A3 Action Hub 三 tab
- A4 TaskDrawer 委派 + 8s jobs 轮询
- A5 `LawmindWorkflowSuggestBanner` + `triggerPaths`
- A6 E2E 排队（`e2e-slow` mock）+ strict 下拉
- A7 SOURCE §16 勾选同步

### 批次 B 完成项

- B1 会话摘要阈值 + turn 结束自动写入 `cases/<matter>/session-summary.md`
- B2 `memoryRecall.preferSmallFiles` / env + `recentToolNames` 加权
- B3 compact 后复灌草稿摘录、待办队列、澄清键
- B4 协作委派独立 `sessions/delegations/<delegationId>.transcript.jsonl`
- B5 `approval-queue.spec.ts` + review render strict → 422
- B6 TaskDrawer 对运行中 job 订阅 SSE（最多 3 路）
- B7 Doctor 页 MCP 配置示例

### 批次 C 完成项

- C1 `toolSandbox` / `LAWMIND_TOOL_SANDBOX=1` → 高风险工具子进程执行；Doctor `p2.toolSandbox`
- C2 异步/预约工作流入队时持久化 `workflowSnapshot`；定时 tick 用快照执行
- C3 `teamMemorySync` 仅 Firm+显式 `enabled`；`planTeamMemoryUpload` 含密钥扫描；无默认上传
