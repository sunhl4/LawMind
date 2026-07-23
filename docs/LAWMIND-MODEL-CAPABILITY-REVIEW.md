# LawMind 模型能力压低点与解锁清单

> 审计日期：2026-07-22  
> 范围：`src/lawmind` 编排 / 记忆 / 工具管线 + `apps/lawmind-desktop` 对话输入路径  
> 目的：找出软件侧会**降低接入模型发挥**的环节，以及可**抬高能力包络**的改动；供逐条讨论与排期。  
> 说明：严重度针对**模型能力影响**（非法律合规本身）。置信度 ≥80 的项已对照源码。

---

## 0. 总览结论

模型能力被压低，主要不是「接错了模型」，而是三条硬顶：

1. **输出长度锁死**（默认 `maxTokens: 4096`）
2. **上下文预算不跟模型走**（写死 128k + `chars/4`）
3. **澄清 / 审批把研究路径一起卡住**（`research_task` 与 draft/render 同级封锁）

能力链路：

```text
桌面输入/附件 → Chat 路由 → System + 记忆窗口 → Auto-compact
  → 上游模型调用 → 工具管线 → 澄清/审批/只读/引用门禁 → 交付/渲染
```

模型发挥依赖四步：**看得全 → 想得深 → 写得长 → 工具用得上**。当前在这四步都有可量化天花板。

---

## 1. 讨论用条目索引

按优先级讨论时可直接引用 ID（如「先谈 E1」）。

| ID           | 主题                                    | 严重度        | 置信度 | 建议优先级 |
| ------------ | --------------------------------------- | ------------- | ------ | ---------- |
| E1           | 输出 `maxTokens` 固定 4096              | BLOCK         | 93     | P0         |
| A2           | 上下文预算写死 128k + chars÷4           | WARN→近 BLOCK | 90     | P0         |
| A1           | Compact 切片丢弃、恢复薄                | WARN          | 92     | P0         |
| A5           | Compact 后摘要注入过薄                  | WARN          | 87     | P0         |
| C2           | 澄清门禁连带封锁研究工具                | WARN          | 90     | P1         |
| B2 / B7      | System「先澄清」+ Intake 短路           | WARN          | 85–88  | P1         |
| A11          | ContextPlan 已实现未接线                | WARN          | 83     | P1         |
| A7 / F1      | 文件引用只给路径不给正文                | WARN          | 82–86  | P1         |
| A3           | 记忆/CASE prompt 窗口偏紧               | WARN          | 88     | P2         |
| A4           | 相关记忆召回浅（5×2500）                | WARN          | 85     | P2         |
| C4           | 每轮工具调用默认 15                     | WARN          | 85     | P2         |
| C5 / E4      | 工具超时 vs 模型超时不对齐              | WARN          | 80–84  | P2         |
| C10          | 文档分析字节/切片上限                   | WARN          | 83     | P2         |
| E2           | temperature 固定 0.3                    | WARN          | 88     | P3         |
| D4           | Citation/grounded 渲染门禁              | WARN          | 86     | P3         |
| B4 / A8      | 协作结果不信任 + 交接截断               | WARN          | 80–82  | P3         |
| D7           | Solo 关闭 review 并行                   | WARN          | 78     | P3         |
| E5 / E6      | 检索 JSON-only；reasoning 默认非 model  | WARN          | 82–85  | P3         |
| C1           | readonly 模式工具面过窄                 | BLOCK\*       | 95     | 按产品取舍 |
| C3 / C9 / D6 | 严格审批 / 网络默认 deny / 高安全关 web | WARN          | 78–88  | 按产品取舍 |

\*C1 在「只读 compose」场景下是能力封锁；是否扩大属产品决策。

---

## 2. 能力链路示意

```mermaid
flowchart LR
  UI[桌面输入/附件] --> Chat[Chat 路由]
  Chat --> Prompt[System + 记忆窗口]
  Prompt --> Compact[Auto-compact]
  Compact --> Model[上游模型调用]
  Model --> Tools[工具管线]
  Tools --> Gates[澄清/审批/只读/引用]
  Gates --> Out[交付/渲染]
```

---

## 3. 分组发现（可逐条讨论）

### (A) 上下文饥饿 Context starvation

#### A1 — Compact 丢弃历史，长 matter 失忆

- **严重度**：WARN | **置信度**：92
- **位置**：`src/lawmind/agent/compact.ts`（`autoCompactSessionHistory`、保留约 24 条近期非 system / `maxHistoryMessages`）；`src/lawmind/agent/turn-orchestrator.ts`（每轮触发）；桌面 `apps/lawmind-desktop/server/lawmind-server-helpers.ts` 硬编码 `maxHistoryMessages: 50`
- **影响**：长会话丢失工具轨迹、澄清与推理；模型再也看不到早期关键上下文
- **建议**：丢弃前对 dropped span 做 LLM 摘要；`effectiveLimit` 跟 catalog `contextTokens` 联动

#### A2 — Token 预算与模型窗口脱节

