# LawMind 优化建议与远景 backlog

> **状态**：规划文档；**核心 P0/P1 产品断点已于 2026-07-12 落地**（见附录 A）。**P2 工程债进行中**（orchestrator 拆分、文档同步、覆盖率等）。后续 agent 先读本文与 [LAWMIND-ENGINEERING-REVIEW](LAWMIND-ENGINEERING-REVIEW.md)，再按未完成项开任务。  
> **创建**：2026-07-12  
> **关联文档**：[LAWMIND-VISION](LAWMIND-VISION.md)、[LAWMIND-2.0-STRATEGY](LAWMIND-2.0-STRATEGY.md)、[LAWMIND-ARCHITECTURE](LAWMIND-ARCHITECTURE.md)、[LAWMIND-REFERENCE-PROJECT-LESSONS](LAWMIND-REFERENCE-PROJECT-LESSONS.md)、[LAWMIND-INTEGRATIONS](LAWMIND-INTEGRATIONS.md)、[LAWMIND-EXCELLENCE-ROADMAP](LAWMIND-EXCELLENCE-ROADMAP.md)

---

## 0. 给后续 Agent 的读法

1. 先读 **§1 产品远景**（用户口述的北极星，高于竞品模仿）。
2. 再读 **§2–§3** 了解行业方向与现状差距（用于论证，不要跑偏去做「又一个法律 ChatGPT」）。
3. 落地时按 **§4 优先级** 拆工程任务；每项应对齐 §1 的某一条能力，而不是堆功能。
4. 实现须保持 LawMind 既有默认值：本地优先、澄清→执行→交付→审核→审计、交付物可验收。
5. **不要**在未获用户明确指示时开始写代码；本文是 backlog，不是当前 sprint。

---

## 1. 产品远景（用户定义 · 最高优先级）

### 1.1 一句话

**律师是团队领导；LawMind 是可派活、会协作、能进化的数字小团队。**  
目标是让一位超强律师，用 LawMind 完成过去「超强律师 + 多名团队成员」才能完成的全部工作。

### 1.2 团队隐喻（必须贯穿产品与工程）

| 真实团队                    | LawMind 对应                                               |
| --------------------------- | ---------------------------------------------------------- |
| 律师 = 领导                 | 人类律师：下派任务、审批、最终责任                         |
| 助理 / 研究员 / 文书 / 质控 | 多个 **named agent / role**：各有目标、工具边界、风险阈值  |
| 组会、互审、交接            | Agent **互相咨询、委派、请求复核**；过程可看见、可审计     |
| 带教与反馈                  | 律师审核与口头偏好 → 写回各 agent 的成长记忆               |
| 个人越做越专                | Agent 按细分方向（合同 / 诉讼 / 合规 / 证据…）**特化进化** |
| 所内知识沉淀                | 办案材料整理 + 工作经历 → **律师个人 / 事项知识库**        |

### 1.3 能力分层

**A. 核心远景（数字团队）**

1. **下派**：律师用自然语言或工作流模板把任务派给指定 agent / 角色组合。
2. **协作**：多 agent 在同一 matter 下分工、交流、合并成果；不是单聊黑盒。
3. **进化**：根据任务执行经验 + 律师反馈习惯，更新角色 profile / playbook；越来越像「这位律师带出来的人」。
4. **特化**：长期使用后，某 agent 成为某一细分方向的强手（可度量：首过通过率、改写率、偏好命中）。
5. **领导可见**：律师随时看到谁在做什么、卡在哪、需要拍板什么（批准队列 + 协作时间线）。

**B. 基础能力（支撑团队干活）**

6. **材料整理**：证据、卷宗、往来文件 ingest → 索引、时间线、证据清单。
7. **案件整理**：matter 工作台 = 一案一台（事实、争点、策略、截止日、交付物）。
8. **知识沉淀**：办案经历、优质草稿、审核意见 → 个人知识库 / 条款 playbook / golden examples（Markdown 真相源 + 派生索引）。

