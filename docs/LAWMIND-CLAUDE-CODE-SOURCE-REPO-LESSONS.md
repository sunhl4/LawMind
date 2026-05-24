# LawMind × Claude Code 源码镜像借鉴手册（Gitee 源码版）

> **源码镜像（本文实证来源）**：[gitee.com/maikebing/claude-code](https://gitee.com/maikebing/claude-code) — 约 **1,884** 个 TS/TSX 文件、**512,664** 行（仓库 `README.zh.md` 与本地 `wc` 一致）。仅供防御性安全研究与架构学习；**版权归 Anthropic**，本仓库不主张所有权。  
> **中文分析导读**：[github.com/liuup/claude-code-analysis](https://github.com/liuup/claude-code-analysis) — 见 [`LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md`](./LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md)。  
> **LawMind 实现落点**：`src/lawmind/`、`apps/lawmind-desktop/`。

本文档在 Gitee 源码逐项统计与抽样阅读基础上**细化约三倍**：含目录体量、核心文件职责、关键常量、组件文件清单、与 LawMind 的**文件级对照矩阵**及**可执行实施规格**（含 API/类型/CSS 草案）。

---

## 0. 仓库元数据与克隆验证

| 项                 | 值                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------- |
| URL                | [https://gitee.com/maikebing/claude-code](https://gitee.com/maikebing/claude-code) |
| 顶层               | `README.md`、`README.zh.md`、`src/`                                                |
| TS/TSX 文件        | 1,884                                                                              |
| 总行数             | 512,664                                                                            |
| 打包体积（仅 src） | ~43 MB                                                                             |
| 运行时（README）   | Bun                                                                                |
| UI（README）       | React + Ink（终端）                                                                |

**验证命令（维护者复现）**：

```bash
git clone --depth 1 https://gitee.com/maikebing/claude-code.git
cd claude-code/src
find . \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 wc -l | tail -1
```

---

## 1. `src/` 一级目录体量全表

|    行数 | 文件数 | 目录             | 核心职责                                     |
| ------: | -----: | ---------------- | -------------------------------------------- |
| 180,472 |    564 | `utils/`         | 权限、bash、沙箱、设置、消息、插件、swarm…   |
|  81,546 |    389 | `components/`    | Ink UI：permissions、messages、PromptInput…  |
|  53,680 |    130 | `services/`      | api、mcp、compact、SessionMemory、analytics… |
|  50,828 |    184 | `tools/`         | 42 个工具模块                                |
|  26,428 |    189 | `commands/`      | ~101 斜杠命令模块                            |
|  19,842 |     96 | `ink/`           | 终端渲染、虚拟列表、键盘                     |
|  19,204 |    104 | `hooks/`         | React hooks（权限、输入、历史）              |
|  12,613 |     31 | `bridge/`        | IDE/远程桥接                                 |
|  12,353 |     19 | `cli/`           | CLI 子命令                                   |
|   5,977 |      3 | `screens/`       | REPL、Doctor、Resume                         |
|   4,081 |      4 | `native-ts/`     | 原生 TS 工具                                 |
|   4,066 |     20 | `skills/`        | Skills 发现与实例化                          |
|   4,051 |      8 | `entrypoints/`   | cli、init、mcp 入口                          |
|   3,446 |     11 | `types/`         | 消息、权限、日志类型                         |
|   3,286 |     12 | `tasks/`         | 后台任务状态机                               |
|   3,159 |     14 | `keybindings/`   | 快捷键                                       |
|   2,648 |     21 | `constants/`     | 常量                                         |
|   1,758 |      1 | `bootstrap/`     | 会话/远程状态                                |
|   1,736 |      8 | `memdir/`        | Memory 文件协议                              |
|   1,513 |      5 | `vim/`           | Vim 模式                                     |
|   1,298 |      6 | `buddy/`         | 伴侣精灵 UI                                  |
|   1,190 |      6 | `state/`         | AppState store                               |
|   1,127 |      4 | `remote/`        | 远程会话                                     |
|   1,004 |      9 | `context/`       | 通知等上下文                                 |
|     740 |      2 | `upstreamproxy/` | 代理                                         |
|     652 |      4 | `query/`         | 查询管道辅助                                 |
|     603 |     11 | `migrations/`    | 设置迁移                                     |
|     369 |      1 | `coordinator/`   | 协调模式                                     |
|     358 |      3 | `server/`        | 服务器模式                                   |
|     222 |      1 | `schemas/`       | Zod hooks schema                             |
|     182 |      2 | `plugins/`       | 插件                                         |
|      98 |      1 | `outputStyles/`  | 输出样式                                     |
|      87 |      1 | `assistant/`     | assistant 会话历史                           |
|      54 |      1 | `voice/`         | 语音                                         |
|      25 |      1 | `moreright/`     | UI 细节                                      |

**单文件核心行数**：

| 文件                                     |   行数 | 角色                      |
| ---------------------------------------- | -----: | ------------------------- |
| `utils/sessionStorage.ts`                | ~5,106 | JSONL transcript 读写恢复 |
| `components/PromptInput/PromptInput.tsx` | ~2,339 | 输入编排器                |
| `main.tsx`                               |  4,683 | 启动总控                  |
| `query.ts`                               |  1,729 | 主循环                    |
| `QueryEngine.ts`                         |  1,295 | 无 UI 引擎                |
| `Tool.ts`                                |    792 | 工具协议                  |
| `commands.ts`                            |    754 | 命令注册                  |

---

## 2. `utils/` 子目录（180k 行拆解）

|   行数 | 子目录              | LawMind 是否需对等 | 说明                                        |
| -----: | ------------------- | ------------------ | ------------------------------------------- |
| 20,521 | `plugins/`          | 低                 | 插件生态；LawMind 用 bundle 签名即可        |
| 12,306 | `bash/`             | 低                 | 法律桌面默认不提供 shell                    |
|  9,409 | `permissions/`      | **高**             | 规则、matcher、deny/ask/auto                |
|  7,548 | `swarm/`            | 低                 | tmux/iterm 多 agent；LawMind 用 Role 委派   |
|  4,562 | `settings/`         | **高**             | settings 热更新；对标 `lawmind.policy.json` |
|  4,044 | `telemetry/`        | 中                 | 仅本地诊断，不上传源码路径                  |
|  3,721 | `hooks/`            | 中                 | postSamplingHooks                           |
|  3,069 | `shell/`            | 低                 |                                             |
|    997 | `sandbox/`          | **高**             | 沙箱适配；对标子进程隔离 POC                |
|    386 | `messages/`         | **高**             | normalize、compact 边界                     |
|  1,765 | `processUserInput/` | 中                 | slash、负面词标记（不照搬上传）             |

**工程教训**：不要把 18 万行 utils 搬进 LawMind；按域新建 `src/lawmind/runtime/`、`src/lawmind/agent/` 子模块，单文件控制在可维护规模（参考 GOALS「巨型文件」短板）。

---

## 3. `services/` 子目录

|   行数 | 服务               | 关键文件                                                  | LawMind 移植                        |
| -----: | ------------------ | --------------------------------------------------------- | ----------------------------------- |
| 12,310 | `mcp/`             | `client.ts`、`mcpStringUtils.ts`                          | P1 只读 MCP server                  |
| 10,477 | `api/`             | `claude.ts`、bootstrap、errors                            | 已有 model adapter；对齐 retry/流式 |
|  3,960 | `compact/`         | `autoCompact.ts`、`compact.ts`、`sessionMemoryCompact.ts` | **P0** `agent/compact.ts`           |
|  2,167 | `teamMemorySync/`  | `index.ts`、`watcher.ts`                                  | P2 firm                             |
|  1,026 | `SessionMemory/`   | `sessionMemory.ts`                                        | **P0** `memory/session-summary.ts`  |
|    769 | `extractMemories/` | 自动提炼                                                  | P1 可选                             |
|  4,040 | `analytics/`       | GrowthBook、Datadog                                       | 不照搬；本地 insights               |

### 3.1 `autoCompact.ts` 关键常量（源码）

```typescript
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000;
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000;
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000;
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3;
```

**LawMind 对应配置**（建议 `lawmind.policy.json`）：

```json
{
  "context": {
    "autoCompactBufferTokens": 13000,
    "maxConsecutiveCompactFailures": 3,
    "summaryOutputTokenReserve": 20000
  }
}
```

### 3.2 MCP 工具命名

```typescript
// mcpStringUtils.ts
`mcp__${serverName}__${toolName}`;
```

LawMind 若暴露 MCP：`lawmind__matters__list`、`lawmind__drafts__get` 等，避免与内建工具冲突。

---

## 4. `tools/` 全模块行数（42 个）

|   行数 | 模块                          | LawMind 工具/能力                 |
| -----: | ----------------------------- | --------------------------------- |
| 12,411 | `BashTool/`                   | 不提供（或 firm 沙箱终端）        |
|  8,959 | `PowerShellTool/`             | 无                                |
|  6,782 | `AgentTool/`                  | `delegate_to_role`、collaboration |
|  2,005 | `LSPTool/`                    | 远期法条/合同 LSP                 |
|  1,812 | `FileEditTool/`               | 工作区写草稿                      |
|  1,602 | `FileReadTool/`               | `read_project_file`               |
|  1,477 | `SkillTool/`                  | workflow 启动                     |
|  1,131 | `WebFetchTool/`               | policy 控制的外联                 |
|  1,086 | `MCPTool/`                    | MCP 调用                          |
|    856 | `FileWriteTool/`              | 写文件                            |
|    795 | `GrepTool/`                   | 代码库检索类比 `search_workspace` |
|    610 | `BriefTool/`                  | 「仅交付」视图过滤                |
|    605 | `ExitPlanModeTool/`           | Plan 模式；可对表多步 clarify     |
|    593 | `ToolSearchTool/`             | 延迟工具发现                      |
|    587 | `NotebookEditTool/`           | 无                                |
|    584 | `TaskOutputTool/`             | `GET /api/jobs/:id`               |
|    569 | `WebSearchTool/`              | 联网检索（policy）                |
|      … | `TaskCreate/Update/List/Stop` | jobs 系统                         |
|      … | `TeamCreate/Delete`           | 协作团队                          |
|      … | `Enter/ExitWorktreeTool`      | git 工作树；无 direct 需求        |
|      … | `AskUserQuestionTool/`        | 澄清表单                          |

每个工具目录典型结构：`Tool.ts`、`prompt.ts`、`constants.ts`、可选 `UI.tsx` — LawMind 宜在 `src/lawmind/agent/tools/` 每工具 **metadata + execute + optional renderHint**。

---

## 5. `commands/` 斜杠命令（~101 模块）

**抽样列表**（`src/commands/` 目录）：

`compact`、`config`、`context`、`cost`、`doctor`、`memory`、`mcp`、`skills`、`tasks`、`resume`、`diff`、`commit`、`review`、`login`、`theme`、`desktop`、`bridge`、`agents`、`export`、`help`、`vim`、`pr_comments`、`add-dir`、`feedback`、`env`、`effort`、`fast`、`files`、`heapdump`、`insights`…

**LawMind 映射表**（Electron 内「/」面板，非 shell）：

| Claude 命令 | LawMind API / UI                   | 律师可见文案           |
| ----------- | ---------------------------------- | ---------------------- |
| `/compact`  | `POST /api/sessions/:id/compact`   | 压缩对话，保留案件摘要 |
| `/doctor`   | `GET /api/health` + 设置 Doctor 节 | 系统体检               |
| `/memory`   | 打开 MemoryInspector               | 记忆库                 |
| `/tasks`    | `LawmindTaskDrawer`                | 后台任务               |
| `/context`  | 新 route：context 用量             | 上下文用量             |
| `/cost`     | edition 用量（本地）               | 用量统计               |
| `/resume`   | `GET /api/sessions`                | 继续上次对话           |
| `/config`   | 设置 shell                         | 设置                   |
| `/review`   | 跳转 `ReviewWorkbench`             | 审核台                 |

实现：`lawmind-chat-shell.tsx` 监听 `/` → `LawmindCommandPalette.tsx`（新建）。

---

## 6. 执行内核（`query.ts` + `QueryEngine.ts`）

### 6.1 `query.ts` 主循环依赖图（import 级）

1. `normalizeMessagesForAPI` / compact 边界
2. `autoCompactIfNeeded`
3. `startRelevantMemoryPrefetch` / attachments
4. 流式 `claudeApi`
5. `runTools` → `toolOrchestration`
6. `executePostSamplingHooks`
7. `generateToolUseSummary`
8. `messageQueueManager`（排队命令）

### 6.2 `toolOrchestration.ts` 并发

```typescript
function getMaxToolUseConcurrency(): number {
  return parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || "", 10) || 10;
}
// partitionToolCalls → isConcurrencySafe 批次并发，否则串行
```

**LawMind 新建**：`src/lawmind/runtime/tool-concurrency.ts`

```typescript
export type ToolCallBatch = { concurrencySafe: boolean; calls: ToolCallRef[] };

export function partitionToolCalls(calls: ToolCallRef[], ctx: AgentContext): ToolCallBatch[] {
  /* 同 Claude reduce 逻辑 */
}
```

环境变量对标：`LAWMIND_MAX_TOOL_CONCURRENCY`（默认 4，法律场景偏保守）。

### 6.3 `StreamEvent` 建议（LawMind 统一协议）

```typescript
// src/lawmind/agent/stream-events.ts（建议新建）
export type LawmindStreamEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_start"; toolCallId: string; name: string; argsPreview: string }
  | { type: "tool_progress"; toolCallId: string; label?: string }
  | { type: "tool_end"; toolCallId: string; ok: boolean; summary?: string }
  | { type: "requires_action"; payload: LawMindRequiresAction }
  | { type: "clarification"; questions: ClarificationQuestion[] }
  | { type: "compact_boundary"; sessionSummaryPath?: string }
  | {
      type: "token_budget";
      used: number;
      effectiveLimit: number;
      level: "ok" | "warn" | "compact";
    };
```

**消费者**：

- `apps/lawmind-desktop/.../LawmindChatThoughtPanel.tsx`
- `LawmindChatExecutionTrace.tsx`
- 未来 SSE：`GET /api/chat/stream` 与 jobs stream 同型

### 6.4 与现有 `tool-pipeline.ts` 关系

当前中间件链（已有）：budget → roleAllowlist → approval → clarificationGate → argSchema → timeout → audit → execute。

**插入点**：execute 前对**同批** tool_calls 先 `partitionToolCalls`，只读批用 `Promise.all`，写批串行。

---

## 7. `memdir/` + Session Memory（源码级）

### 7.1 文件职责表

| 文件                      | 导出                                                | 行为摘要                     |
| ------------------------- | --------------------------------------------------- | ---------------------------- |
| `memdir.ts`               | `buildMemoryPrompt`, `truncateEntrypointContent`    | MEMORY.md 200 行 / 25KB 截断 |
| `findRelevantMemories.ts` | `findRelevantMemories`                              | sideQuery 选 ≤5 文件         |
| `memoryScan.ts`           | `scanMemoryFiles`, `formatMemoryManifest`           | 仅 header                    |
| `paths.ts`                | `isAutoMemoryEnabled`, `getMemoryBaseDir`           | 多级开关                     |
| `teamMemPaths.ts`         | `validateTeamMemWritePath`                          | 团队 memory 路径校验         |
| `sessionMemory.ts`        | `shouldExtractMemory`, `createMemoryFileCanUseTool` | 摘要 agent 沙箱              |

### 7.2 `findRelevantMemories` 算法（逐步）

1. `scanMemoryFiles(memoryDir)` → `MemoryHeader[]`
2. 过滤 `alreadySurfaced`
3. `formatMemoryManifest` → 文本清单
4. `sideQuery` + `SELECT_MEMORIES_SYSTEM_PROMPT`（最多 5）
5. `recentTools`：跳过工具使用文档，保留 gotcha
6. 返回 `{ path, mtimeMs }[]`

**LawMind 实现**：`src/lawmind/memory/relevant-recall.ts`

```typescript
export async function findRelevantMemoriesForTurn(opts: {
  workspaceDir: string;
  matterId?: string;
  query: string;
  alreadySurfaced: ReadonlySet<string>;
  recentToolNames: readonly string[];
  signal: AbortSignal;
}): Promise<Array<{ relativePath: string; mtimeMs: number }>>;
```

**目录映射**：

| Claude                                 | LawMind                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| `<memoryBase>/projects/<repo>/memory/` | `workspace/memory/topics/`                                    |
| `MEMORY.md`                            | `workspace/MEMORY.md`                                         |
| agent-memory                           | `assistants/<id>/PROFILE.md` + 未来 `agent-memory-snapshots/` |
| session memory 文件                    | `workspace/cases/<id>/session-summary.md`                     |

### 7.3 Session Memory 沙箱（须原样借鉴安全模型）

`createMemoryFileCanUseTool(memoryPath)`：**仅**允许 `FileEdit` 且 `file_path === memoryPath`，否则 deny。

LawMind 摘要 subagent：

- 工具：仅 `append_session_summary` 或等价单路径写
- 路径：`cases/<matterId>/session-summary.md`
- 权限：pipeline 层硬编码

### 7.4 `compact` + Session Memory

`trySessionMemoryCompaction`：有 SM 时 **不另调 API** 做全文总结，用 SM 作 `SummaryMessage`。

LawMind `agent/compact.ts` 流程：

1. `stripImagesFromMessages`（若有多模态）
2. 若有 `session-summary.md` → 作边界
3. 否则调用便宜模型生成摘要
4. `adjustIndexToPreserveToolPairs(messages)`
5. `buildPostCompactAttachments({ matterId, taskId, deliverableType, pendingApprovals })`

---

## 8. `sessionStorage.ts`（~5106 行）持久化规格

### 8.1 核心设计

- **Append-only JSONL** per session
- `isTranscriptMessage`：仅 user/assistant/attachment/system
- **progress 不写入** transcript（防 parentUuid 链断裂）
- subagent：`.../subagents/agent-<id>.jsonl`
- 恢复：`conversationRecovery.ts` 修 compact/snip/parallel tool

### 8.2 LawMind 目录布局

```text
<lawmind-root>/
  sessions/
    index.json                 # { id, title, matterId, updatedAt, tags[] }
    <sessionId>.jsonl
    <sessionId>/
      subagents/
        role-<roleId>.jsonl
```

### 8.3 API 草案

| 方法   | 路径                             | 说明                      |
| ------ | -------------------------------- | ------------------------- |
| GET    | `/api/sessions?matterId=&limit=` | 列表                      |
| GET    | `/api/sessions/:id`              | 元数据 + 末条预览         |
| POST   | `/api/sessions/:id/resume`       | 加载 JSONL → 注入 runtime |
| POST   | `/api/sessions/:id/compact`      | 手动 compact              |
| DELETE | `/api/sessions/:id`              | 可选：隐私删除            |

### 8.4 桌面 UI

- 侧栏「对话历史」按 matter 分组
- 每项：标题、时间、待批准数、`interrupted` 标记（对标 jobs）
- 点击 → 恢复 session 到 `lawmind-chat-shell`

---

## 9. `skills/loadSkillsDir.ts` 规格

### 9.1 发现顺序（`getSkillDirCommands`）

1. managed `policySettings`
2. user `~/.claude/skills`
3. project 向上爬 `.claude/skills`
4. `--add-dir`
5. legacy commands 目录
6. `deduplicateByRealpath`

### 9.2 Frontmatter → LawMind workflow schema

```typescript
// src/lawmind/workflows/types.ts（扩展）
export type LawmindWorkflowDefinition = {
  id: string;
  title: string;
  description: string;
  whenToUse?: string;
  roleId?: string;
  deliverableType?: string;
  allowedToolNames?: string[];
  triggerPaths?: string[]; // glob，对标 paths
  userInvocable?: boolean; // 默认 true
  runMode?: "inline" | "fork";
  acceptancePackRequired?: boolean;
  requiredSources?: string[];
};
```

### 9.3 条件触发 UI

`LawmindWorkflowLibrary` + 文件/workbench 打开时：

- 匹配 `triggerPaths` → 顶栏 `lm-workflow-suggest-banner`
- 一键 `POST /api/collaboration/workflow-run` 或单助手 execute

---

## 10. `components/` UI 百科全书（81,546 行）

### 10.1 组件族 TOP 表

|   行数 | 文件数 | 目录             | LawMind 对标                        |
| -----: | -----: | ---------------- | ----------------------------------- |
| 12,155 |    15+ | `permissions/`   | `LawmindToolApprovalDialog` + cards |
|  6,016 |     33 | `messages/`      | 拆分 `LawmindMsg*`                  |
|  5,161 |     21 | `PromptInput/`   | `LawmindChatComposeFooter` 扩展     |
|  4,524 |     13 | `agents/`        | `LawmindSettingsAssistants`         |
|  3,938 |     12 | `tasks/`         | `LawmindTaskDrawer`                 |
|  3,920 |     12 | `mcp/`           | `LawmindSettingsTools`              |
|  3,019 |     10 | `CustomSelect/`  | `lm-compose-select`                 |
|  2,573 |      4 | `Settings/`      | `lawmind-settings-shell`            |
|  2,238 |     16 | `design-system/` | 已有 `lm-wizard`、`lm-btn`          |
|    695 |      5 | `sandbox/`       | Doctor 沙箱节                       |
|    481 |      2 | `memory/`        | `MemoryInspector`                   |

### 10.2 `Messages.tsx` 预处理（实现清单）

在 `apps/lawmind-desktop/src/renderer/lawmind-message-preprocess.ts`（新建）实现：

```typescript
export type PreprocessOptions = {
  briefOnly?: boolean;
  collapseSearch?: boolean;
  groupTools?: boolean;
};

export function preprocessChatMessages(
  messages: ChatMsg[],
  opts: PreprocessOptions,
): RenderableChatItem[];
```

| 函数                      | 对标 Claude                | 逻辑要点                        |
| ------------------------- | -------------------------- | ------------------------------- |
| `normalizeChatMsgs`       | `normalizeMessages`        | 统一 id、role、tool 活动        |
| `promoteClarification`    | `reorderMessagesInUI`      | 待澄清 assistant 置顶           |
| `collapseSearchResults`   | `collapseReadSearchGroups` | 检索>20条折叠                   |
| `groupToolActivities`     | `applyGrouping`            | 连续 tool 合并                  |
| `filterBriefDeliverables` | `filterForBriefTool`       | 仅保留带 deliverable 标记的轮次 |

### 10.3 `VirtualMessageList` 性能策略

Claude 注释（源码）：LogoHeader 必须 memo，否则 2800 条消息 blit 失效 CPU 100%。

LawMind（DOM）：

- 消息 `length > 100` → `@tanstack/react-virtual` 或 `react-window`
- 头部 `LawmindReadinessStrip` + matter 条 `React.memo`
- 离屏：`content-visibility: auto; contain-intrinsic-size: auto 120px`

### 10.4 `PromptInput` 子文件映射

| Claude 文件                     | 行数级 | LawMind                            |
| ------------------------------- | ------ | ---------------------------------- |
| `PromptInput.tsx`               | 2339   | `LawmindChatComposeFooter` + shell |
| `PromptInputFooter.tsx`         |        | `lm-compose-toolbar`               |
| `PromptInputQueuedCommands.tsx` |        | `lm-compose-queue`（新）           |
| `PromptInputStashNotice.tsx`    |        | `lm-compose-stash`（新）           |
| `HistorySearchInput.tsx`        |        | 会话内搜索面板（新）               |
| `Notifications.tsx`             |        | 合并 readiness/model hint          |
| `inputModes.ts`                 |        | permission mode enum               |

### 10.5 `permissions/PermissionRequest.tsx` switch 表

源码按 `tool` 引用分发：

- `FileEditTool` → `FileEditPermissionRequest`
- `FileWriteTool` → `FileWritePermissionRequest`
- `BashTool` → `BashPermissionRequest`
- `WebFetchTool` → `WebFetchPermissionRequest`
- `SkillTool` → `SkillPermissionRequest`
- `AskUserQuestionTool` → `AskUserQuestionPermissionRequest`
- `Glob/Grep/FileRead` → `FilesystemPermissionRequest`
- default → `FallbackPermissionRequest`

**LawMind `LawmindToolApprovalDialog.tsx`（新建）**：

```typescript
export function resolveApprovalTemplate(toolName: string): ApprovalTemplate {
  if (WRITE_TOOLS.has(toolName)) return "diff";
  if (READ_TOOLS.has(toolName)) return "readonly";
  if (toolName === "render_document") return "acceptance";
  if (toolName === "execute_workflow") return "workflow";
  if (toolName === "web_search") return "network";
  return "generic";
}
```

### 10.6 `messages/` 叶组件清单（33 目录文件 — 应对表）

| Claude 叶组件              | LawMind 组件（建议）         |
| -------------------------- | ---------------------------- |
| `AssistantTextMessage`     | `LawmindMsgAssistant`        |
| `AssistantThinkingMessage` | 已有 thought panel           |
| `AssistantToolUseMessage`  | `LawmindMsgToolUse`          |
| `UserToolResultMessage`    | 折叠进 tool group            |
| `PlanApprovalMessage`      | `LawmindMsgWorkflowApproval` |
| `RateLimitMessage`         | `LawmindMsgRateLimit`        |
| `UserBashInput/Output`     | 无或 firm only               |
| `UserMemoryInput`          | `LawmindMsgMemoryHint`       |
| `SystemTextMessage`        | `LawmindMsgSystem`           |

### 10.7 `AppStateStore.ts` 字段 → LawMind shell

| `AppState` 字段         | LawMind `lawmind-app-shell` / hooks |
| ----------------------- | ----------------------------------- |
| `toolPermissionContext` | tool policy + pending approvals     |
| `mainLoopModel`         | `selectedModelId`                   |
| `tasks`                 | jobs + delegations                  |
| `agentDefinitions`      | assistants + roles                  |
| `isBriefOnly`           | `briefOnly` UI state                |
| `footerSelection`       | actionHubFocus                      |
| `settings`              | workspace + policy cache            |

### 10.8 `screens/`

| 文件                     | LawMind                 |
| ------------------------ | ----------------------- |
| `REPL.tsx`               | `App.tsx` 主布局        |
| `Doctor.tsx`             | `LawmindSettingsDoctor` |
| `ResumeConversation.tsx` | 新：会话列表 + resume   |

---

## 11. `state/` + `hooks/` + `bridge/`

- `hooks/useCanUseTool.ts`：权限回调；对标 server 侧 `requires_action` 循环
- `hooks/useCommandQueue.ts`：排队；对标 `useLawmindChatSend` 扩展
- `bridge/bridgeMain.ts`：WebSocket 远程；LawMind 非 P0

---

## 12. Sandbox（`BashTool` + `utils/sandbox`）

### 12.1 四层链（源码注释）

1. `shouldUseSandbox(input)`
2. `convertToSandboxRuntimeConfig(settings)`
3. `bashPermissions.checkSandboxAutoAllow`
4. `Shell.ts` + `cleanupAfterCommand`

### 12.2 LawMind

- 无 Bash → 对 **写文件、渲染、外联** 做子进程 + allowlist
- `LawmindSettingsDoctor` 增加：
  - `sandboxAvailable: boolean`
  - `networkAllowlist: string[]`
  - `matterScopeEnforced: boolean`

---

## 13. LawMind 现有实现 × 源码差距（精细）

| 已有          | 路径                            | 源码启示                   | 下一步           |
| ------------- | ------------------------------- | -------------------------- | ---------------- |
| Thought 面板  | `LawmindChatThoughtPanel.tsx`   | `AssistantThinkingMessage` | 绑定 StreamEvent |
| 执行轨迹      | `LawmindChatExecutionTrace.tsx` | tool leaves                | 按工具类型图标   |
| 批准队列      | `LawmindApprovalQueue.tsx`      | `permissions/*`            | 置顶 Action Hub  |
| 需操作卡片    | `LawmindRequiresActionCard.tsx` | sticky permission footer   | 与 Dialog 分工   |
| 澄清条        | `lm-clarify-session-bar`        | AskUserQuestion            | 保持             |
| Compose       | `LawmindChatComposeFooter`      | `PromptInput` 2339 行      | §10.4 扩展       |
| Tool pipeline | `tool-pipeline.ts`              | `toolOrchestration`        | 加并发分批       |
| compact       | `compactHistory()`              | `compact/*` 3960 行        | 重写 compact     |
| Memory        | `memory/index.ts`               | `memdir`+SM                | recall+SM        |
| Jobs SSE      | `lawmind-server-route-jobs.ts`  | `tasks/*`                  | TaskDrawer       |
| Readiness     | `LawmindReadinessStrip.tsx`     | StatusNotices              | 全就绪隐藏已有   |

---

## 14. 文件级对照矩阵（实施 PR 用）

| Gitee 路径                            |   行数 | LawMind 目标                    | 动作                              |
| ------------------------------------- | -----: | ------------------------------- | --------------------------------- |
| `query.ts`                            |   1729 | `agent/runtime.ts`              | 发 StreamEvent；挂 compact/recall |
| `QueryEngine.ts`                      |   1295 | `agent/headless.ts`（可选）     | SDK/无 UI                         |
| `services/tools/toolOrchestration.ts` |   ~189 | `runtime/tool-concurrency.ts`   | 新建                              |
| `Tool.ts`                             |    792 | `agent/types.ts`                | 扩展元数据                        |
| `memdir/findRelevantMemories.ts`      |   ~142 | `memory/relevant-recall.ts`     | 新建                              |
| `services/SessionMemory/*`            |  ~1026 | `memory/session-summary.ts`     | 新建                              |
| `services/compact/*`                  |  ~3960 | `agent/compact.ts`              | 新建                              |
| `utils/sessionStorage.ts`             |  ~5106 | `adapters/session-transcript/`  | 新建                              |
| `skills/loadSkillsDir.ts`             |  ~1087 | `workflows/types.ts` + loader   | 扩展                              |
| `components/Messages.tsx`             |   ~834 | `lawmind-message-preprocess.ts` | 新建                              |
| `components/PromptInput/*`            |  ~5161 | `lawmind-chat-shell.tsx`        | 扩展 CSS/HTML                     |
| `components/permissions/*`            | ~12155 | `LawmindToolApprovalDialog.tsx` | 新建                              |
| `components/tasks/*`                  |  ~3938 | `LawmindTaskDrawer.tsx`         | 新建                              |
| `state/AppStateStore.ts`              |   ~570 | `lawmind-app-shell.ts`          | 字段对齐                          |
| `screens/ResumeConversation.tsx`      |        | 新页面/侧栏                     | resume                            |

---

## 15. CSS / 组件类名规格（`styles.css`）

在 [`LAWMIND-DESKTOP-UI.md`](./LAWMIND-DESKTOP-UI.md) 同步新增：

| 类名                         | 用途               |
| ---------------------------- | ------------------ |
| `lm-compose-queue`           | 排队发送列表       |
| `lm-compose-permission-mode` | 标准/严格/只读     |
| `lm-compose-token-bar`       | 上下文/token 条    |
| `lm-compose-pending-badge`   | 待批准计数         |
| `lm-compose-stash`           | 草稿暂存提示       |
| `lm-command-palette`         | `/` 命令面板       |
| `lm-msg-tool-group`          | 折叠工具组         |
| `lm-msg-compact-notice`      | 压缩边界提示       |
| `lm-task-drawer`             | 任务抽屉           |
| `lm-approval-dialog`         | 模态批准           |
| `lm-workflow-suggest-banner` | 条件 workflow 推荐 |

配色：沿用 `--warn` 澄清、`--error` 危险工具、`--ok` 只读工具。

---

## 16. 分阶段实施规格（可拆 Issue）

### P0-A Compose（1–2 周）

**文件**：`lawmind-chat-shell.tsx`、`styles.css`、`useLawmindChatSend.ts`

- [x] `lm-compose-queue`：`loading === true` 时后续发送入队
- [x] `permissionMode: 'standard' | 'strict' | 'readonly'` 写入请求体
- [x] `GET /api/sessions/:id/context-budget` 显示 token 条
- [x] `lm-compose-pending-badge`：`GET /api/action-summary` count
- [x] `LawmindCommandPalette`：10 条律师命令

**验收**：E2E 可排队发送；strict 下未批准写工具 403。

### P0-B Messages（1–2 周）

**文件**：`lawmind-message-preprocess.ts`、`lawmind-chat-shell.tsx`

- [x] 预处理管道 5 步
- [x] > 100 条虚拟列表
- [x] brief toggle
- [x] 会话内 ⌘F 搜索（先 DOM filter，后 FTS）

### P0-C Approvals & Tasks（1 周）

**文件**：`LawmindToolApprovalDialog.tsx`、`LawmindTaskDrawer.tsx`、`App.tsx` 侧栏

- [x] Dialog 6 模板
- [x] TaskDrawer：jobs SSE + approvals 合并（8s 轮询 + 委派 tab + 运行中 job SSE）
- [x] Action Hub 三 tab

### P1-A Memory（2 周）

**文件**：`memory/relevant-recall.ts`、`memory/index.ts`、`runtime.ts`

- [x] manifest 扫描 + 小文件优先召回（`memoryRecall.preferSmallFiles`）
- [x] `alreadySurfaced` 会话字段
- [x] doctor：MEMORY 索引校验

### P1-B Compact（2 周）

**文件**：`agent/compact.ts`、`agent/session.ts`、`policy`

- [x] 常量 13000/3/20000
- [x] tool pair 保护
- [x] 复灌 attachment（`collectCompactAttachmentNotes`：草稿/队列/澄清 + CASE 片段）
- [x] 手动 `POST .../compact`

### P1-C Transcript（2 周）

**文件**：`adapters/session-transcript/`、routes、侧栏 UI

- [x] JSONL append on each turn
- [x] resume 修复链
- [x] subagent jsonl for collaboration（`sessions/delegations/<id>.transcript.jsonl`）

### P2

- [x] MCP read-only server（`mcp-readonly-server.ts` + Doctor 设置页连接说明）
- [x] 子进程工具沙箱（`tool-sandbox.ts`、`subprocessSandboxMiddleware`；`toolSandbox` / `LAWMIND_TOOL_SANDBOX=1`；Doctor `p2`）
- [x] workflow snapshot 入队/预约（`lawmind-server-jobs.ts` `workflowSnapshot`；`missing_workflow_snapshot` 兜底）
- [x] Team Memory 同步脚手架（`team-memory-sync.ts` firm opt-in + 密钥扫描；默认关闭）

---

## 17. 测试策略

| 层   | 对标 Claude 测试点          | LawMind                                 |
| ---- | --------------------------- | --------------------------------------- |
| 单元 | `partitionToolCalls` 批次数 | `tool-concurrency.test.ts`              |
| 单元 | `truncateEntrypointContent` | `memory-index.test.ts`                  |
| 单元 | `shouldExtractMemory` 阈值  | `session-summary.test.ts`               |
| 集成 | compact 后 tool 链合法      | `agent/compact.test.ts`                 |
| API  | resume 不丢 approval        | `lawmind-server-route-sessions.test.ts` |
| E2E  | 批准队列→对话               | `e2e/approval-queue.spec.ts`            |

---

## 18. 法律合规与「不照搬」清单

1. 不引入 Bun/Ink/TUI
2. 不默认 Bash/PowerShell
3. 不在 Skill/workflow 内嵌 shell
4. 不上传负面词 telemetry
5. 不开启 Team Memory 云同步（除非 firm 受控）
6. 每条 workflow 必须绑 `deliverableType` + audit event
7. 批准 UI 固定 attorney disclaimer（[`LAWMIND-VISION.md`](./LAWMIND-VISION.md)）

---

## 19. 与分析文档的协作

| 任务               | 读 ANALYSIS 文档 | 读 SOURCE 本文 |
| ------------------ | ---------------- | -------------- |
| 向产品/律师解释    | ✓ 章节、竞品     | 可选           |
| 写 PR 改哪几个文件 | ✓ 路线图         | ✓ §14 矩阵     |
| 抄常量/函数签名    | 概要             | ✓ §3、§6、§7   |
| UI 拆几个组件      | ✓ §15            | ✓ §10 百科全书 |
| 估工时             | ✓ Phase          | ✓ §16 验收     |

---

## 20. 参考文献

- 源码镜像：[https://gitee.com/maikebing/claude-code](https://gitee.com/maikebing/claude-code)
- 分析文档：[https://github.com/liuup/claude-code-analysis](https://github.com/liuup/claude-code-analysis)
- LawMind 分析导读版：[LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md](./LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md)
- 架构：[LAWMIND-ARCHITECTURE.md](./LAWMIND-ARCHITECTURE.md)
- 桌面 UI：[LAWMIND-DESKTOP-UI.md](./LAWMIND-DESKTOP-UI.md)

---

_维护：自 Gitee 镜像更新后，复跑 §0 行数统计并修订 §1 表；新增 LawMind 实现时更新 §14 矩阵状态列（待后续 PR 勾选）。_