- **严重度**：WARN（接近 BLOCK）| **置信度**：90
- **位置**：`src/lawmind/agent/context-budget.ts` — `DEFAULT_EFFECTIVE_LIMIT = 128_000`，`CHARS_PER_TOKEN_ESTIMATE = 4`；catalog 已有 `contextTokens` 但未接入 budget
- **影响**：小窗口过晚 compact / 大窗口过早丢历史；中文估算偏差
- **建议**：`estimateTokenBudget(..., { contextTokens })`；阈值跟当前所选模型走

#### A3 — 记忆注入窗口偏紧

- **严重度**：WARN | **置信度**：88
- **位置**：`src/lawmind/memory/prompt-windows.ts` — CASE 8k、律师 6k、客户 4k、日日志 3k、助手 3k 等
- **影响**：丰富案情/进展进不了模型
- **建议**：经 `lawmind.policy.json` 可调；超 cap 时明确指引 `read_case_file`

#### A4 — 相关记忆召回浅

- **严重度**：WARN | **置信度**：85
- **位置**：`src/lawmind/memory/relevant-recall.ts` — `MAX_RECALL = 5`；`turn-orchestrator-prompt.ts` 每 hit `slice(0, 2500)`；偏关键词
- **影响**：语义相关大文件难表面
- **建议**：提高上限；路径 + 摘要注入，正文用工具读；可选 FTS/embedding

#### A5 — Compact 后恢复层过薄

- **严重度**：WARN | **置信度**：87
- **位置**：`src/lawmind/agent/compact.ts` — session summary 注入约 12_000 chars；否则 CASE 片段约 2000
- **影响**：多轮工作被压缩后只剩薄摘要
- **建议**：对 dropped messages 蒸馏摘要；cap 按模型窗口比例提高

#### A6 — 团队会议历史尾截断

- **严重度**：WARN | **置信度**：80
- **位置**：`src/lawmind/cases/team-meeting.ts` — `TEAM_MEETING_TAIL_LIMIT_DEFAULT = 80`（cap 200）；chat 路由前缀会议轮次
- **影响**：多助手会议早期共识丢失
- **建议**：提高默认或注入策略文件 + 滚动会议摘要

#### A7 — 文件聊天上下文不喂正文

- **严重度**：WARN | **置信度**：82
- **位置**：`apps/lawmind-desktop/src/renderer/lawmind-file-chat-context.ts` — `MAX_FILE_CHAT_CONTEXT = 8`；prefix 为路径 + 工具提示
- **影响**：模型须主动读文件；漏工具 = 看不见附件
- **建议**：小文件可选 inline excerpt

#### A8 — 委派/交接结果截断

- **严重度**：WARN | **置信度**：84
- **位置**：`src/lawmind/agent/collaboration/delegation-registry.ts` — `MAX_FROZEN_RESULT_BYTES = 102_400`；shared-memory 摘录约 2000 chars
- **影响**：子代理长输出在父代理侧丢失
- **建议**：全文落盘；prompt 注入摘要 + 指针工具

#### A9 — 工具结果整段 JSON 进历史

- **严重度**：WARN | **置信度**：78
- **位置**：`src/lawmind/agent/session.ts` — tool results `JSON.stringify`
- **影响**：巨大 tool JSON 吃窗口
- **建议**：超阈值摘要/截断，保留结构化关键字段

#### A10 — Distill 默认不回灌模型

- **严重度**：INFO | **置信度**：75
- **位置**：`src/lawmind/agent/compact-distill.ts` — `autoAdopt: false`；偏好行与 matter 片段有长度帽
- **影响**：压缩学习需律师采纳后才帮到模型
- **建议**：compact 后注入只读「待采纳预览」块

#### A11 — ContextPlan 未接线

- **严重度**：WARN | **置信度**：83
- **位置**：`src/lawmind/runtime/context-plan.ts` 已实现；`system-prompt.ts` 支持 `contextPlanMarkdown`；`prepareTurnPromptContext` **未设置**（仅 integration test 使用）
- **影响**：模型缺少本轮上下文层地图
- **建议**：在 `turn-orchestrator-prompt.ts` 接线 `buildContextPlan` → markdown → `buildSystemPrompt`

---

### (B) Prompt / 指令质量

#### B1 — System prompt 偏大且偏「先澄清」

- **严重度**：WARN | **置信度**：88
- **位置**：`src/lawmind/agent/system-prompt.ts`（约 400+ 行组装，含完整工具参数列举倾向）
- **影响**：占窗口；模糊任务上偏澄清而非执行
- **建议**：拆 core vs tool catalog；policy `agentPromptVerbosity`

#### B2 — 澄清门槛过宽

- **严重度**：WARN | **置信度**：85
- **位置**：`system-prompt.ts` 核心原则 1 — 实质不确定时须先澄清，再大规模检索/长文起草/`execute_workflow`
- **影响**：部分指定任务上强模型无法探索性只读
- **建议**：收窄为「缺交付物类型」等硬缺口；澄清期允许只读工具

#### B3 — 工作区强制规则截断

- **严重度**：WARN | **置信度**：82
- **位置**：`src/lawmind/policy/workspace-policy.ts` — `AGENT_MANDATORY_RULES_MAX_CHARS = 8192`
- **影响**：长规则中段截断
- **建议**：health 暴露 truncated；规则拆文件供 `read_workspace_file`