**C. 信任底座（律师敢用）**

9. 高风险输出必须经律师门禁；来源可核对；全程审计。
10. 本地优先；密钥与案件材料默认不上传第三方 SaaS（除非律师显式开启）。

### 1.4 明确「不是什么」

- 不是通用法律 ChatGPT / 通义法睿式问答产品。
- 不是仅合同 Word 插件（Spellbook 路径可借鉴，但不是主形态）。
- 不是无人值守全自动律师；**律师永远是领导与责任人**。
- 不以「workflow 数量竞赛」或「复制 Harvey 企业栈」为成功标准。

### 1.5 成功画面（验收叙事）

一位资深律师打开 LawMind：

1. 指定 matter，对「团队」说：「这份供应商协议按我的审查口径出意见，争议条款让合同组先出初稿，诉讼组看一下争议解决条款风险。」
2. 多个 agent 分工检索、出 issue tree、互审、合并；律师在批准队列里只处理需拍板项。
3. 律师改了两处语气与风险表述 → 系统写入该律师偏好与合同 agent 的学习记忆。
4. 半年后，同一类任务首过通过率明显上升；材料与案件整理自动进个人知识库，可被后续事项检索。

---

## 2. 同类工具与行业发展方向（调研摘要 · 2026）

### 2.1 竞品与参照（精简）

| 类型         | 代表                                                                                                     | 可借鉴点                                                           | LawMind 错位                      |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| 企业法律平台 | Harvey、CoCounsel、Legora                                                                                | Matter 工作区、Agent 规划执行、审查表、统一入口                    | 本地审计闭环，非云端企业全栈      |
| 编辑器内嵌   | Spellbook                                                                                                | Word 红线、Playbook                                                | 交付可导出 TC，主场仍是团队工作台 |
| 中国法律 AI  | 通义法睿、吾律、MetaLaw、智律云、法索                                                                    | 法规/类案库、垂直场景、一案一台                                    | 多 agent 团队 + 进化 + 知识沉淀   |
| 开源         | OpenContracts、LegalGraphRAG、anylegal-oss、legal-skills-open、cLawyer、Suzie Law、aiworkdeck、legalwork | 引用图、GraphRAG、SKILL.md、沙箱审计、workflow library、本地 agent | 吸收模式，不换产品形态            |

仓库内更细的工程借鉴清单见 [LAWMIND-REFERENCE-PROJECT-LESSONS](LAWMIND-REFERENCE-PROJECT-LESSONS.md)。

### 2.2 技术方向

1. **Chat → Agentic Workflow**（计划→执行→律师门禁）— LawMind 管线已对齐。
2. **权威数据 + 引用校验** — 当前最大信任缺口。
3. **多模型编排 + 结构化推理层**（issue tree / argument matrix）— 已有快照，需对律师可见、可编辑。
4. **SKILL.md + MCP 技能生态** — workflow 可兼容技能包格式。
5. **本地/私有 + matter 隔离 + 审计完整性** — 主战场。
6. **质量飞轮**（审核标签 → profile / playbook）— **直接服务 §1「进化」**。

### 2.3 UI / 产品形态方向

1. Matter Workspace 中心（一案一台）。
2. 统一入口 + 智能路由（少切视图）。
3. **审查矩阵 / Review Table**（行=材料，列=问题）。
4. 来源侧栏可点回原文。
5. **Workflow Library**（可浏览、可搜索的任务模板库）。
6. Word 红线 / 办公轻量衔接。
7. **批准队列产品化**（领导看团队卡点）。
8. 冷启动画像面试（律师偏好冷启动）。

---

## 3. 现状对照（相对 §1 远景）

### 3.1 已具备、应对齐强化

