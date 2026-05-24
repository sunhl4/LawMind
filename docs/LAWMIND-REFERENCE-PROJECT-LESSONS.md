# LawMind 参考项目可借鉴清单

本文档把法律垂直项目、通用 agent 工作台、Git-native agent 标准、可观测性工具和编排框架放在同一张工程地图里，目的不是简单模仿，而是提炼 LawMind 可吸收的成熟模式。

LawMind 的主线仍然不变：**面向个人律师优先的法律生产系统**，以 **澄清 -> 执行 -> 交付 -> 审核 -> 审计** 为闭环，以 Deliverable-First Architecture（DFA）为商业化核心。所有借鉴都应服务于这个主线，而不是把 LawMind 拉回通用聊天助手或插件市场。

## 一、评估标尺

### 1. LawMind 已有优势

| 维度         | 当前基础                                                          | 关键位置                                                                                                   |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 交付物本位   | `DeliverableType`、`DeliverableSpec`、验收门禁、验收交付包        | `src/lawmind/deliverables/`、`src/lawmind/delivery/`、`docs/LAWMIND-DELIVERABLE-FIRST.md`                  |
| 法律责任边界 | 先澄清再执行、高风险动作确认、审核台、审计导出                    | `src/lawmind/runtime/tool-pipeline.ts`、`src/lawmind/agent/dangerous-tool-policy.ts`、`src/lawmind/audit/` |
| 本地工作区   | Markdown 记忆、matter JSON/JSONL、workspace spec、模板与 artifact | `src/lawmind/memory/`、`src/lawmind/adapters/matter-storage/`、`workspace/`                                |
| 多角色协作   | Role 一等对象、委派工具、协作审计、工作流模板                     | `src/lawmind/core/role.ts`、`src/lawmind/agent/collaboration/`                                             |
| 桌面闭环     | Electron 本地 API、审核台、Matter 工作台、设置与健康检查          | `apps/lawmind-desktop/`                                                                                    |

### 2. 当前最值得从外部吸收的短板

| 短板                        | 说明                                                                      | 参考方向                                          |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- |
| 批准队列还不够产品化        | 危险工具策略已有，但用户面对的是散落在聊天/协作流里的状态                 | ProWorkBench、LangGraph HITL                      |
| 任务队列可视化不足          | `jobs/*.json`、SSE、队列服务已有，但缺少统一任务看板心智                  | Ralph                                             |
| 可观测性不够集中            | chat trace、audit、health、insights 分散存在                              | AgentActa、Agent Replay、agentsview               |
| integration 生态偏薄        | 当前文档明确无 DMS、billing、e-discovery 内置连接器                       | Claude for Legal、OpenContracts、ProWorkBench MCP |
| 工具运行隔离不够硬          | 法律高风险工具目前主要靠 policy/pipeline，而非 WASM/容器隔离              | cLawyer                                           |
| workflow 内容库还不够像产品 | 已有 `workspace/lawmind/workflows/*.json`，但需要更像律师可浏览的 library | Suzie Law、Claude for Legal                       |
| 巨型文件维护成本高          | 部分 agent tools、runtime、renderer 页面过大                              | Team Suzie 的平台/下游拆分、通用模块化经验        |

## 二、参考项目总览