#### B4 — 协作输出「不可信」框架过强

- **严重度**：WARN | **置信度**：80
- **位置**：`system-prompt.ts`；`message-bus.ts` 的 `<<<BEGIN_UNTRUSTED_ASSISTANT_RESULT>>>` 包装
- **影响**：多代理合成时可能过度贬低子代理专业结论
- **建议**：分层信任：advisory vs 不可当指令执行

#### B5 — 交付管线强制 note

- **严重度**：WARN | **置信度**：78
- **位置**：`src/lawmind/agent/deliverable-pipeline.ts` — ESG/通用报告强制 workflow note
- **影响**：复杂报告减少灵活工具链
- **建议**：仅在 intake 澄清为空时注入

#### B6 — 每轮强制「本轮已应用」页脚

- **严重度**：INFO | **置信度**：70
- **位置**：`system-prompt.ts` 偏好 hint 相关
- **影响**：浪费输出 token
- **建议**：改系统侧确认或仅首轮

#### B7 — Intake gate 在进模型工具环之前短路

- **严重度**：WARN | **置信度**：86
- **位置**：`src/lawmind/router/intake-gate.ts` + `turn-orchestrator.ts`
- **影响**：可交付形提问可能不进 tool loop；误报时耽误研究
- **建议**：CASE 已含必要字段时 skip；律师「继续不澄清」逃生口

---

### (C) 工具能力不足 Tooling underpower

#### C1 — readonly 模式工具白名单过窄

- **严重度**：BLOCK（场景性）| **置信度**：95
- **位置**：`src/lawmind/agent/permission-mode.ts`；chat 路由关闭 web + collaboration
- **影响**：只读 compose 无法起草/workflow/渲染
- **建议**：扩大 suggest-only，或单独 `research` 模式（产品取舍）

#### C2 — 澄清期封锁 research_task

- **严重度**：WARN | **置信度**：90
- **位置**：`src/lawmind/runtime/tool-pipeline.ts` — `HEAVY_TOOL_NAMES` 含 `research_task` / `draft_document` / `execute_workflow` / `render_document`
- **影响**：澄清未结时无法并行只读研究
- **建议**：澄清期只禁 draft/workflow/render

#### C3 — 严格审批含 execute_workflow

- **严重度**：WARN | **置信度**：88
- **位置**：`src/lawmind/agent/dangerous-tool-policy.ts`；edition strict 策略
- **影响**：模型须 `__approved` 或等待律师，易 stall
- **建议**：沙箱内低风险步骤可自动批；render/send 仍门禁

#### C4 — 工具调用预算默认 15

- **严重度**：WARN | **置信度**：85
- **位置**：`turn-orchestrator.ts` — `DEFAULT_MAX_TOOL_CALLS = 15`（cap 50）
- **影响**：复杂审查中途触顶
- **建议**：Solo 默认抬到 25；错误信息提示剩余预算

#### C5 — 工具超时 30s vs 模型 60–120s

- **严重度**：WARN | **置信度**：84
- **位置**：`turn-orchestrator.ts` — `DEFAULT_TOOL_TIMEOUT_MS = 30000`
- **影响**：慢工具先失败而模型仍在跑
- **建议**：与 `LAWMIND_AGENT_TIMEOUT_MS` 对齐或按工具覆盖

#### C6 — 无 matter 时案件工具硬失败

- **严重度**：WARN | **置信度**：82
- **位置**：`tool-pipeline.ts` — `matterScopeMiddleware`
- **影响**：未绑案件无法 `search_matter` 等
- **建议**：软提示选案件；允许消息内显式 matter_id

#### C7 — 未知参数键硬拒绝

- **严重度**：WARN | **置信度**：80
- **位置**：`runtime-tool-validation.ts` + `argSchemaMiddleware`
- **影响**：~~模型多传字段即失败~~ → **已缓解（2026-07-23）**：剥离未知键并 `argNote` 旁注
- **建议**：~~warn + strip 未知键~~ **已落地**

#### C8 — 只读工具进子进程沙箱名单

- **严重度**：WARN | **置信度**：78
- **位置**：`dangerous-tool-policy.ts` — 含 `read_project_file` / `analyze_document`
- **影响**：只读路径额外延迟/失败面
- **建议**：从 subprocess sandbox 名单移除纯只读工具

#### C9 — Firm/Private 默认 deny web

- **严重度**：WARN | **置信度**：83
- **位置**：`src/lawmind/policy/network-allowlist.ts`
- **影响**：即便 UI 开 web，无 allowlist 仍不可用
- **建议**：默认法律相关 host 白名单 + Doctor 说明

#### C10 — 文档分析切片上限

- **严重度**：WARN | **置信度**：83
- **位置**：`analyze_document` / `read_project_file`（`file-tools.ts` / `search-tools.ts`）
- **影响**：~~大合同部分不可见~~ → **已缓解（2026-07-23）**：`offset`/`limit` 分页；默认页 ~40k（原 analyze 硬切 8k）
- **建议**：~~`analyze_document` 分页 offset/limit~~ **已落地**