| 能力                   | 现状线索                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| 多角色 / 委派          | `delegate_task`、`consult_assistant`、`request_review`、role 系统 |
| 工作流模板             | `workspace/lawmind/workflows/*.json`（约 13+）                    |
| 澄清 / 审核 / 验收门禁 | clarification / review / acceptance gates                         |
| 结构化推理             | `*.reasoning.json`（issueTree、argumentMatrix）                   |
| 本地审计               | `audit/*.jsonl`；hash-chain 等见路线图                            |
| 记忆真相源             | `MEMORY.md`、`LAWYER_PROFILE.md`、`cases/*/CASE.md`               |
| Word TC 导出           | 审核台 render-tracked                                             |

### 3.2 相对远景的主要缺口

| 缺口                                  | 为何伤远景                             |
| ------------------------------------- | -------------------------------------- |
| Agent 协作「像开会」的产品面不足      | 领导看不见团队怎么分工与互审           |
| 进化飞轮未产品化                      | 审核反馈未稳定写回各 agent profile     |
| 特化路径不清晰                        | 缺少「该角色在某业务方向的成长指标」   |
| 权威法规/类案检索弱                   | 团队「研究员」不可靠，领导不敢放手     |
| 个人知识库检索弱                      | 经历沉淀了但不好用（启发式搜易假命中） |
| Workflow Library / 批准队列不够像产品 | 下派与拍板体验不像管团队               |
| 材料/案件整理体验未打磨成日常默认     | 基础能力未成为肌肉记忆                 |

---

## 4. 优化 backlog（按优先级 · 对齐远景）

> 每条格式：目标 → 对齐远景哪条 → 建议落点 / 验收 → 参考。  
> **P0 / P1 核心项已落地一批**（附录 A）；§4 正文仍列全量 backlog 供对照。**P2 工程项进行中**，未勾选项待后续迭代。

### P0 — 让「领导」敢派活、团队可信

#### P0-1 权威检索适配层（研究员可靠）

- **目标**：法条/类案先真源检索，再 LLM 归纳；无源则显式「缺源」，禁止编造。
- **对齐**：§1.3 A 协作可信；§1.3 C 信任。
- **落点建议**：`src/lawmind/retrieval/`、`search_statute` / `search_case_law` 工具；政策门控 web 源。
- **验收**：针对已知法条查询，命中真实条文或明确 missing；不再用无关 memory 片段冒充法条。
- **参考**：Lexis 引用校验、OpenContracts citation graph、国内法规库 / 公开接口。

#### P0-2 引用一等公民 UI

- **目标**：草稿每段可点回原文；无 `sourceId` 标「未锚定」。
- **对齐**：§1.3 C；领导抽查团队产出。
- **落点**：`ReviewWorkbench`、source preview API、段落级 anchor。
- **参考**：Harvey citations、LexReviewer bbox。

#### P0-3 团队协作可视（领导驾驶舱）

- **目标**：一次任务中展示：谁接单、谁咨询谁、互审结论、当前阻塞；支持律师中途改派。
- **对齐**：§1.2 组会隐喻；§1.3 A-2/A-5。
- **落点**：Matter / AgentFleet / live trace 合并为「团队执行视图」；协作事件进 audit。
- **验收**：律师不读聊天全文也能回答「现在卡在哪、该谁拍板」。

#### P0-4 批准队列独立视图

- **目标**：所有 `requiresAction` / 审核门禁收成「待领导处理」列表。
- **对齐**：§1.3 A-5。
- **落点**：桌面新视图或 Matter Tab；与 ReviewWorkbench 打通。
- **参考**：ProWorkBench approvals。

#### P0-5 Workflow Library 产品化（下派入口）

- **目标**：卡片库按业务领域 / 交付物 / 风险 / 角色过滤；一键派给角色组合并绑定验收包。
- **对齐**：§1.3 A-1。
- **落点**：`LawmindWorkflowLibrary` UI；workflow schema 强化 `deliverableType`、`acceptancePackRequired`、默认角色。
- **参考**：Suzie Law、Claude for Legal plugins。

---

### P1 — 让团队「越用越像你的人」