| 类别             | 项目                                                                    | 一句话价值                                                                  | LawMind 借鉴优先级 |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| 法律安全硬化     | [cLawyer](https://github.com/lawyered0/cLawyer)                         | OpenClaw 法律化、matter 隔离、WASM 沙箱、hash-chain 审计                    | 高                 |
| 法律工作台       | [Suzie Law](https://github.com/firelex/suzielaw)                        | Harvey 式 UI、workflow library、practice persona、法域检索、redline         | 高                 |
| 法律技能套件     | [Claude for Legal](https://github.com/anthropics/claude-for-legal)      | practice-area plugins、named agents、MCP connectors、scheduled legal agents | 高                 |
| 法律文档 KB      | [OpenContracts](https://github.com/Open-Source-Legal/OpenContracts)     | 自托管文档标注、语义检索、MCP 暴露语料库                                    | 中高               |
| Git-native agent | [GitAgent Protocol](https://github.com/open-gitagent/gitagent)、GitClaw | agent identity/rules/memory/workflows 全部文件化、版本化                    | 高                 |
| 治理型工作台     | [ProWorkBench](https://github.com/jamiegrl100/proworkbench)             | approvals queue、tool governance、Doctor、MCP server 管理                   | 高                 |
| 任务队列         | [Ralph](https://github.com/fitchmultz/ralph)                            | repo 内 JSONC 队列、明确生命周期、多 runner 执行                            | 高                 |
| 会话审计         | [AgentActa](https://github.com/mirajchokshi/agentacta)                  | SQLite FTS5 检索 agent session、timeline、健康评分                          | 中高               |
| agent 回放       | [Agent Replay](https://github.com/agentreplay/agentreplay)              | 本地 agent observability、持久记忆、回放                                    | 中                 |
| 成本观察         | [agentsview](https://github.com/wesm/agentsview)                        | 多 agent token/cost 统计、SQLite 本地索引                                   | 中                 |
| 通用工作台       | [CoWork OS](https://github.com/CoWork-OS/CoWork-OS)                     | GUI-first 多工具工作台、统一 agent 管理                                     | 中                 |
| 编排框架         | [LangGraph](https://github.com/langchain-ai/langgraph)                  | interrupt/resume、checkpointer、human-in-the-loop                           | 高                 |
| 多 agent 框架    | CrewAI、AutoGen、Semantic Kernel                                        | agent role、handoff、crew run report                                        | 低中               |

## 三、法律垂直项目

### 1. cLawyer

**值得借鉴的部分**

| 模式                 | 具体做法                                                              | LawMind 落点                                                                                                  | 优先级 |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Matter 硬隔离        | conversation、tool access、memory 默认绑定 matter，禁止跨 matter 泄漏 | `src/lawmind/runtime/tool-pipeline.ts` 增加 `matterScopeMiddleware`；`src/lawmind/memory/` 读取报告标记 scope | P0     |
| WASM/能力沙箱        | 未信任工具运行在 WASM，按 HTTP/secrets/filesystem 能力显式授权        | 先做高风险工具子进程隔离 POC，再评估 WASM；不直接重写全部工具                                                 | P2     |
| Deny-by-default 网络 | legal mode 默认禁止外联，仅允许显式 allowlist host/path               | `lawmind.policy.json` 增加 `networkAllowlist`；web search / connector 工具读取 policy                         | P1     |
| Secret host boundary | 密钥只在 host boundary 注入，不暴露给工具上下文                       | `apps/lawmind-desktop/electron/lawmind-key-vault.cjs`、模型 provider、MCP connector                           | P1     |
| Hash-chain audit     | 审计事件 append-only 且可校验未篡改                                   | `src/lawmind/audit/` 增加 `previousHash`、`eventHash` 可选字段                                                | P1     |
| Lawyer quickstart    | `onboard --quickstart` 与 `--advanced` 双路径                         | `LawmindFirstRunDialog` 拆成“律师 30 秒首跑”和“IT/私有化高级设置”                                             | P0     |

**不要直接照搬**

- 不必把 LawMind 改成 Rust 或 PostgreSQL 优先；LawMind 的 TypeScript/Electron 本地闭环更利于快速产品迭代。
- 不应让沙箱改造阻塞 DFA、审核台、workflow library 等短期商业化能力。

**建议形成的工程任务**

1. `tool-pipeline` 增加 matter scope 检查：所有文件、记忆、交付物工具必须带 `matterId` 或明确声明 global read。
2. `audit` 事件新增可选 hash-chain 输出，先不破坏旧 JSONL。
3. `policy` 增加网络 allowlist 字段，仅由 web search / connector 工具消费。
4. 桌面设置增加“高安全模式”说明：网络、危险工具、审计完整性三项状态。

### 2. Suzie Law / Team Suzie

**值得借鉴的部分**

| 模式                      | 具体做法                                              | LawMind 落点                                                                                            | 优先级 |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| Workflow Library          | 160+ legal workflows 以卡片/分类/搜索方式呈现         | `workspace/lawmind/workflows/*.json` + `LawmindSettingsCollaboration.tsx` 拆出 `LawmindWorkflowLibrary` | P0     |
| Practice-area personas    | litigation、M&A、IP、tax 等 persona 可切换            | `src/lawmind/core/role.ts` 扩展 role categories；`LawmindSettingsAssistants.tsx` 用 role 模板创建       | P1     |
| Tabular matter review     | 行是文档，列是问题，单元格为有引用的回答              | Matter 工作台新增“批量问卷/审查表”视图；复用 sources preview                                            | P1     |
| Source pane jump          | 每个答案 citation 可点击跳原文                        | 已有 `/api/sources/:id/preview`，继续补“段落级 anchor”与“证据高亮”                                      | P0     |
| DOCX tracked changes      | redline 提案以 Accept/Reject 卡片呈现，导出 Word 修订 | `ReviewWorkbench` / draft revision 链路增加 redline proposal 数据结构                                   | P2     |
| Platform/downstream split | Team Suzie 是平台，Suzie Law 是薄下游 app             | LawMind 可把 engine/domain 与 desktop UI 更清晰分层，但不拆 repo                                        | P1     |

**不要直接照搬**

- 不要把 LawMind 变成“workflow 数量竞赛”。每个 workflow 必须映射 `DeliverableSpec`、acceptance gate、audit event。
- 不要引入 Postgres/Redis 作为默认依赖；可作为 Firm/Private Deploy 可选方案。

**建议形成的工程任务**

1. 新增 `LawmindWorkflowLibrary.tsx`：按 practice area、deliverable type、risk level、role 过滤 workflow。
2. 给 workflow schema 增加 `deliverableType`、`requiredSources`、`acceptancePackRequired`。
3. Matter 工作台新增“审查矩阵”纯前端模型：先对本地 documents/sources 生成 rows，问题列由 workflow 提供。
4. `docs/LAWMIND-USER-MANUAL.md` 增加“从工作流库启动任务”的用户路径。

### 3. Claude for Legal

**值得借鉴的部分**

| 模式                     | 具体做法                                                             | LawMind 落点                                                                         | 优先级 |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Named agents             | Vendor Agreement Reviewer、NDA Triager、Renewal Watcher 等以工作命名 | Role + workflow template 的展示名称应是“律师工作”，不是技术能力                      | P0     |
| Practice profile         | 每个 practice plugin 有 profile 和 playbook                          | `LAWYER_PROFILE.md` 扩展到 `FIRM_PROFILE.md`、`CLIENT_PROFILE.md`、practice playbook | P1     |
| MCP connector catalog    | Ironclad、DocuSign、iManage、Everlaw、CourtListener 等连接器         | `docs/LAWMIND-INTEGRATIONS.md` 增加 connector roadmap；先 read-only                  | P1     |
| Scheduled agents         | renewal watcher、docket watcher、regulatory monitor 等后台任务       | 复用 `jobs` + SSE + notification，增加 schedule source                               | P1     |
| Attorney review language | 明确声明 AI output 是 draft，律师负责最终结论                        | 首跑、导出、验收包、审核台统一文案                                                   | P0     |

**不要直接照搬**

- 不要依赖 Claude Cowork/Claude Code plugin 作为主运行环境；LawMind 的独立桌面和本地 API 是核心资产。
- 不要把 MCP connector 放在 P0，短期应先做 read-only filesystem/workspace MCP。

**建议形成的工程任务**

1. `workspace/lawmind/workflows/` 内置一批 named workflow：NDA 初审、律师函、证据时间线、尽调审查表、客户邮件摘要。
2. `docs/LAWMIND-INTEGRATIONS.md` 增加三阶段路线：read-only MCP、DMS connector、practice-management connector。
3. 审核台和导出包统一加入 attorney responsibility 声明。
4. `jobs` 增加 scheduled trigger 字段，但先只支持本地定时，不做远程 daemon。

### 4. OpenContracts

**值得借鉴的部分**

| 模式                | 具体做法                                   | LawMind 落点                                                         | 优先级 |
| ------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------ |
| Document annotation | 文档标注、评论、版本化 annotation          | sources preview 加 annotation layer；审查意见可回写到 source anchors | P2     |
| Corpus agent        | agent 可检索、标注、抽取知识库             | Retrieval Layer 读取 matter corpus；输出带 source anchors            | P1     |
| MCP server          | 把文档语料暴露给 Claude/Cursor 等 MCP 工具 | `apps/lawmind-desktop/server` 或单独 CLI 提供 read-only MCP server   | P1     |
| Human + AI KB       | 人工标注和 AI 抽取共同构建知识库           | `memory/adoption-service` 扩展 source-backed learning                | P1     |

**不要直接照搬**

- OpenContracts 是 KB/annotation 平台，LawMind 是生产系统；不能让文档标注吞掉交付闭环。
- 不建议默认引入完整 Docker stack。

**建议形成的工程任务**

1. 设计 `SourceAnnotation` 类型：`sourceId`、`range`、`kind`、`comment`、`createdBy`、`linkedDraftId`。
2. `memory/adoption-service` 支持从 annotation 生成 pending learning。
3. 做只读 MCP POC：列 matters、列 drafts、读 source preview、读 acceptance pack。

## 四、Git-native agent 与 workspace 标准

### 5. GitAgent Protocol / GitClaw

**值得借鉴的部分**

| 模式                | 具体做法                                              | LawMind 落点                                                                  | 优先级 |
| ------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Agent manifest      | `agent.yaml` 描述模型、工具、技能、版本               | `workspace/lawmind/agent.yaml` 或 `lawmind.policy.json` 扩展 manifest section | P1     |
| Rules as files      | `RULES.md`、`DUTIES.md`、skills、tools、memory 目录化 | 规范 `workspace/lawmind/{rules,workflows,deliverables,playbooks}`             | P0     |
| Runtime memory      | `memory/runtime/dailylog.md`、`context.md`            | 对齐现有 `memory/YYYY-MM-DD.md`，明确短期/长期/待采纳记忆边界                 | P0     |
| Git diff governance | agent 行为、规则、记忆变更可 diff、可 review          | `MemoryInspector` 与 policy change audit 增加 diff-first UX                   | P1     |
| Delegation standard | agent 可以 depends on / delegate to other agents      | 对齐 `Role`、`delegate_to_role`、`ApprovalRequest.targetRole`                 | P1     |

**建议的 LawMind workspace 标准**

```text
workspace/lawmind/
  agent.yaml                 # LawMind workspace manifest
  policy.json                # 可由现有 lawmind.policy.json 迁移或引用
  rules/
    mandatory.md             # 红线规则
    review.md                # 审核规则
  workflows/
    nda-review.json
    demand-letter.json
  deliverables/
    contract.employment.json
  playbooks/
    contract-review.md
  memory/
    runtime/
      context.md
      dailylog.md
    adoption/
      pending.jsonl
```

**不要直接照搬**

- 不要把所有运行数据都强制进 Git；真实律师数据仍需遵守 workspace `.gitignore` 与私有化边界。
- 不要引入新的标准名导致现有 `MEMORY.md`、`LAWYER_PROFILE.md` 失效；应先做兼容映射。

**建议形成的工程任务**

1. 写 `docs/LAWMIND-WORKSPACE-STANDARD.md`，定义 `workspace/lawmind/` 目录契约。
2. `GET /api/health` 增加 workspace standard 检查：rules/workflows/deliverables 是否存在、是否可解析。
3. `MemoryInspector` 支持按 scope 显示 diff：firm/lawyer/client/matter/playbook/project。

## 五、通用本地 agent 工作台

### 6. ProWorkBench

**值得借鉴的部分**

| 模式                  | 具体做法                                               | LawMind 落点                                                  | 优先级 |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ------ |
| Approvals Queue       | 所有 tool call 可 approve once / approve always / deny | 桌面新增集中“待批准”面板，承接 `toolRequiresExplicitApproval` | P0     |
| Tool governance UI    | 查看工具来源、权限、禁用不可信工具                     | 设置页增加 tool registry 可视化；Firm/Private 可锁定策略      | P1     |
| Doctor self-check     | 一键检查 model、tool、env、backend                     | 扩展 `/api/health` 与设置页“体检”                             | P0     |
| MCP server management | UI 添加、启停 MCP server                               | 中期补 MCP connector 时引入，不在 P0                          | P2     |
| Local SQLite history  | conversation/tool/approval/history 本地可检索          | 不替代 JSONL 真相源；可作为索引层                             | P2     |

**建议形成的工程任务**

1. 新增 `LawmindApprovalQueue.tsx`：按 pending approval 展示 tool name、risk、matter、arguments summary。
2. 新增 `/api/approvals` read/write 路由，优先读 `workspace/matters/<id>/approvals.jsonl`。
3. `tool-pipeline` 在需要批准时返回结构化 interrupt payload，而非只给自然语言提示。
4. 设置页新增“工具治理”子页：工具名、来源、risk ceiling、allowed roles、是否需批准。

### 7. Ralph

**值得借鉴的部分**

| 模式                         | 具体做法                                           | LawMind 落点                                              | 优先级 |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ------ |
| Repo-local queue             | `.ralph/queue.jsonc`、`done.jsonc`、`config.jsonc` | LawMind 已有 `queue.jsonl`、`jobs/*.json`，需要统一 UI    | P0     |
| Explicit lifecycle           | created / running / blocked / done / canceled      | `ExecutionState`、`jobs`、queue items 统一状态字典        | P0     |
| Dependency links             | 任务可以依赖其他任务                               | `queue-write-service` 增加 `dependsOn`、`blockedBy`       | P1     |
| Multi-runner isolation       | 每个 runner 可有隔离 workspace                     | LawMind 可用于多模型/多角色比较，不作为短期主线           | P2     |
| Plan/implement/review phases | 1/2/3-phase execution                              | 对齐 LawMind 的 clarify/research/draft/review/render 阶段 | P0     |

**建议形成的工程任务**

1. Matter 工作台增加“任务队列”tab：所有 open queue items、jobs、approval requests 汇总。
2. `queue.jsonl` item 增加 `phase`、`dependsOn`、`blockedReason`。
3. `GET /api/jobs` 和 `GET /api/queues` 的状态标签使用同一个 `execution-state-label` 纯函数。
4. workflow run 完成后自动写入 done/history，而非只停留在 job 状态。

### 8. CoWork OS

**值得借鉴的部分**

| 模式                       | 具体做法                                  | LawMind 落点                                                        | 优先级 |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------- | ------ |
| Everything Workbench       | 文件、聊天、任务、agent 在一个 GUI 中组织 | MatterWorkbench 拆成可组合 panels，避免继续膨胀                     | P1     |
| GUI-first agent management | 通过 UI 管理 agent、工具、上下文          | Settings Assistants / Collaboration / Models 收敛成“团队与工具”模块 | P1     |
| General document workspace | 文档、表格、邮件等都可成为工作对象        | LawMind 保持法律 matter 主轴，但增强 file/context picker            | P1     |

**不要直接照搬**

- CoWork OS 是横向超级应用，LawMind 不应淡化法律交付、验收和责任边界。

## 六、可观测性、审计与回放

### 9. AgentActa

**值得借鉴的部分**

| 模式                   | 具体做法                                               | LawMind 落点                                        | 优先级 |
| ---------------------- | ------------------------------------------------------ | --------------------------------------------------- | ------ |
| SQLite FTS5 索引       | messages、tool calls、file edits、decisions 可全文检索 | 可作为 `audit/`、`sessions/`、`jobs/` 的只读索引层  | P2     |
| Timeline view          | 按日期看所有 session 和事件                            | 桌面新增 matter timeline / global timeline          | P1     |
| Session health scoring | retry loop、bail-out、error rate、vague prompt 等信号  | `src/lawmind/insights/` 增加 `computeSessionHealth` | P1     |
| File activity          | 跨 session 追踪文件改动                                | 适合审计“哪些源文件/交付物被 AI 读写过”             | P2     |

**建议形成的工程任务**

1. 定义 `TurnTraceEvent`：message、tool_call、tool_result、approval、draft_created、rendered、error。
2. `LawmindChatExecutionTrace.tsx` 增加 timeline mode。
3. `insights` 增加 health score：retry count、model error、blocked approvals、unfinished jobs、missing citation。
4. 长期增加本地索引，不改变 JSON/JSONL 真相源。

### 10. Agent Replay

**值得借鉴的部分**

| 模式                   | 具体做法                | LawMind 落点                                        | 优先级 |
| ---------------------- | ----------------------- | --------------------------------------------------- | ------ |
| Replay                 | 回放 agent 执行过程     | 审计导出增加 replay-friendly JSON；桌面只读回放模式 | P2     |
| Persistent memory view | 观察 agent 怎样使用记忆 | `MemoryInspector` 显示本轮读取了哪些 memory source  | P1     |
| Native local app       | 本地、无 Docker、无云   | LawMind 已符合，强化私有化销售叙事                  | P0     |

### 11. agentsview

**值得借鉴的部分**

| 模式                | 具体做法                 | LawMind 落点                                                  | 优先级 |
| ------------------- | ------------------------ | ------------------------------------------------------------- | ------ |
| Token/cost tracking | 多 agent、多模型成本汇总 | `src/lawmind/models/` 与 `GET /api/health` 增加 usage summary | P1     |
| Cross-agent view    | 不同 agent 运行统一看板  | LawMind 的 roles/jobs/turns 可统一到 insights                 | P1     |

**建议形成的工程任务**

1. `runTurn` 输出 `modelUsage`（若 provider 提供 token usage）。
2. `jobs` 记录累计 usage。
3. 设置页增加“本地使用统计”，默认本地、可关闭。

## 七、编排与人机循环框架

### 12. LangGraph

**值得借鉴的部分**

| 模式                      | 具体做法                                                            | LawMind 落点                                                              | 优先级 |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| interrupt/resume          | graph node 调用 `interrupt()` 暂停，外部 `Command(resume=...)` 继续 | LawMind 把 clarification、approval、job cancel 都规范成 interrupt payload | P0     |
| Durable checkpoint        | 中断时持久化 graph state                                            | `tasks/checkpoints.ts`、`jobs/*.json` 统一 checkpoint 语义                | P0     |
| Human decision types      | approve/edit/reject/respond                                         | `ApprovalRequest` 增加 decision type；UI 支持编辑工具参数                 | P1     |
| thread_id                 | 用 thread 标识恢复上下文                                            | 约定 `threadId = matterId + taskId + sessionId`                           | P0     |
| Static/dynamic interrupts | 可按节点或条件中断                                                  | ToolPolicy pipeline 支持 role/risk/edition 条件中断                       | P1     |

**不要直接照搬**

- 不建议把现有 engine 整体迁到 LangGraph。LawMind 的领域状态、deliverable gate、review gate 已经在自有架构中形成，迁移收益不足。
- 应借鉴概念与 API 语义，而不是引入框架锁定。

**建议形成的工程任务**

1. 写 `docs/LAWMIND-INTERRUPT-RESUME.md`：定义 interrupt payload、resume command、checkpoint、错误恢复。
2. `runTurn` / `executeWorkflow` 遇到 approval/clarification 时返回统一 `requiresAction` 对象。
3. 桌面 chat 对 `requiresAction` 使用统一组件渲染，而非分散判断 status。
4. 审核台支持 `edit` 型批准：用户修改工具参数或 draft metadata 后继续。

### 13. CrewAI / AutoGen / Semantic Kernel

**值得借鉴的部分**

| 模式                | 具体做法                                      | LawMind 落点                                         | 优先级 |
| ------------------- | --------------------------------------------- | ---------------------------------------------------- | ------ |
| Agent role contract | 每个 agent 有 goal、backstory、tools、handoff | `core/role.ts` 增加 handoff input/output schema      | P1     |
| Crew run report     | 多 agent 执行后生成结构化报告                 | collaboration audit export 增加 run report           | P1     |
| Reviewer role       | 一个 agent 输出，另一个 agent review          | LawMind 已有 review gate，可把互审做成 workflow 模板 | P1     |

**不要直接照搬**

- 不要让 agent 框架的“角色扮演”替代 LawMind 的审批与责任模型。
- 不要把 Python 多 agent 框架引入桌面主链路，除非作为外部 runner。

## 八、按能力域整理的可借鉴清单

### 1. 信任、安全与权限

| 借鉴项                  | 来源                    | LawMind 实施建议                              | 优先级 |
| ----------------------- | ----------------------- | --------------------------------------------- | ------ |
| Matter scope middleware | cLawyer                 | 文件/记忆/工具访问都绑定 matter 或显式 global | P0     |
| Approval queue          | ProWorkBench、LangGraph | 集中 UI + `requiresAction` payload            | P0     |
| Network allowlist       | cLawyer                 | `lawmind.policy.json` 增加 allowlist          | P1     |
| Hash-chain audit        | cLawyer                 | audit JSONL 可选 hash 字段                    | P1     |
| Tool governance UI      | ProWorkBench            | 展示工具来源、权限、角色 allowlist            | P1     |
| Secret boundary         | cLawyer                 | 工具只拿 scoped token，不拿原始 key           | P1     |
| Sandbox POC             | cLawyer                 | 高风险工具先子进程/worker 隔离                | P2     |

### 2. 任务、队列与人机循环

| 借鉴项                | 来源             | LawMind 实施建议                          | 优先级 |
| --------------------- | ---------------- | ----------------------------------------- | ------ |
| Interrupt/resume 契约 | LangGraph        | clarification/approval/cancel 统一对象    | P0     |
| Task board            | Ralph            | Matter 工作台新增任务队列 tab             | P0     |
| Lifecycle 字典        | Ralph            | jobs、queue、execution state 共用状态标签 | P0     |
| Decision types        | LangGraph        | approve/edit/reject/respond               | P1     |
| Dependency links      | Ralph            | queue item 支持 dependsOn/blockedBy       | P1     |
| Scheduled jobs        | Claude for Legal | 本地 watcher/renewal/docket template      | P1     |

### 3. 交付物与工作流库

| 借鉴项                      | 来源                       | LawMind 实施建议                                     | 优先级 |
| --------------------------- | -------------------------- | ---------------------------------------------------- | ------ |
| Workflow library UI         | Suzie Law                  | workflow 卡片、分类、搜索、按 role 过滤              | P0     |
| Named legal agents          | Claude for Legal           | 用律师任务命名 workflow，而不是技术名                | P0     |
| Practice profile            | Claude for Legal、GitAgent | firm/lawyer/client/playbook profile 分层             | P1     |
| Tabular review              | Suzie Law                  | Matter 审查矩阵，行文档列问题                        | P1     |
| Tracked changes             | Suzie Law                  | redline proposal + Word 修订导出                     | P2     |
| Deliverable workflow schema | LawMind 自有 + Suzie       | workflow 必须声明 deliverableType 和 acceptance gate | P0     |

### 4. 记忆、知识库与来源

| 借鉴项                 | 来源          | LawMind 实施建议                            | 优先级 |
| ---------------------- | ------------- | ------------------------------------------- | ------ |
| Workspace standard     | GitAgent/GAP  | `workspace/lawmind/` 目录规范               | P0     |
| Runtime memory split   | GitAgent/GAP  | context/dailylog/adoption 分清              | P0     |
| Source annotation      | OpenContracts | source range + comment + linked draft       | P2     |
| Corpus MCP             | OpenContracts | 只读暴露 matters/sources/drafts             | P1     |
| Memory diff UX         | GitAgent/GAP  | MemoryInspector 显示 profile/rule 变更 diff | P1     |
| Source-backed learning | OpenContracts | annotation -> pending learning              | P1     |

### 5. 可观测性与运维

| 借鉴项               | 来源                    | LawMind 实施建议                        | 优先级 |
| -------------------- | ----------------------- | --------------------------------------- | ------ |
| Session health score | AgentActa               | retry/error/citation/unfinished signals | P1     |
| Timeline view        | AgentActa、Agent Replay | matter timeline / global timeline       | P1     |
| Token/cost tracking  | agentsview              | turn/job/model usage summary            | P1     |
| Doctor page          | ProWorkBench            | health 字段产品化展示                   | P0     |
| Replay export        | Agent Replay            | audit export 加 replay JSON             | P2     |
| Local index          | AgentActa               | SQLite FTS 只读索引，不替代真相源       | P2     |

### 6. 集成与生态

| 借鉴项                        | 来源                           | LawMind 实施建议                             | 优先级 |
| ----------------------------- | ------------------------------ | -------------------------------------------- | ------ |
| MCP connector roadmap         | Claude for Legal、ProWorkBench | 先 read-only，再 DMS，再 practice-management | P1     |
| Court/legal source connectors | Claude for Legal、Suzie Law    | CourtListener/eCFR 等可选 connector          | P1     |
| DMS read-only connector       | Claude for Legal               | iManage/NetDocuments 先列路线，不急做        | P2     |
| Export sync pattern           | LawMind 自有                   | 保持 filesystem/export 为默认                | P0     |

## 九、建议路线图

### P0：先补产品闭环里的明显缺口

1. **Approval Queue**  
   从 ProWorkBench + LangGraph 学：所有危险工具、澄清、审批都进入统一 `requiresAction` 对象和 UI。

2. **Workflow Library**  
   从 Suzie Law + Claude for Legal 学：把已有 workflow template 产品化，按律师任务命名、分类、搜索。

3. **Task Board**  
   从 Ralph 学：把 jobs、queue items、approval requests 做成 Matter 工作台中的统一任务队列。

4. **Doctor Page**  
   从 ProWorkBench 学：把 `/api/health` 的模型、路由、edition、policy、workspace standard 状态展示成律师/IT 都能懂的体检。

5. **Workspace Standard**  
   从 GitAgent/GAP 学：固化 `workspace/lawmind/` 目录契约，避免 workflow、policy、deliverables、memory 越长越散。

### P1：中期增强信任和可复用性

1. **Matter scope middleware**：防跨 matter 读取/写入。
2. **Network allowlist**：web search、connector、MCP 都读 policy。
3. **Hash-chain audit**：给 Firm/Private Deploy 一个更强合规卖点。
4. **Session health score**：让失败、重试、缺 citation、卡住的任务可观测。
5. **Read-only MCP server**：先暴露 LawMind workspace，不做写入工具。
6. **Practice profiles**：补 firm/client/playbook 记忆层。

### P2：长期硬化与生态化

1. 高风险工具沙箱：WASM 或子进程。
2. Source annotation：对齐 OpenContracts 式人工标注。
3. Tracked changes/redline：对齐 Suzie Law 的合同修订交付。
4. DMS/practice-management connector：iManage、NetDocuments、Clio、PracticePanther 等按客户机会推进。
5. SQLite FTS index：用于 audit/session/source 搜索，但不替代文件真相源。

## 十、具体文档与代码落点

| 输出物                  | 建议位置                                                        | 来源参考                        | 说明                                                  |
| ----------------------- | --------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------- |
| Interrupt/resume 契约   | `docs/LAWMIND-INTERRUPT-RESUME.md`                              | LangGraph                       | 状态机、payload、resume command、checkpoint           |
| Workspace 标准          | `docs/LAWMIND-WORKSPACE-STANDARD.md`                            | GitAgent/GAP                    | `workspace/lawmind/` 目录、manifest、rules、workflows |
| 集成路线图增强          | `docs/LAWMIND-INTEGRATIONS.md`                                  | Claude for Legal、OpenContracts | MCP/DMS/practice-management 三阶段                    |
| Workflow Library UI     | `apps/lawmind-desktop/src/renderer/LawmindWorkflowLibrary.tsx`  | Suzie Law                       | 卡片、过滤、启动 workflow                             |
| Approval Queue UI       | `apps/lawmind-desktop/src/renderer/LawmindApprovalQueue.tsx`    | ProWorkBench                    | approve/edit/reject/respond                           |
| Task Board UI           | `apps/lawmind-desktop/src/renderer/matter/MatterTasksPanel.tsx` | Ralph                           | jobs/queue/approvals 聚合                             |
| Tool governance UI      | `apps/lawmind-desktop/src/renderer/LawmindSettingsTools.tsx`    | ProWorkBench                    | 工具来源、权限、角色、批准策略                        |
| Matter scope middleware | `src/lawmind/runtime/tool-pipeline.ts`                          | cLawyer                         | scope 检查                                            |
| Hash-chain audit        | `src/lawmind/audit/`                                            | cLawyer                         | 可选完整性字段                                        |
| Session health          | `src/lawmind/insights/`                                         | AgentActa                       | 纯函数计算，桌面展示                                  |
| Read-only MCP server    | `apps/lawmind-desktop/server/` 或 `scripts/lawmind/`            | OpenContracts                   | 列 matters/sources/drafts                             |

## 十一、借鉴边界

### 应该坚持的 LawMind 判断

1. **交付物比聊天重要**：任何 workflow、agent、connector 都必须最终服务 deliverable、review、audit。
2. **本地优先比 SaaS 扩张重要**：默认 filesystem/export/local API，不因 connector 牺牲数据边界。
3. **法律责任比 autonomous agent 酷炫重要**：危险工具、外发、render、记忆采纳必须可审查。
4. **Markdown/JSON 真相源比隐藏数据库重要**：SQLite/FTS 可做索引，不应成为唯一真相源。
5. **个人律师默认体验优先**：Firm/Private Deploy 能力保留，但默认路径仍应 30 秒出第一个可审核交付物。

### 不应做的事

1. 不要整体迁移到 LangGraph/CrewAI/AutoGen。
2. 不要因为 Suzie Law 的 workflow 数量而堆低质量模板。
3. 不要默认引入 Postgres/Redis/Docker。
4. 不要先做重 DMS 集成再补 LawMind 自己的 approval/task/workflow 产品闭环。
5. 不要让 MCP 写入能力绕过 LawMind 的 review gate 和 audit。

## 十二、最高价值的 10 个可执行事项

| 排名 | 事项                                      | 参考项目                        | 为什么优先                          |
| ---- | ----------------------------------------- | ------------------------------- | ----------------------------------- |
| 1    | 统一 `requiresAction` / interrupt payload | LangGraph、ProWorkBench         | 直接改善澄清、审批、工具执行体验    |
| 2    | Approval Queue UI                         | ProWorkBench                    | 把治理从底层策略变成用户可理解产品  |
| 3    | Workflow Library                          | Suzie Law、Claude for Legal     | 直接提升“律师看到就会用”的转化      |
| 4    | Matter Task Board                         | Ralph                           | 把 LawMind 从 chat 拉向生产系统     |
| 5    | Workspace Standard                        | GitAgent/GAP                    | 降低后续 workflow/spec/policy 混乱  |
| 6    | Matter scope middleware                   | cLawyer                         | 法律场景核心安全边界                |
| 7    | Doctor Page                               | ProWorkBench                    | 降低安装、模型、policy 配置失败成本 |
| 8    | Session Health Score                      | AgentActa                       | 让失败任务和低质量执行可发现        |
| 9    | Read-only MCP server                      | OpenContracts、Claude for Legal | 低风险打开生态入口                  |
| 10   | Hash-chain audit                          | cLawyer                         | Firm/Private Deploy 的强信任卖点    |

## 十三、结论

LawMind 目前最不缺的是“再接一个 agent 框架”，最缺的是把已有的工程骨架产品化、标准化、可观察化。

短期应优先借鉴 **ProWorkBench 的批准队列、Ralph 的任务队列、Suzie Law 的 workflow library、LangGraph 的 interrupt/resume 语义、GitAgent 的 workspace 标准**。这些都能直接服务 LawMind 的核心主张：不是更会聊天，而是更像一个可交付、可审查、可治理的法律生产系统。

中长期再吸收 **cLawyer 的安全硬化、OpenContracts 的 annotation/MCP、AgentActa 的审计索引、Claude for Legal 的 connector catalog**。这些能力适合在 LawMind 的交付闭环稳定之后，作为 Firm/Private Deploy 的可信度与生态扩展层。

## 十四、Claude Code 专项借鉴（2026）

基于公开源码与分析文档的 LawMind 对照手册（含 UI、memory、compact、权限、实施矩阵）：

| 文档                                                                                           | 来源链接                                                                    | 侧重                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| [LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md](./LAWMIND-CLAUDE-CODE-ANALYSIS-REPO-LESSONS.md) | [liuup/claude-code-analysis](https://github.com/liuup/claude-code-analysis) | 分析文档章节目录 → 架构/安全/UI 产品映射 |
| [LAWMIND-CLAUDE-CODE-SOURCE-REPO-LESSONS.md](./LAWMIND-CLAUDE-CODE-SOURCE-REPO-LESSONS.md)     | [maikebing/claude-code（Gitee）](https://gitee.com/maikebing/claude-code)   | 源码目录体量、常量、文件级 PR 规格与验收 |