#### C11 — LexEdge 桌面默认不接线

- **严重度**：INFO | **置信度**：75
- **位置**：`docs/LAWMIND-MODEL-ADAPTERS.md`；desktop `buildAdaptersFromEnv` 不含 LexEdge
- **影响**：桌面 agent 检索路径用不上 LexEdge
- **建议**：env 存在时 opt-in 接入

#### C12 — Role/preset 工具白名单过窄

- **严重度**：WARN | **置信度**：79
- **位置**：`turn-orchestrator.ts` — `allowedToolNames` 过滤暴露工具
- **影响**：自定义角色隐藏有用工具 schema
- **建议**：设置 UI 校验自定义 Role；默认 preset 保持 undefined allowlist

---

### (D) 编排 / 策略过约束

#### D1 — 可交付问法自动短路到 execute_workflow

- **严重度**：WARN | **置信度**：87
- **位置**：`turn-orchestrator.ts` — `shouldAutoRunDeliverableWorkflow`
- **影响**：主代理跳过多步推理与工具选择
- **建议**：policy opt-in；workflow 失败回落正常 loop

#### D2 — 模型身份/连通性启发式短路

- **严重度**：WARN | **置信度**：85
- **位置**：`tryBuildModelIdentityReply` / connectivity check
- **影响**：边缘问法可能误短路（通常可接受）
- **建议**：收紧 regex

#### D3 — STRICT_TOOL_STREAM 默认行为

- **严重度**：WARN | **置信度**：83
- **位置**：`turn-orchestrator.ts` — `LAWMIND_STRICT_TOOL_STREAM`
- **影响**：首跳体感非流式；部分 UI 超时风险
- **建议**：桌面 SSE 默认放宽；保留 JSON tool-selection hop

#### D4 — Citation/grounded 阻断渲染

- **严重度**：WARN | **置信度**：86
- **位置**：`citation-mode.ts` + `rendering.ts` + `render-tool-messages.ts`
- **影响**：缺锚仍挡 Word 导出（控权保留）；**文案已区分**对话草稿可续 vs 仅挡导出（2026-07-23）
- **建议**：~~区分聊天草稿与 render~~ **文案/提示已落地**；门禁本身保留

#### D5 — Abort 仅在模型轮次间隙检查

- **严重度**：WARN | **置信度**：82
- **位置**：`turn-abort.ts` + `runtime-model-call.ts`
- **影响**：~~进行中调用停不掉~~ → **已缓解（2026-07-23）**：`bindTurnAbortSignal` + fetch/stream `signal`；用户中止不重试
- **建议**：~~AbortSignal 传入 model-call~~ **已落地**

#### D6 — highSecurityMode 关 web_search

- **严重度**：WARN | **置信度**：80
- **位置**：desktop platform 路由
- **影响**：高安全下无网络检索
- **建议**：文档化；允许 scoped statute-web allowlist

#### D7 — Solo 关闭 reviewCampaignParallel

- **严重度**：WARN | **置信度**：78
- **位置**：`src/lawmind/policy/edition.ts`
- **影响**：~~审查串行~~ → **已缓解（2026-07-23）**：Solo 默认 `reviewCampaignParallel: true`
- **建议**：~~Solo opt-in 并行~~ **已落地**

#### D8 — 每条用户消息清空 pendingClarificationKeys

- **严重度**：INFO | **置信度**：72
- **位置**：`turn-orchestrator.ts`
- **影响**：会话态「仍待澄清」信号可能丢失（compact 后有部分补回）
- **建议**：未回答前在 system note 中保留

---

### (E) 模型适配 / 配置

#### E1 — maxTokens 全局 4096

- **严重度**：BLOCK | **置信度**：93
- **位置**：`src/lawmind/models/resolve.ts` — `baseAgentModelDefaults`；`runtime-model-call.ts` 下发 `max_tokens`
- **影响**：长草稿/审查中途截断 — **最大硬伤**
- **建议**：按 catalog / 任务映射；`LAWMIND_AGENT_MAX_TOKENS`

#### E2 — temperature 默认 0.3

- **严重度**：WARN | **置信度**：88
- **位置**：同上 resolve defaults；`runtime-model-call.ts`
- **影响**：谈判措辞/多版本草稿偏钝
- **建议**：模型配置可调；任务类型覆盖（draft vs classify）

#### E3 — 无 stop sequences

- **严重度**：WARN | **置信度**：75
- **位置**：agent 路径未见 stop
- **影响**：多数场景无妨；部分 provider 需 stop 防跑飞
- **建议**：自定义模型 profile 可选 `stop`

#### E4 — 超时来源不一致

- **严重度**：WARN | **置信度**：80
- **位置**：`runtime-model-call.ts` 默认 60s vs resolve `LAWMIND_AGENT_TIMEOUT_MS` 默认 120000
- **影响**：不同路径中止行为不一致
- **建议**：统一使用 resolve 的 `timeoutMs`

#### E5 — 检索模型强制 JSON-only