> **执行拆解（2026-07-21）**：成长可见 / 反馈闭环 / 分工常态化 / 领导视图 → 见 [LAWMIND-TEAM-GROWTH-PLAN.md](LAWMIND-TEAM-GROWTH-PLAN.md)（详细规格：分方向记忆层、API、Wave A–D DoD、Demo；复用 adoption、specialization、fleet、workflow、peerReview）。

#### P1-1 进化飞轮（经验 + 律师反馈）

- **目标**：审核标签（语气过强/弱、缺引用、争点遗漏、风险校准等）→ 写回 `LAWYER_PROFILE.md` + 对应 agent `PROFILE.md` + 条款 playbook；优质稿晋升 golden examples。
- **对齐**：§1.3 A-3/A-4；§1.3 B-8。
- **落点**：review 事件 schema、write-back 规则、[LAWMIND-2.0-STRATEGY §4.3](LAWMIND-2.0-STRATEGY.md)。
- **验收**：同类任务二次执行时，可指出「已应用某次审核偏好」；改写率可统计下降。

#### P1-2 Agent 特化轨迹

- **目标**：每个 named agent 有方向标签（合同审查 / 诉讼策略 / 证据编目…）与成长指标（首过通过率、偏好命中、平均改写幅度）。
- **对齐**：§1.3 A-4。
- **落点**：`workspace/lawmind/agents/*.md` 元数据；桌面 Agent 详情页「专长与成长」。
- **验收**：律师能指定「这类活永远先派给合同组小吕」。

#### P1-3 协作协议硬化（像真实交接）

- **目标**：委派/咨询/复核有结构化交接单（目标、已完成、未决问题、附件来源 ID），避免只丢一段聊天。
- **对齐**：§1.3 A-2。
- **落点**：`src/lawmind/agent/collaboration/`；handoff 对象入库并可在 UI 展开。

#### P1-4 Matter 工作台 = 一案一台

- **目标**：时间线 + 文档索引 + 审查矩阵 + 任务/团队状态同页。
- **对齐**：§1.3 B-6/B-7。
- **参考**：法索「一案一台」、Harvey Vault + Review Tables。

#### P1-5 个人知识库检索（经历可复用）

- **目标**：对 `cases/`、`memory/`、已批准草稿做 hybrid（BM25 + embedding）检索；Markdown 仍为真相源。
- **对齐**：§1.3 B-8。
- **验收**：搜「未成年人保护法」不再误命中无关日志；能召回律师自己办过的同类争点。

#### P1-6 冷启动画像面试

- **目标**：首跑 5–8 问写入律师偏好（风险、语气、常用领域、交付格式）。
- **对齐**：§1.3 A-3 冷启动。
- **参考**：Claude for Legal cold-start interview。

#### P1-7 SKILL.md / 技能包兼容

- **目标**：workflow ↔ Anthropic SKILL 格式可映射；导入外部技能时仍强制走 LawMind 验收与审计。
- **对齐**：扩展团队「会办的事」而不变成插件菜市场。
- **参考**：anylegal-oss、legal-skills-open、Claude for Legal。

#### P1-8 Word 路径加深（交付习惯）

- **目标**：审核台 Accept/Reject 红线卡片 → 导出 TC；可选轻量「用本机 Word/WPS 打开当前草稿」。
- **对齐**：§1.3 B 交付；不把产品做成纯插件。

---

### P2 — 飞轮可测、基础能力扎实、商业边界清晰

#### P2-1 质量门禁与 benchmark

- 固定任务包（合同审查、律师函、合规 memo…）；指标：首过通过率、引用有效率、争点覆盖、角色保真度。
- **对齐**：证明「进化」与「特化」不是感觉。

#### P2-2 材料整理默认路径

- 拖入卷宗 → 自动证据索引 / 时间线 / OCR；律师一键确认进 matter 知识库。
- **对齐**：§1.3 B-6。

#### P2-3 中国个人律师集成优先级

- 先：本地文件夹、邮件/导出整理、电子签外链；DMS（iManage 等）留给 Firm。
- **对齐**：个人领导场景，不为企业连接器牺牲核心。

