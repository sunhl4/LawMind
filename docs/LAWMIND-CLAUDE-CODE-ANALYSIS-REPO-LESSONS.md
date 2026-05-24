# LawMind × Claude Code 分析文档借鉴手册（分析仓库版）

> **外部资料来源**：[liuup/claude-code-analysis](https://github.com/liuup/claude-code-analysis) — 对 Claude Code 泄露/公开 TypeScript 源码的静态分析文档集（中文分章、含组件拆解与竞品对比）。  
> **配套源码镜像**（实施时对照行号）：[gitee.com/maikebing/claude-code](https://gitee.com/maikebing/claude-code) — 见 [`LAWMIND-CLAUDE-CODE-SOURCE-REPO-LESSONS.md`](./LAWMIND-CLAUDE-CODE-SOURCE-REPO-LESSONS.md)。  
> **LawMind 主线**：[`LAWMIND-VISION.md`](./LAWMIND-VISION.md)、[`LAWMIND-ARCHITECTURE.md`](./LAWMIND-ARCHITECTURE.md)、[`LAWMIND-REFERENCE-PROJECT-LESSONS.md`](./LAWMIND-REFERENCE-PROJECT-LESSONS.md)。

本文档在首轮对话结论基础上**细化约一倍**：按分析仓库的章节目录逐条展开，并落到 LawMind 的路径、API、UI 类名与优先级。不复制侵权源码，只吸收**可工程化的设计模式**。

---

## 0. 阅读说明

| 项目            | 说明                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 分析仓库性质    | 二次整理的**研究文档** + 可选 `src/` 跳转引用，不是 Anthropic 官方文档                                                              |
| 与 LawMind 关系 | 借鉴 **agent 平台机制**（执行内核、memory、权限、UI 工作台），不改为「法律版 Claude Code CLI」                                      |
| 必守边界        | 每条借鉴须能挂接 **DFA / acceptance / audit / matter scope**（见 [`LAWMIND-DELIVERABLE-FIRST.md`](./LAWMIND-DELIVERABLE-FIRST.md)） |
| 文档分工        | 本文 = **分析文档导读 + 产品/架构映射**；源码级行号与目录体量见 SOURCE 文档                                                         |

---

## 1. 分析仓库总览（对应其 README）

### 1.1 事件与范围

分析仓库说明：2026-03-31 前后，Claude Code npm 包因 **source map 未剥离**，导致约 **1,902 源文件、513k+ 行** TypeScript 进入公开讨论域。分析目录覆盖：

1. 架构与入口
2. 安全（采集 / 风险 / 防护）
3. Memory、Skills、Tool、MCP、Sandbox、Context、Prompt、Multi-Agent、Session
4. 程序亮点与隐藏特性
5. **组件体系七章**（TUI）
6. 竞品对比（Codex、Gemini CLI、Aider、Cursor）
7. 证据索引与总结

### 1.2 分析仓库「一图总览」与 LawMind 映射

```text
CLI/入口 ──> 初始化 ──> 命令控制面 + TUI(REPL)
                              │
                              v
                    Query/Agent 执行内核
                    /        |        \
            Tool/Perm   Transcript/Memory   MCP/Plugin/Remote/Swarm
                    \________|________/
                              v
                         回流 query 循环
```

| Claude Code 层 | LawMind 现有落点                                       | 缺口                                |
| -------------- | ------------------------------------------------------ | ----------------------------------- |
| CLI/入口       | `electron/main.mjs`、`server/lawmind-local-server.ts`  | 缺「快路径」CLI（仅 doctor/export） |
| 命令控制面     | workflow API、设置页                                   | 缺统一 `/` 律师命令面板             |
| 执行内核       | `src/lawmind/agent/runtime.ts`                         | 缺统一 `StreamEvent` 协议           |
| Tool/Perm      | `runtime/tool-pipeline.ts`、`dangerous-tool-policy.ts` | 缺分场景批准 UI、并发分批           |
| Memory         | `memory/`、`MEMORY.md`、`CASE.md`                      | 缺按需召回、Session 摘要层          |
| 扩展           | `LAWMIND-INTEGRATIONS.md`、settings tools              | MCP 只读 server 未产品化            |

---

## 2. 第一章：软件架构与程序入口

### 2.1 结论（分析文档）

Claude Code = **本地 agent 平台**，非「聊天壳 + API」。六层：CLI 引导 → 初始化 → 控制面/命令 → TUI → Query 内核 → Tool/Memory/扩展。

### 2.2 入口分流（`cli.tsx`）

**模式**：快路径（`--version`、`--dump-system-prompt`、`remote-control`、`daemon`）在加载完整 React/Ink 前 **process.exit**，降低副作用与启动时延。

**LawMind 建议**：

| 快路径命令                       | 行为                         | 实现位置建议                        |
| -------------------------------- | ---------------------------- | ----------------------------------- |
| `pnpm lawmind doctor --json`     | 只跑 health/doctor，不启桌面 | `scripts/lawmind/lawmind-doctor.ts` |
| `pnpm lawmind audit:export`      | 已有方向，保持无 UI          | `scripts/lawmind/`                  |
| `pnpm lawmind acceptance --pack` | 已有 gate，保持无 UI         | 现有 acceptance 脚本                |

### 2.3 主启动器（`main.tsx`）

并行装配：`bootstrap`、`getMcpTools`、`getTools`、`initBundledSkills`、`getAgentDefinitions`、`settingsChangeDetector`、`launchRepl`。

**LawMind 对齐**：`electron/main.mjs` 启动本地 server 后再载 renderer；应在 server bootstrap 顺序中固定：

1. 工作区与 `lawmind.policy.json`
2. Key vault / 模型 catalog
3. MCP 连接（若配置）
4. Role / workflow 模板索引
5. 再接受 `/api/chat`

### 2.4 Trust 分阶段初始化（`init.ts` / `setup.ts`）

Trust 前：仅安全 env、证书、telemetry **骨架**；Trust 后：`initializeTelemetryAfterTrust`、完整 env、hooks watcher、session memory。

**LawMind 法律化**：

- **首跑信任**：`LawmindFirstRunDialog` 确认工作区根、matter 默认策略、是否启用外联（[`LAWMIND-DESKTOP-UI.md`](./LAWMIND-DESKTOP-UI.md)）
- **策略先于记忆写入**：未确认责任边界前，不自动 `auto_adopt` 到 `LAWYER_PROFILE`
- 映射：`server/lawmind-desktop-env-bootstrap.ts` 扩展为两阶段

### 2.5 运行形态

| 形态          | Claude Code          | LawMind             |
| ------------- | -------------------- | ------------------- |
| REPL/TUI      | 默认                 | Electron 主窗口     |
| Headless/SDK  | `QueryEngine`        | 本地 API + 未来 SDK |
| MCP Server    | `entrypoints/mcp.ts` | P2：只读 MCP        |
| Bridge/Remote | `bridge/`            | 非主线；firm 再议   |

**核心借鉴**：**同一套执行逻辑**服务 UI 与 API——LawMind 应保证 `runTurn` 与 `executeWorkflow` 的工具管道、审计字段一致（已在 `tool-pipeline.ts` 起步）。

---

## 3. 第二章：安全分析

### 3.1 五层数据面（分析文档第二章）

| 层级                | 内容                                   | 法律场景敏感度 | LawMind 对策                              |
| ------------------- | -------------------------------------- | -------------- | ----------------------------------------- |
| L1 模型上下文       | 对话、工具输出、文件片段、git、memory  | **极高**       | matter 隔离、最小必要上传、客户材料策略   |
| L2 本地持久化       | transcript JSONL、settings、OAuth 缓存 | 高             | 本地优先；可选 `cleanupPeriodDays` 等价物 |
| L3 Memory 自动提炼  | 跨 session 画像                        | 高             | Adoption 四态 + 律师审阅                  |
| L4 Telemetry        | 设备/会话/哈希元数据                   | 中             | `policy.productInsightsCollection` 默认关 |
| L5 Team Memory 同步 | 组织知识上传                           | 高（firm）     | 默认关闭；future + secret scan            |

### 3.2 防护性措施（分析文档 §3）

- Tool Permission 主干化
- Sandbox 与 permission **双层**（沙箱不绕过 allow/deny）
- Path validation、`..` 穿越防护
- Team memory 客户端 secret scanning

**LawMind 任务**（与 [`LAWMIND-SECURITY-CHECKLIST.md`](./LAWMIND-SECURITY-CHECKLIST.md) 合并）：

1. `tool-pipeline` **matterScopeMiddleware**（P0）
2. `lawmind.policy.json` **networkAllowlist**（P1）
3. 审计 **hash-chain** 可选字段（P1）
4. 高风险工具 **子进程隔离 POC**（P2，参考 cLawyer）

### 3.3 隐私敏感部署清单（分析总结 §5）

若用户需要「零画像」模式，分析文档建议同时：

- 控制输入上下文
- 关闭 transcript persistence
- 关闭 auto/team memory
- 禁用非必要网络
- 不启用 remote/bridge

**LawMind 产品化**：设置页「高安全模式」一键：关闭外联、关闭自动记忆采纳、仅本地 audit、显示三项状态灯。

---

## 4. 第三章：Agent Memory 机制

### 4.1 四层 + 召回 + Snapshot（分析文档核心）

```text
Auto Memory（用户/项目长期）
  ├─ MEMORY.md 索引（硬截断）
  ├─ topic *.md 分文件
  └─ findRelevantMemories（≤5，side query）

Session Memory（当前会话摘要，forked agent 写入）
Agent Memory（按 agent 类型，user/project/local scope）
Team Memory（repo 级同步，带校验）

Agent Memory Snapshot（初始化/升级提示）
Compaction（SM 作边界 + tool 链保护 + 复灌 tools/plan/files）
```

### 4.2 与 LawMind 双轨记忆对照

| Claude 概念                | LawMind 现状               | 建议                                      |
| -------------------------- | -------------------------- | ----------------------------------------- |
| `MEMORY.md` 索引           | 有 `MEMORY.md`，偏全文检索 | 强制索引规范 + doctor 校验                |
| `LAWYER_PROFILE` 进 prompt | 已进 system prompt         | 保持                                      |
| `MEMORY.md` 不进主 prompt  | 经检索/工具                | 增加 **按需召回** 显式段                  |
| `CASE.md`                  | 有 matter 记忆             | 纳入 recall 优先级                        |
| Session 摘要               | 无                         | `cases/<id>/session-summary.md`           |
| Assistant `PROFILE.md`     | 有                         | 增加 **snapshot 分发**（workflow bundle） |
| Team sync                  | 无                         | Firm edition 再议                         |

### 4.3 `findRelevantMemories` 产品语义（必移植）

- 输入：用户 query + manifest（文件名+描述）
- 排除：已在 `alreadySurfaced` 的文件
- 排除：当前活跃工具的「使用文档」；**保留** gotcha/warning 类
- 输出：≤5 个绝对路径 + mtime

**LawMind 法律 selector 附加规则**：

- `matterId` 存在时，`CASE.md` 与 `cases/<id>/memory/*` 加权
- 带 `deliverableType` 的 topic 优先
- 过期法条记忆（manifest 含 `validUntil`）不选

### 4.4 Compaction 与 Memory 联动（分析 §11）

要点：

- 优先 `trySessionMemoryCompaction`（不另烧 API 做总结）
- `adjustIndexToPreserveAPIInvariants` 防止切断 tool_use/tool_result
- 压缩后 **re-inject** 文件内容、Plan、deferred tools delta

**LawMind 压缩后复灌清单**（替代 MCP 工具列表）：

- `matterId`、`taskId`、`draftId`
- `DeliverableSpec` / acceptance 状态
- `pendingClarification` keys
- `pendingToolApprovals` 摘要

### 4.5 Memory UI（`MemoryFileSelector`）

分析文档强调：memory **用户可见、可编辑**，非黑盒。

**LawMind**：`MemoryInspector` + 树形浏览 `MEMORY.md` 索引与 topic 文件；采纳/驳回与 [`memory/adoption-service`](../../src/lawmind/memory/adoption-service.ts) 联动。

---

## 5. 第四章：Skills 机制

### 5.1 三来源

File-based（`.claude/skills`）、Bundled、MCP-mapped skills。

### 5.2 Frontmatter 能力

| 字段             | 作用                   | LawMind workflow JSON 字段 |
| ---------------- | ---------------------- | -------------------------- |
| `paths`          | 条件触发（glob）       | `triggerPaths`             |
| `allowed_tools`  | 工具白名单             | `allowedToolNames`         |
| `user_invocable` | 是否出现在用户命令列表 | `userInvocable`            |
| `context: fork`  | 子上下文               | `runMode: "fork"`          |
| `agent`          | 绑定 agent             | `roleId`                   |

### 5.3 禁止照搬

- **Prompt 内嵌 shell**（`executeShellCommandsInPrompt`）— 法律合规用 **签名 bundle + Doctor**，不用技能里跑 shell。

### 5.4 与 `LawmindWorkflowLibrary` 整合

- 卡片：practice area、deliverable type、risk level、role
- 启动前：检查 acceptance 是否要求、required sources
- 打开匹配文书时横幅推荐 workflow（conditional skill）

---

## 6. 第五章：Tool Call 机制

### 6.1 链路（分析文档）

```text
assistant tool_use → partitionToolCalls → concurrent/serial batches
  → schema → validateInput → hooks → permission → tool.call()
  → tool_result → 下一轮 API
```

### 6.2 `Tool` 协议（fail-closed 默认值）

默认：`isConcurrencySafe: false`、非只读、非破坏性、`checkPermissions` 需显式。

**LawMind**：扩展 `AgentTool` 元数据 + `runtime/tool-concurrency.ts`（见 SOURCE 文档 §工具编排）。

### 6.3 权限 UI 分场景（分析 + 组件章）

非统一 modal：`FileEdit`、`Bash`、`WebFetch`、`Skill`、`AskUserQuestion` 各有一套 UI。

**LawMind**：`LawmindToolApprovalDialog` + 内联 `LawmindRequiresActionCard`；按工具类型 4–6 种布局模板。

---

## 7. 第六章：MCP

- Client：`getMcpTools`，命名 `mcp__server__tool`
- Server：内建 tool 包装为 MCP schema
- `assembleToolPool`：内建优先于 MCP 同名

**LawMind P1**：只读 MCP（列 matters、读 draft、acceptance-pack、source preview）；设置页连接状态 + Doctor。

---

## 8. 第七章：Sandbox

四层：`shouldUseSandbox` → runtime config → `bashPermissions` → `Shell` + cleanup。

**LawMind**：不做默认 Bash；`render_document`、外联、写 workspace 走 policy + 子进程；`LawmindSettingsDoctor` 增 sandbox/network 节。

---

## 9. 第八章：Context 管理

- 有效窗口 = 总窗口 − summary 预留（最高 20k）
- `AUTOCOMPACT_BUFFER_TOKENS = 13000`
- 连续 compact 失败 **3 次熔断**
- PTL 时剥除 20% 头部重试

**LawMind**：`agent/context-budget.ts` + `agent/compact.ts`；桌面显示 token 条（compose footer）。

---

## 10. 第九章：Prompt 管理

分析文档涉及：system prompt 组装、attachments、mandatory rules、skills/plan reinjection。

**LawMind 已有**：`buildSystemPrompt`、`agentMandatoryRules`（[`LAWMIND-ARCHITECTURE.md`](./LAWMIND-ARCHITECTURE.md) §五）。

**补强**：compact 后重新注入 **工作区强制规则** 与 **当前 deliverable 约束** 段，避免压缩后「忘记红线」。

---

## 11. 第十章：Multi-Agent

- `AgentTool` spawn subagent
- Swarm backends：in-process、tmux、iterm2
- `SendMessageTool`、`TeamCreateTool`
- UI：`tasks/`、`teams/`、teammate 视角

**LawMind**：已有 `delegate_to_role`、`executeWorkflow`、`jobs` SSE。

**借鉴**：

- 统一 **任务抽屉**（job + delegation + tool approval）
- 子会话 transcript（JSONL）可恢复
- 不做 tmux swarm；保留 Role 委派即可

---

## 12. 第十一章：Session Storage / Resume

- Append-only JSONL transcript
- `progress` **不**进 transcript
- subagent 独立 jsonl
- `/resume`：load → repair chain → restore metadata → REPL

**LawMind**：

- `lawmind/sessions/<id>.jsonl`
- `GET /api/sessions`、`POST .../resume`
- 桌面「继续对话」列表（按 matter 分组）

---

## 13. 第十二章：程序架构亮点（差异化三件套）

1. **统一 query 内核**（多形态复用）
2. **文件化分层 memory**（可审计）
3. **local-first + remote 扩展**

LawMind 差异化三件套应是：

1. **DFA + acceptance gate**
2. **matter-centered 写侧 + 法律责任边界**
3. **Electron 本地闭环 + 可选 firm 扩展**

借鉴 Claude 的 **执行与 memory 工程**，不替换法律差异化。

---

## 14. 第十三–十五章：扩展分析

### 14.1 隐藏命令与 Feature Flags

`bun:bundle` 的 `feature()` 编译期剥离——LawMind 可用 **edition** + `policy` 做运行时开关，无需 bun DCE。

### 14.2 负面关键词与挫败感信号

用于 telemetry 与反馈问卷，**不拦截**用户输入。

**LawMind**：仅 **本地** 挫败信号（连续 tool 失败、澄清放弃、审核驳回）驱动 Doctor 建议；**不上传**负面词正则。

---

## 15. 组件体系详解（TUI）— UI 借鉴加倍节

> 分析仓库 `analysis/components/` 七章；LawMind 为 Electron + `lm-*` CSS（[`LAWMIND-DESKTOP-UI.md`](./LAWMIND-DESKTOP-UI.md)）。

### 15.1 双中枢 → LawMind 三中枢

| 中枢   | Claude        | LawMind 组件                                          |
| ------ | ------------- | ----------------------------------------------------- |
| 展示轨 | `Messages`    | `LawmindChatMessagesColumn`、`lawmind-chat-shell.tsx` |
| 输入轨 | `PromptInput` | `LawmindChatComposeFooter`                            |
| 案件轨 | （弱）        | `MatterWorkbench`、`ReviewWorkbench`                  |
| 就绪轨 | Status/Doctor | `LawmindReadinessStrip`、`LawmindFirstRunDialog`      |

### 15.2 Messages 预处理管道（须实现 `preprocessChatMessages`）

| 步骤      | Claude 工具函数                                    | LawMind 行为                          |
| --------- | -------------------------------------------------- | ------------------------------------- |
| 规范化    | `normalizeMessages`                                | 统一 `ChatMsg`                        |
| 重排      | `reorderMessagesInUI`                              | 澄清消息置顶                          |
| 折叠检索  | `collapseReadSearchGroups`                         | 折叠 `search_workspace` 长结果        |
| 折叠 hook | `collapseHookSummaries`                            | 折叠系统提示块                        |
| 合并 tool | `applyGrouping`                                    | 与 `LawmindChatThoughtPanel` 联动     |
| Brief     | `filterForBriefTool`                               | 「仅看交付相关」toggle                |
| 性能      | `VirtualMessageList`、`OffscreenFreeze`、memo Logo | >100 条虚拟列表；`content-visibility` |

### 15.3 消息亚型组件（`messages/` 41 文件）

分析文档列出的亚型，LawMind 应对应 **独立 React 组件**（避免全塞在一个 `lm-msg`）：

| 亚型                 | 建议组件                       | 法律场景                        |
| -------------------- | ------------------------------ | ------------------------------- |
| AssistantText        | `LawmindMsgAssistant`          | 正文 + citation                 |
| AssistantThinking    | 已有 `LawmindChatThoughtPanel` | 思考+工具步骤                   |
| ToolUse / ToolResult | `LawmindMsgToolGroup`          | 工具名中文+风险色               |
| PlanApproval         | `LawmindMsgPlanApproval`       | 多步工作流确认                  |
| Clarification        | `LawmindClarificationForm`     | 已有                            |
| RateLimit/Error      | `LawmindMsgError`              | 模型失败 `lm-msg-model-failure` |
| UserMemoryInput      | `LawmindMsgMemoryAdoption`     | 记忆采纳提示                    |
| CompactBoundary      | `LawmindMsgCompactNotice`      | 「较早对话已压缩」              |

### 15.4 PromptInput 子系统（21 文件 → compose 扩展）

**结构（建议在 `lm-compose` 内自上而下）**：

```text
lm-clarify-session-bar          # 已有
lm-compose-model-hint / error   # 已有
lm-context-banner               # 已有
lm-compose-attachments          # 待办：引用文件 chips
textarea
lm-compose-toolbar
  ├─ 模式 | 联网 | 模型         # 已有
  ├─ permission-mode            # 新增：标准/严格/只读
  ├─ token-context              # 新增：用量/compact 预警
  └─ 发送 | 中止
lm-compose-suggestions          # 工作流 chip + QUICK_ACTIONS 已有
lm-compose-queue                # 新增：排队条
lm-compose-footer-pills         # 新增：待批准 | 后台任务
```

**交互细节（对标分析文档）**：

| 能力         | Claude                        | LawMind 实现要点                  |
| ------------ | ----------------------------- | --------------------------------- |
| 历史         | `useArrowKeyHistory`          | ⌘↑/↓ 会话内历史                   |
| 历史搜索     | `HistorySearchInput`          | ⌘⇧F 搜索 transcript               |
| 排队         | `PromptInputQueuedCommands`   | loading 时 enqueue，展示取消      |
| Stash        | `PromptInputStashNotice`      | `localStorage` 按 matter 暂存输入 |
| Typeahead    | slash、thinking、token budget | `/` 打开律师命令面板              |
| 图片粘贴     | `inputPaste`                  | 法律场景低优先                    |
| Vim          | `vim/`                        | 不需要                            |
| Footer pills | tasks/teams/bridge            | Action Hub 徽章                   |

### 15.5 permissions 组件族（51 文件 — 最应抄结构）

**原则**：`PermissionRequest` 按 `tool` 引用 **switch** 到子组件，而非 if-else 堆在 chat 里。

**LawMind 模板矩阵**：

| 工具类型    | UI 模板    | 必显字段                        |
| ----------- | ---------- | ------------------------------- |
| 写草稿/文件 | Diff 模板  | 相对 matter 路径、交付物关联    |
| 检索/读源   | 只读模板   | 范围、matterId、条数上限        |
| 渲染 docx   | 高风险模板 | acceptance 状态、gate blockers  |
| 工作流/委派 | 编排模板   | 步骤数、目标 Role、预计耗时     |
| 外联搜索    | 网络模板   | allowlist 命中/拒绝原因         |
| 用户澄清    | 表单模板   | 已有 `LawmindClarificationForm` |

**动作**：允许一次 / 本会话允许 / 拒绝 / 打开集中队列；底部 **attorney disclaimer** 固定条。

### 15.6 tasks / agents / mcp / Settings 面板

| 面板     | Claude                                  | LawMind                              |
| -------- | --------------------------------------- | ------------------------------------ |
| tasks    | `BackgroundTasksDialog` + 分类型 Detail | `LawmindTaskDrawer`（新建）          |
| agents   | `AgentsMenu`、Wizard、ToolSelector      | `LawmindSettingsAssistants` 增向导步 |
| mcp      | 连接/工具列表                           | `LawmindSettingsTools` + Doctor      |
| Settings | 分层设置                                | `lawmind-settings-shell.tsx`         |
| sandbox  | `SandboxDoctorSection`                  | 并入 `LawmindSettingsDoctor`         |

### 15.7 全局快捷键（`useGlobalKeybindings`）

| 快捷键          | Claude                    | LawMind 建议            |
| --------------- | ------------------------- | ----------------------- |
| Transcript 切换 | 有                        | 对话内搜索面板          |
| Todo/Teammate   | 有                        | 任务抽屉                |
| Brief           | 有                        | 仅交付视图              |
| 滚动            | `ScrollKeybindingHandler` | 消息区 j/k 或浏览器默认 |

### 15.8 无障碍（对标分析 + LAWMIND-DESKTOP-UI）

- `aria-live`：流式思考用 `polite`（`LawmindChatThoughtPanel` 已有）
- `aria-label`：图标按钮中文标签
- `:focus-visible`：沿用 `styles.css` 全局 polish

---

## 16. 第十六章：同类产品对比（摘要 + LawMind 站位）

| 产品       | Claude Code 分析结论  | LawMind 站位                       |
| ---------- | --------------------- | ---------------------------------- |
| Codex      | 多云多端产品线        | 坚持本地桌面 + 可审计交付          |
| Gemini CLI | 开源 CLI 基线         | 记忆/多 agent 更深，但不做通用 CLI |
| Aider      | 轻量 pair programming | 我们是任务/交付工作台              |
| Cursor     | IDE + 后台 agent      | 我们是 matter/审核/验收主线        |

**同时成立才构成 Claude 辨识度**：统一内核 + 文件 memory + local-first。  
**LawMind 辨识度**：DFA + matter + 律师责任 + 来源锚点。

---

## 17. LawMind 差距 × 分析文档章节对照表

| 分析文档章                | LawMind 差距                 | 优先级 | 主要落点                       |
| ------------------------- | ---------------------------- | ------ | ------------------------------ |
| 01 架构                   | 无 StreamEvent、无快路径 CLI | P1     | `agent/`、`scripts/lawmind/`   |
| 02 安全                   | 沙箱/网络 allowlist 弱       | P0–P1  | `policy`、`tool-pipeline`      |
| 04 Memory                 | 无 recall/Session 摘要       | P0     | `memory/`                      |
| 04c Skills                | workflow 触发器弱            | P0     | `LawmindWorkflowLibrary`       |
| 04b Tool                  | 无并发分批、UI 协议弱        | P1     | `runtime/`、renderer           |
| 04f Context               | compact 简陋                 | P0     | `agent/compact.ts`             |
| 04i Session               | 无 JSONL resume              | P1     | `adapters/session-transcript/` |
| components 02             | 无预处理/虚拟列表            | P0     | `lawmind-chat-shell.tsx`       |
| components 03 permissions | 批准分散                     | P0     | `LawmindApprovalQueue`、Dialog |
| components 03 tasks       | 任务分散                     | P0     | `LawmindTaskDrawer`            |

---

## 18. 分阶段路线图（可写入 GOALS）

### Phase P0（4–6 周，产品体感）

1. Compose footer：permission mode、token 条、待批准 badge、输入队列
2. `/` 律师命令面板 → workflow API
3. `preprocessChatMessages` + 工具组折叠 + brief 模式
4. `LawmindToolApprovalDialog` + 集中批准队列置顶
5. `LawmindTaskDrawer`：jobs + delegation + approvals
6. 澄清/上下文/错误条与 [`LAWMIND-DESKTOP-UI.md`](./LAWMIND-DESKTOP-UI.md) 同步

### Phase P1（6–8 周，引擎）

7. `findRelevantMemories` 移植 + doctor 校验 MEMORY 索引
8. Session summary 提取 + compact 摘要边界 + tool 链保护
9. 压缩后复灌 matter/draft/acceptance/clarification
10. JSONL transcript + resume API + 会话列表 UI
11. `partitionToolCalls` + Tool 元数据

### Phase P2（8+ 周）

12. 只读 MCP server
13. 子进程工具隔离 + Doctor sandbox 节
14. Agent/Role memory snapshot 随 bundle 分发

---

## 19. 明确不借鉴清单

1. Ink/TUI 技术栈 → 保持 Electron
2. Skill 内嵌 shell
3. 默认 Team Memory 云同步
4. 负面词遥测上传
5. Bash 默认全开
6. 功能数量竞赛 → 每条挂 `DeliverableSpec` + audit

---

## 20. 与 SOURCE 文档协作方式

| 需求                | 读本文       | 读 SOURCE 文档  |
| ------------------- | ------------ | --------------- |
| 为什么这样设计      | ✓ 章节导读   | ✓ 源码注释级    |
| 改哪个 LawMind 文件 | ✓ §17 对照表 | ✓ 文件级矩阵    |
| 常量/行数/目录体量  | 概要         | ✓ 完整          |
| UI 类名与 CSS       | ✓ §15        | ✓ §组件百科全书 |

---

## 21. 参考文献

- 分析仓库：[https://github.com/liuup/claude-code-analysis](https://github.com/liuup/claude-code-analysis)
- 源码镜像：[https://gitee.com/maikebing/claude-code](https://gitee.com/maikebing/claude-code)
- LawMind 参考项目总表：[LAWMIND-REFERENCE-PROJECT-LESSONS.md](./LAWMIND-REFERENCE-PROJECT-LESSONS.md)
- 桌面 UI 基线：[LAWMIND-DESKTOP-UI.md](./LAWMIND-DESKTOP-UI.md)

---

_维护：借鉴 Claude Code 分析文档的 PR 应更新本章对照表；若行为变更影响用户可见 UI，同步 `LAWMIND-USER-MANUAL.md`。_