- **严重度**：WARN | **置信度**：85
- **位置**：`src/lawmind/retrieval/openai-compatible.ts`
- **影响**：~~解析失败 → 空 claims~~ → **已缓解（2026-07-23）**：`fallbackRetrievalFromNonJson` 降级为低置信纯文本 + 风险旗标
- **建议**：~~markdown fallback~~ **已落地**

#### E6 — reasoning 默认非 model 起草

- **严重度**：WARN | **置信度**：82
- **位置**：`src/lawmind/reasoning/model-draft.ts` — 需 `LAWMIND_REASONING_MODE=model`
- **影响**：段落可能绕开主模型走关键词草稿
- **建议**：已配置 agent 模型时默认 `model`

#### E7 — model tier 仅展示不路由

- **严重度**：INFO | **置信度**：70
- **位置**：`src/lawmind/models/model-tier.ts`
- **影响**：无 advisor/worker 自动配对
- **建议**：可选 fleet：worker 跑 tool loop，advisor 终稿合成

#### E8 — directive-parser max_tokens 2048

- **严重度**：WARN | **置信度**：78
- **位置**：`src/lawmind/agent/orchestrator/directive-parser.ts`
- **影响**：多智能体工作流规划被截断
- **建议**：抬到 4096+ 或流式 plan

---

### (F) UI / 输入路径损失

#### F1 — 附件感知与真实上下文不一致

- **严重度**：WARN | **置信度**：86
- **位置**：`useLawmindChatSend.ts` + `buildFileContextMessagePrefix`
- **影响**：律师以为「已附上内容」；模型只有路径
- **建议**：文案标明「路径引用（需助手读取）」；一键 embed excerpt

#### F2 — 编辑/重发截断历史并丢掉 tool 行

- **严重度**：WARN | **置信度**：84
- **位置**：`src/lawmind/agent/session-message-mutate.ts`
- **影响**：改气泡后模型失去 tool 证据链
- **建议**：UI 警告；可选「工具结果压成摘要」而非直接删

#### F3 — UI 气泡省略 tool/system

- **严重度**：WARN | **置信度**：80
- **位置**：`session.ts` UI bubbles
- **影响**：律师对「模型看见了什么」心理模型不完整
- **建议**：可选「显示工具轨迹」

#### F4 — Compose context usage 可见但 compact 仍损

- **严重度**：INFO | **置信度**：78
- **位置**：`LawmindComposeContextUsage.tsx`
- **影响**：可见性好，动作仍可能突然丢上下文
- **建议**：compact 前预览「将移除 N 条 / M tokens」

#### F5 — 会议默认 allowWebSearch: false

- **严重度**：WARN | **置信度**：76
- **位置**：`MatterTeamMeetingPanel.tsx`
- **影响**：会议助手无法现场核外部事实
- **建议**：按会议开关，主席可开

#### F6 — maxHistoryMessages 未进设置

- **严重度**：INFO | **置信度**：74
- **位置**：desktop helpers 硬编码 50
- **影响**：同 A1，不可配置
- **建议**：policy `agentMaxHistoryMessages`

---

### (G) 已有优点（讨论改动时勿误拆）

| ID  | 位置                                 | 为何有助于能力         |
| --- | ------------------------------------ | ---------------------- |
| G1  | `compact.ts` 保留 tool pair          | 避免坏 tool chain      |
| G2  | compact attachment 复灌              | 压缩后恢复任务态       |
| G3  | `session-summary.ts` turn 末追加     | 摘要跨 compact 存活    |
| G4  | recall / revision / similar / golden | 定向记忆注入           |
| G5  | executable preferences               | 画像变可执行习惯       |
| G6  | content-trust / untrusted wrappers   | 防注入且不挡读取       |
| G7  | tool-concurrency 并行只读            | 同轮多检索更快         |
| G8  | runtime-model-call 流式+重试         | 韧性与体验             |
| G9  | Compose token/compact SSE            | 律师可在硬失败前行动   |
| G10 | compact-distill 律师确认采纳         | 信任正确的成长路径     |
| G11 | clarification-fields 结构化回灌      | 澄清答案带上下文       |
| G12 | runtime model identity in prompt     | 减少「不知道自己是谁」 |

---

## 4. 跨切主题

1. **硬编码 128k / 4096 / char÷4** 主导预算（`context-budget.ts`、`models/resolve.ts`），而 catalog 已暴露 `contextTokens` —— 最大解锁是模型感知限制（**A2、E1**）。
2. **澄清–执行–审批** 栈优先律师控权而非自主深度（**B2、B7、C2、C3、D4**）——应按 edition/mode 调参，而非一刀切拆除。
3. **ContextPlan 已设计未接线**（**A11**）——与架构文档对齐的快赢。
4. **多代理路径**有意不信任 peer 输出（**B4、A8**）——应用更丰富的交接产物平衡。
5. 文档已记「流式 compact 未进聊天区」（`docs/LAWMIND-CLAUDE-GAPS-PLAN.md`）—— UI 对 mid-turn compact 仍可能突兀。

---

## 5. 建议落地顺序（讨论排期用）

> **2026-07-23**：P0–P1 核心与多项 P2/P3 已落地。  
> **剩余项详细排期** → [`LAWMIND-MODEL-CAPABILITY-REMAINING-PLAN.md`](LAWMIND-MODEL-CAPABILITY-REMAINING-PLAN.md)（Wave W1–W7）。