#### P2-4 可观测性集中

- 单任务：trace + audit + token/cost + 各 agent 耗时；便于领导与支持排障。

#### P2-5 安全硬化（可选加深）

- matter 硬隔离、网络 allowlist、高风险工具隔离；见 cLawyer 借鉴项。
- **对齐**：§1.3 C。

---

## 5. 建议的实现分期（仅规划，待启动）

| 阶段   | 主题           | 建议包含                    |
| ------ | -------------- | --------------------------- |
| **T0** | 领导驾驶舱     | P0-3、P0-4、P0-5            |
| **T1** | 研究员可信     | P0-1、P0-2                  |
| **T2** | 进化与特化     | P1-1、P1-2、P1-3            |
| **T3** | 知识与案件肌体 | P1-4、P1-5、P1-6、P2-2      |
| **T4** | 生态与可测     | P1-7、P1-8、P2-1、P2-3–P2-5 |

远景验收口号（对外可改，对内不变）：

> **一个超强律师 + LawMind 数字团队 = 过去一个超强律师带一整组人。**  
> 团队会协作、会交接、会按你的反馈进化，并把办案经历沉成你的知识库。

---

## 6. 文档维护

- 用户更新远景或优先级时，**先改 §1 与 §4**，再改 2.0 / Excellence 路线图中的对应勾选。
- 某 P0/P1 项开始实现时：在本节或工程 issue 标注「进行中」，并链到 PR；完成后在本文件勾选或移到「已落地」附录。
- 与 [LAWMIND-2.0-STRATEGY](LAWMIND-2.0-STRATEGY.md) 冲突时：**以本文 §1 用户远景为准**，2.0 文档作技术展开。

---

## 附录 A. 已落地对照

| 项                           | 落地日期   | PR / 说明                                                                                                                                              |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skills S0–S6 MVP 闸门切片    | 2026-07-20 | 见 `LAWMIND-AGENT-SKILLS-500PW-PLAN.md` §9.1；遗留：**字面 500 人周精修**（PDF 版式、LLM 真并行、全量 a11y、Storybook、Firm Ops 全密度、技能远程市场） |
| P0-3 团队协作可视 / 指挥台   | 2026-07-12 | Header+MainBody+CSS+spawn；见 ENGINEERING-REVIEW                                                                                                       |
| P0-4 批准队列                | 2026-07-12 | Action Hub 队列 Tab 嵌入 LawmindApprovalQueue                                                                                                          |
| P0-1 无源拒答（工作区）      | 2026-07-12 | search_statute/case_law `refusalRequired`；外接权威库仍待                                                                                              |
| P0-2 未锚定引用              | 2026-07-12 | citation-integrity unanchoredSections + banner                                                                                                         |
| P1-1 进化飞轮                | 2026-07-12 | 双队列同步 + agent-specialization 指标                                                                                                                 |
| P1-2 特化轨迹                | 2026-07-12 | `learning/agent-specialization.ts`                                                                                                                     |
| P0-5 Workflow Library        | 既有       | LawmindWorkflowLibrary 已存在；指挥台可跳转                                                                                                            |
| 权威法规库适配               | 未完       | 需外接 API；当前为启发式+拒答                                                                                                                          |
| 易上手+交付可靠包（T0 切片） | 2026-07-23 | 先计划默认 / 首跑捷径；必核落盘+导出闸；`deliverable-readiness` 一览；见 CHANGELOG Unreleased                                                          |
| 易上手+交付可靠 · 第三波     | 2026-07-23 | 在办通过后导出条；Plan 交接会话持久化 + Compose 填入条；见 `LAWMIND-SIMPLE-RELIABLE-PLAN.md` §4                                                        |
| 易上手+交付可靠 · 第四波     | 2026-07-23 | Plan→`session.json` API；导出后「用 Word 打开」；见 `LAWMIND-SIMPLE-RELIABLE-PLAN.md` §6                                                               |