| 优先级 | 改什么                                            | 对应 ID            | 预期收益                                   |
| ------ | ------------------------------------------------- | ------------------ | ------------------------------------------ |
| P0     | 模型感知 `maxTokens` + `contextTokens` 预算       | E1, A2             | ~~立刻拉长输出~~ **已落地**                |
| P0     | Compact：摘要后再丢                               | A1, A5             | 提取式 **已落地**；LLM 再摘要见剩余计划 W1 |
| P1     | 澄清门禁：只挡写/渲，不挡读研                     | C2（+ B2/B7）      | **已落地**（Intake 逃生口见 W2）           |
| P1     | 接线 ContextPlan                                  | A11                | **已落地**                                 |
| P1     | 附件可选正文摘录 + UI 诚实文案                    | A7, F1             | **已落地**                                 |
| P2     | 抬 Solo 工具次数 / 对齐超时 / 文档分页读          | C4, C5, C10, E4    | **已落地**（初档）                         |
| P2     | 记忆窗口与召回质量                                | A3, A4             | **已落地**（初档）；更深见剩余计划         |
| P3     | 温度/任务路由、citation 与草稿分离、Solo 并行审查 | E2, D4, D7, E5, E6 | D4/D7/E5 **已落地**；E2/E6 见 W5           |

---

## 6. 一句话诊断

LawMind 的编排（澄清、审批、可追溯）在控风险上是对的；当前最大问题是这些闸门和硬编码预算**没有按「模型能力包络」缩放**——尤其是 **4096 输出上限** 与 **与 catalog 脱节的 128k 预算**，等于按小模型在跑已接入的大模型。

---

## 7. 讨论记录（逐条填写）

> 讨论时在对应 ID 下补「决定 / 不做 / 延后 / 改法备注」。

### E1 — maxTokens 4096

- 状态：已落地
- 决定：`resolveCapabilityEnvelope` + `models/resolve` 默认按窗口比例输出
- 备注：env `LAWMIND_AGENT_MAX_TOKENS` 可覆盖

### A2 — context budget 128k

- 状态：已落地
- 决定：`estimateTokenBudget(..., { contextTokens })`；turn / sessions API 传入模型窗口
- 备注：

### A1 / A5 — compact 策略

- 状态：已落地（提取式蒸馏；非额外 LLM 调用）
- 决定：`buildDroppedSpanDigest` 回灌 + `compact-digest.md`；摘要字数随 contextTokens 缩放
- 备注：可选 LLM 再摘要仍可后置

### C2 — 澄清期是否放行 research

- 状态：已落地
- 决定：放行 research；只拦写/渲
- 备注：system prompt 原则 1 已同步

### A11 — ContextPlan 接线

- 状态：已落地
- 决定：`prepareTurnPromptContext` 注入 `contextPlanMarkdown`
- 备注：

### A7 / F1 — 文件引用喂正文

- 状态：已落地
- 决定：小文本经 `/api/fs/read` 自动嵌入；UI/前缀标明「已嵌入」vs「路径引用」
- 备注：会议室 agenda 仍可为路径引用（同步路径）

### 其它（按需追加）

- ID：
- 状态：待讨论
- 决定：
- 备注：

---

## 8. 最大化发挥 — 大单改造方案（Epic）

> 目标：在**不放弃律师控权与可追溯**的前提下，让接入模型按自身窗口与输出包络跑满。  
> 原则：**模型感知（model-aware）编排**，用「分层闸门」替代「一刀切硬顶」。  
> 对应三条硬顶：E1 输出 / A2 预算 / C2+B2 研究封锁。

### 8.1 目标态（改完后应长这样）

```text
所选模型 catalog
  ├─ contextTokens  ──► TokenBudget / auto-compact 阈值
  ├─ defaultMaxOut  ──► AgentModelConfig.maxTokens（可按任务抬高）
  └─ timeoutMs      ──► 模型调用 +（默认）工具超时同源

用户消息
  ├─ 附件：路径必给；小文件可选 inline excerpt
  ├─ ContextPlan 注入（本轮有哪些层）
  └─ 记忆窗口按 contextTokens 比例缩放

澄清态（pending clarification）
  ├─ 允许：只读检索 / analyze / read_* / research_task（只读语义）
  └─ 禁止：draft_document / execute_workflow / render_document / 对外发送

审批态（dangerous / strict）
  └─ 仍门禁：render / send / 高风险副作用；沙箱内低风险 workflow 步骤可自动批（可选）

Compact
  └─ summarize-then-drop（LLM 摘要 dropped span）+ 待采纳 distill 预览回灌
```

验收口碑（律师可感知）：

1. 同一长任务，强模型能**一次写完**大段审查/草稿，不再半截截断。
2. 长会话 compact 后，模型仍知道「案件目标、未决问题、已读材料」。
3. 「还差一个事实」时，助手仍能**先读材料再问**，而不是干等澄清。

### 8.2 中枢：`ModelCapabilityEnvelope`（建议新建）

新建模块（建议路径）：`src/lawmind/models/capability-envelope.ts`

```ts
export type ModelCapabilityEnvelope = {
  contextTokens: number; // 来自 catalog / custom override
  maxOutputTokens: number; // 默认输出上限
  charsPerToken: number; // 默认 3（中文偏紧）或 4；可 policy 覆盖
  toolCallsPerTurn: number; // 随窗口抬高，如 15→25→40
  toolTimeoutMs: number; // 默认对齐 model.timeoutMs
  promptWindowScale: number; // CASE/记忆窗口相对基准的倍率
};

export function resolveCapabilityEnvelope(opts: {
  contextTokens?: number;
  maxTokensOverride?: number;
  taskKind?: "chat" | "draft" | "review" | "classify" | "plan";
  policy?: LawMindWorkspacePolicy | null;
}): ModelCapabilityEnvelope;
```

推荐默认公式（可调）：

| 字段                         | 公式 / 规则                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `contextTokens`              | catalog 值；缺省 128_000；custom 可读 `LAWMIND_MODEL_CONTEXT_TOKENS`                                                    |
| `maxOutputTokens`            | `min(max(4096, floor(contextTokens * 0.125)), 32_768)`；`draft`/`review` 用 `0.20`；env `LAWMIND_AGENT_MAX_TOKENS` 覆盖 |
| `effectiveContextForCompact` | `contextTokens - summaryReserve - autoCompactBuffer`（沿用 policy.context）                                             |
| `toolCallsPerTurn`           | `contextTokens >= 100k → 25`；`>= 200k → 40`；否则 15；仍受 policy `agentMaxToolCallsPerTurn` / cap 50                  |
| `promptWindowScale`          | `clamp(contextTokens / 128_000, 0.5, 2.0)` 乘现有 `PROMPT_WINDOW.*`                                                     |

接线点（最小集合）：

1. `models/resolve.ts` — `baseAgentModelDefaults()` 改为吃 envelope，不再写死 4096
2. `agent/context-budget.ts` — `DEFAULT_EFFECTIVE_LIMIT` 改为入参 `contextTokens`
3. `agent/turn-orchestrator.ts` — compact / maxToolCalls / toolTimeout 用 envelope
4. `memory/prompt-windows.ts` — 导出 `scalePromptWindows(scale)`
5. desktop chat helpers — 把当前会话模型的 `contextTokens` 传入 agent config（`AgentModelConfig` 可增可选 `contextTokens?`）

### 8.3 Epic A — 写得长、算得准（拆三条硬顶的前两条）

**工时量级**：约 1.5–2.5 人日（含测试）

| 步骤 | 改动                                                                     | 测试                                                              |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| A.1  | `AgentModelConfig` 增加可选 `contextTokens?`；resolve 从 catalog 填入    | `models/resolve` 单测：qwen3.5-plus → maxTokens ≫ 4096            |
| A.2  | 实现 `capability-envelope.ts` + 公式                                     | 表驱动单测（8k/32k/128k/131k）                                    |
| A.3  | `estimateTokenBudget(session, policy, { contextTokens, charsPerToken })` | compact 阈值随窗口变化                                            |
| A.4  | chat/server 装配 agent 时传入 envelope                                   | 集成：选不同 builtin 模型，SSE `token_budget.effectiveLimit` 不同 |
| A.5  | Doctor / 设置页展示「本模型上下文 / 本轮输出上限」                       | 文案冒烟                                                          |

**明确不做（本 Epic）**：换 tokenizer 精确计数（可后续用 tiktoken/近似库）；不改 provider SDK。

### 8.4 Epic B — Compact 从「切片」变「蒸馏」（保住看得全）

**工时量级**：约 2–4 人日

| 步骤 | 改动                                                                                                | 测试                                                     |
| ---- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| B.1  | compact 前对 dropped span 调一次短摘要模型调用（可用同 agent 模型，`taskKind: classify` 低 maxOut） | 摘要写入 `session-summary.md` 或独立 `compact-digest.md` |
| B.2  | 摘要失败则回退现有切片逻辑（不阻断 turn）                                                           | 失败路径单测                                             |
| B.3  | distill 建议块以「待采纳预览」注入本轮 system note（只读）                                          | 律师未采纳也能让模型看见要点                             |
| B.4  | Compose compact 前预览：将移除 N 条 / 约 M tokens                                                   | UI + e2e 轻量                                            |

**风险控制**：摘要调用计入超时与费用；`maxConsecutiveCompactFailures` 已有，沿用。

### 8.5 Epic C — 澄清 / 审批分层（拆第三条硬顶）

核心理念：**澄清管「写与对外」，不管「读与研」**。

**工时量级**：约 1.5–3 人日（含 prompt 文案）

| 步骤 | 改动                                                                                      | 测试                                              |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| C.1  | `HEAVY_TOOL_NAMES` 拆为 `WRITE_HEAVY` vs `RESEARCH_HEAVY`；澄清门禁只拦 WRITE             | `tool-pipeline.test.ts` / engine-tools 测例改预期 |
| C.2  | System 原则 1 改写：澄清期**鼓励**只读检索与 `analyze_document`；禁止假装已懂并交付       | prompt 快照或字符串断言                           |
| C.3  | Intake gate：CASE 已含交付物类型 + 关键当事人时 `skipIntake`；增加「继续不澄清」resume 键 | router / orchestrator 测例                        |
| C.4  | （可选）`permissionMode: research` = 只读 + research_task，无 draft/render                | 产品若需要再开                                    |

**审批保持不动的底线**：

- `render_document` / 对外发送 / 高风险副作用仍须律师批
- Firm `strictDangerousToolApproval` 可继续卡 `execute_workflow`（或仅沙箱内 auto 低风险步）
- Citation grounded 仍可卡「正式导出」；聊天区草稿不走同一门

### 8.6 Epic D — 喂料升级（看得全的输入侧）

**工时量级**：约 2–3 人日

| 步骤 | 改动                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| D.1  | ContextPlan 接线进 `prepareTurnPromptContext`（半日内）                       |
| D.2  | 文件引用：`< N KB` 文本自动/一键 embed excerpt；UI 标明「路径引用 vs 已嵌入」 |
| D.3  | `analyze_document` 增加 offset/limit 分页；超大合同可连续读                   |
| D.4  | `PROMPT_WINDOW` × `promptWindowScale`；recall 改为路径+摘要为主               |

### 8.7 Epic E — 跑得完（工具预算与超时）

**工时量级**：约 1 人日

| 步骤 | 改动                                                                |
| ---- | ------------------------------------------------------------------- |
| E.1  | Solo 默认 tool calls：envelope 给出的 25（128k+）                   |
| E.2  | 工具超时默认 = `model.timeoutMs`；单工具可覆盖（OCR/workflow 更长） |
| E.3  | 工具错误文案带「本轮剩余调用次数」                                  |

### 8.8 建议排期（一张大单拆 3 个 PR）

| PR                  | 范围                     | 合并后律师可感知                                |
| ------------------- | ------------------------ | ----------------------------------------------- |
| **PR1「包络」**     | Epic A + D.1 ContextPlan | 输出变长；token 条跟模型变；prompt 有上下文地图 |
| **PR2「分层闸门」** | Epic C + E               | 澄清时仍能读材料；复杂审查更少中途停            |
| **PR3「长记忆」**   | Epic B + D.2–D.4         | 长 matter 不傻；附件真进上下文；大合同可分页    |

总工期粗估：**1–1.5 周**（单人专注）或 **3–5 人日核心路径（PR1+PR2 最小集）**。

### 8.9 明确不碰 / 后置（避免大单膨胀）

- 不拆律师审批终点与审计链
- 不默认打开 Firm 全网搜索
- 不静默 auto-adopt 记忆（distill 仍需律师确认写入 MEMORY）
- 不做完整 embedding RAG 平台（可后置；先路径+摘要+工具读）
- 不在本 Epic 做 advisor/worker 双模型路由（E7）

### 8.10 成功度量（上线后对照）

| 指标                                            | 现状粗画像    | 目标             |
| ----------------------------------------------- | ------------- | ---------------- |
| 长草稿截断率（finish_reason=length / 明显半截） | 高（受 4096） | 显著下降         |
| Compact 后首轮「忘记案件目标」投诉/日志         | 偶发          | 近零（摘要命中） |
| 澄清态下 research/analyze 成功率                | 被门禁挡      | 允许且审计可见   |
| `token_budget.effectiveLimit` 随模型变化        | 恒≈95k        | 随 catalog       |

### 8.11 讨论决议位（本大单）

- 状态：PR1–PR3 核心路径已落地（2026-07-23）
- 是否按 PR1→PR2→PR3 推进：**是**（均已合并进工作树）
- maxOutput 公式是否接受：采用更积极默认——chat/默认 **20%**、draft/review **25%**、硬顶 **65_536**（可用 `LAWMIND_AGENT_MAX_TOKENS` 覆盖）
- 澄清期是否放行 `research_task`：**是**（只拦 draft / execute_workflow / render）
- Compact 是否允许额外一次摘要模型调用（费用）：**否（当前）**——用提取式蒸馏零额外费用；LLM 再摘要可后置
- 备注：桌面 `buildAgentConfig`、CLI、sessions context-budget/compact 均已吃 envelope；附件小文本自动嵌入

---

## 9. 相关文档

- **`docs/LAWMIND-MODEL-CAPABILITY-REMAINING-PLAN.md`** — 剩余项 Wave W1–W7 详细执行计划（2026-07-23）
- `docs/LAWMIND-MODEL-ADAPTERS.md` — 接入与适配器
- `docs/LAWMIND-ENGINEERING-REVIEW.md` — 工程评分与 backlog
- `docs/LAWMIND-CLAUDE-GAPS-PLAN.md` — Claude Code 借鉴缺口（含流式 compact）
- `docs/LAWMIND-OPTIMIZATION-BACKLOG.md` — 产品北极星
- `docs/LAWMIND-ARCHITECTURE.md` — 含 ContextPlan 相关表述

---

_本文件含审计结论与最大化改造 Epic；落地改动时请同步更新 §7 / §8.11 讨论记录与 ENGINEERING-REVIEW 附录。_
