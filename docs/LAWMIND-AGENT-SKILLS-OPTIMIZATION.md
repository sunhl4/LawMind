# LawMind ← Agent Skills 生态调研与产品力优化路线

> **状态**：持续更新的规划与对照文档（不是当前 sprint 的强制执行清单）。  
> **创建**：2026-07-20  
> **原则**：以**产品力**为第一目标；允许大改架构与交互，但默认值不变——本地优先、澄清→执行→交付→审核→审计、交付物可验收、律师最终责任。  
> **关联**：[LAWMIND-VISION](LAWMIND-VISION.md) · [LAWMIND-2.0-STRATEGY](LAWMIND-2.0-STRATEGY.md) · [LAWMIND-OPTIMIZATION-BACKLOG](LAWMIND-OPTIMIZATION-BACKLOG.md) · [LAWMIND-ARCHITECTURE](LAWMIND-ARCHITECTURE.md) · [LAWMIND-DELIVERABLE-FIRST](LAWMIND-DELIVERABLE-FIRST.md) · [LAWMIND-LAWYER-AUTOMATIONS](LAWMIND-LAWYER-AUTOMATIONS.md) · [GOALS.md](../GOALS.md)  
> **详细工作计划（含 UI 前后图）**：[LAWMIND-AGENT-SKILLS-EPIC-PLANS.md](LAWMIND-AGENT-SKILLS-EPIC-PLANS.md)

---

## 0. 文档用途与维护方式

### 0.1 用途

1. **索引**：GitHub 上法律向 / 工程向 Agent Skills 的高频源与代表性 skill。
2. **对照**：每个 skill 的「任务流程思想」如何映射到 LawMind 模块。
3. **决策**：在产品力优先前提下，给出可大改的优化与改进建议（含分期与验收标准）。
4. **执行入口**：后续 agent / 工程师从本文拆任务前，先读 §1 产品立场与 §4 优先矩阵。

### 0.2 如何持续更新

| 何时更新              | 改哪里                                  |
| --------------------- | --------------------------------------- |
| 发现新仓库 / 星标变化 | §2 源仓库表（补 stars、日期、备注）     |
| 新增可借鉴 skill      | §3 对应业务域表（保持编号或追加）       |
| 某项落地完成          | §5 路线图勾选 + 附录 A「已落地」        |
| 否决某条大改          | §6 决策日志：日期 / 否决理由 / 替代方案 |
| 竞品或内部试点反馈    | §4.3 产品差距表「证据」列               |

**元数据约定**：每次实质修订在文首或附录 B 追加一行：`YYYY-MM-DD · 摘要 · 作者`。

### 0.3 给后续 Agent 的读法

1. 先读 **§1**（产品立场高于「抄 skill」）。
2. 需要灵感时翻 **§3**；需要排期时看 **§4–§5**。
3. 落地须对齐 LawMind 默认值；不要把产品做成「又一个法律 ChatGPT」。
4. **不要**在未获用户明确指示时直接按本文开大改 PR；本文是产品与工程记忆。

---

## 1. 产品立场（不可妥协）

### 1.1 北极星（与愿景一致）

LawMind 是**面向个人律师的任务型工作台**：按指令执行直至**可交付、可验收、可审计**的成果；合同是高价值子集，不是产品边界。律师是领导；系统是可派活、会协作、能进化的数字小团队（见 [OPTIMIZATION-BACKLOG §1](LAWMIND-OPTIMIZATION-BACKLOG.md)）。

### 1.2 从 Skills 生态学什么、不学什么

| 学                                                                                   | 不学                                |
| ------------------------------------------------------------------------------------ | ----------------------------------- |
| **任务流程结构**：Required Inputs → Workflow → Output Format → Attorney Verification | 把 skill 全文当法律意见直接交付客户 |
| **分流与门禁**：triage 色标、澄清闸、出稿前硬检                                      | 无审计的「一键全自动发件」          |
| **并行专业角色再聚合**：Clause / Risk / Compliance / Citation 等                     | 黑盒多 agent 互相改稿、律师看不见   |
| **原子能力可组合**：检索→要素→争点→演绎→文书                                         | 一个巨大 prompt 包打天下            |
| **Matter 运营方法论**（LPM）：intake / plan / scope change / RAID                    | 把 LawMind 做成律所计费 SaaS 优先   |
| **引用锁定与效力校验**                                                               | 依赖模型记忆编造法条案例            |
| **技能包安全审计**                                                                   | 远程无签名 skill 市场随意执行       |

### 1.3 产品力定义（本文排期的打分尺）

一项改动「值不值得大改」，按下列分数排序（同分看律师日活路径）：

1. **首过可交件率**：律师少改几轮就能签字/导出。
2. **信任成本**：来源可点开、门禁清晰、越权可审计。
3. **派活效率**：自然语言 / 自动化 / Fleet 能准确落到正确工作流。
4. **Matter 连贯性**：一案一台，跨会话不丢策略与期限。
5. **进化可感**：审核偏好与修订真正回流，下次明显更「像这位律师」。
6. **可售卖叙事**：Solo / Firm / Private 能力边界可讲清。

---

## 2. 源仓库索引（高频关注 · 持续维护）

> Stars 为 2026-07-20 前后快照；更新时改「观测日」列。

|          Stars | 仓库                                                                                          | 类型                                        | 规模 / 备注                          | 观测日     |
| -------------: | --------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ | ---------- |
|          ~163k | [anthropics/skills](https://github.com/anthropics/skills)                                     | 官方 Agent Skills 标准 + docx/pdf/pptx/xlsx | 交付物与 skill-creator 基准          | 2026-07-20 |
|           ~79k | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)                         | 生产级工程 skills                           | 引擎/桌面质量门禁可借鉴              | 2026-07-20 |
|           ~28k | [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)           | 总索引 1000+                                | 发现入口                             | 2026-07-20 |
|           ~28k | [topoteretes/cognee](https://github.com/topoteretes/cognee)                                   | Agent 长期记忆 / 知识图                     | Memory 增强方向                      | 2026-07-20 |
|           ~24k | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files)             | 磁盘持久计划 + 完成门禁                     | 对标 executionPlan / Job             | 2026-07-20 |
|          ~1.6k | [zubair-trabzada/ai-legal-claude](https://github.com/zubair-trabzada/ai-legal-claude)         | 合同审查旗舰包                              | 14 skills + 5 并行 agents + PDF 报告 | 2026-07-20 |
|           ~585 | [lawve-ai/awesome-legal-skills](https://github.com/lawve-ai/awesome-legal-skills)             | 法律 skill 精选索引                         | **139** 条分类浏览                   | 2026-07-20 |
|           ~552 | [THUYRan/Legal-Skills-Chinese](https://github.com/THUYRan/Legal-Skills-Chinese)               | 中文法律推理原子库                          | **38**（36 原子 + 2 复合编排）       | 2026-07-20 |
|           ~482 | [cat-xierluo/legal-skills](https://github.com/cat-xierluo/legal-skills)                       | 中文法律实务工具链                          | ~50（含 OCR/检索/多 agent）          | 2026-07-20 |
|           ~148 | [zh-xx/legal-assistant-skills](https://github.com/zh-xx/legal-assistant-skills)               | 合同/合规/架构                              | 8                                    | 2026-07-20 |
|           ~116 | [w95/awesome-claude-corporate-skills](https://github.com/w95/awesome-claude-corporate-skills) | 企业角色包（含 legal）                      | 166                                  | 2026-07-20 |
|            ~52 | [legalopsconsulting/lpm-skills](https://github.com/legalopsconsulting/lpm-skills)             | Legal Project Management                    | **16** 运营技能（Apache-2.0）        | 2026-07-20 |
|            ~48 | [sboghossian/master-claude-for-legal](https://github.com/sboghossian/master-claude-for-legal) | Anthropic Legal Teams 落地                  | 模板 + 起步技能                      | 2026-07-20 |
|            ~45 | [pa1nrui1/legal-skills](https://github.com/pa1nrui1/legal-skills)                             | 中国法务全流程                              | **59**（刑辩/劳动/破产等）           | 2026-07-20 |
|            ~44 | [NEU-ZHA/legal-ai-skills](https://github.com/NEU-ZHA/legal-ai-skills)                         | 北大法宝 MCP + 引用/DOCX                    | 28                                   | 2026-07-20 |
|            ~42 | [LegalQuants/lq-skills](https://github.com/LegalQuants/lq-skills)                             | 多法域律师共建                              | 17+ 法域                             | 2026-07-20 |
|            ~42 | [bstevescherer/heycounsel-community](https://github.com/bstevescherer/heycounsel-community)   | 律师社区技能                                | vault / matter-journal / privilege   | 2026-07-20 |
|            ~41 | [skala-io/legal-skills](https://github.com/skala-io/legal-skills)                             | 创业/融资合同审查                           | SAFE/term sheet 等 11                | 2026-07-20 |
|            ~32 | [ThomasMoreAI/legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open)           | 法域×插件 MCP 库                            | 宣称 3500+ / 39 法域                 | 2026-07-20 |
|            ~23 | [harvard-lil/lawskills-hub](https://github.com/harvard-lil/lawskills-hub)                     | 法律教育 skills                             | 教学法参考                           | 2026-07-20 |
| ~14 / **207+** | [zgbrenner/agentcounsel](https://github.com/zgbrenner/agentcounsel)                           | 最完整「律师可审阅」工作流库                | 统一元数据 + WORKFLOW_ROUTER         | 2026-07-20 |

**AgentCounsel 业务域分布（skills/ 下，约 212 条）**：setup 20 · securities 13 · bankruptcy / family / insurance / M&A / trusts 各 12 · litigation / methodology 各 11 · antitrust / employment / privacy / real-estate / tax 各 10 · 以及 corporate / IP / research / contracts / legal-ops / AI governance 等。

**推荐精读顺序**

1. lawve-ai/awesome-legal-skills — 分类总览最快
2. THUYRan/Legal-Skills-Chinese — 与 Reasoning / 中文实务最贴
3. zubair-trabzada/ai-legal-claude — 合同审查产品形态（并行 + 打分 + 报告）
4. legalopsconsulting/lpm-skills — Matter 运营
5. zgbrenner/agentcounsel — `Purpose / Inputs / Workflow / Output / Attorney Verification` 元数据标准
6. anthropics/skills + planning-with-files — 交付物与持久计划门禁

---

## 3. 代表性 Skill 全表（约 95 条 · 按业务域）

> 编号供对照引用（如「采纳 skill #46」）。新增 skill 从 96 起追加，勿重排旧号。

### 3.A 合同审查 / 谈判 / 生成

|   # | Skill                                    | 来源                        | 流程思想（摘要）              |
| --: | ---------------------------------------- | --------------------------- | ----------------------------- |
|   1 | `contract-review` / `legal-review`       | Anthropic / ai-legal-claude | Playbook 偏离 → 红线 → 安全分 |
|   2 | `nda-triage`                             | Anthropic / lawve           | GREEN / YELLOW / RED 分流     |
|   3 | `nda-review`                             | AgentCounsel / Jamie Tso    | 立场分边 + issue log          |
|   4 | `contract-risk-analyzer`                 | lawve                       | 五关键条款风险矩阵            |
|   5 | `legal-risks`                            | ai-legal-claude             | 严重度 + 财务敞口             |
|   6 | `legal-compare`                          | ai-legal-claude             | 版本 diff → 危险变更          |
|   7 | `legal-negotiate`                        | ai-legal-claude             | 逐条反建议 + 替换文本         |
|   8 | `legal-missing`                          | ai-legal-claude             | 应有却缺失的保护条款          |
|   9 | `legal-plain`                            | ai-legal-claude             | 条款白话层                    |
|  10 | `redline-summary`                        | AgentCounsel                | 红线摘要交付物                |
|  11 | `sow-review` / `vendor-agreement-status` | AgentCounsel                | SOW / 供应商协议状态机        |
|  12 | `tech-contract-review` / `negotiation`   | lawve                       | 技术服务合同谈判剧本          |
|  13 | `合同审查` / `合同起草`                  | pa1nrui1                    | 中国法合同流程                |
|  14 | `contract-copilot`                       | cat-xierluo                 | 中文合同副驾驶交互            |
|  15 | `pkulaw-mcp-contract-review-lite`        | NEU-ZHA                     | 检索接地 + 轻量审查           |
|  16 | `pkulaw-mcp-batch-contract-screening`    | NEU-ZHA                     | 批量合同筛选流水线            |
|  17 | `climate-aligned-contracts`              | TCLP / lawve                | 条款方法论模板化              |
|  18 | `victor-wang-yc-saas-drafter`            | lawve                       | 标准模板起步 → 定制           |

### 3.B 检索 / 引用 / 事实锚定

|   # | Skill                                          | 来源                 | 流程思想（摘要）          |
| --: | ---------------------------------------------- | -------------------- | ------------------------- |
|  19 | `case-retrieval`                               | Legal-Skills-Chinese | 类案检索方法论（不绑库）  |
|  20 | `legal-article-retrieval`                      | Legal-Skills-Chinese | 法条检索报告 + 效力复核   |
|  21 | `legal-norm-validity-check`                    | Legal-Skills-Chinese | 现行有效 / 层级冲突闸门   |
|  22 | `pkulaw-mcp-citation-validator`                | NEU-ZHA              | 引用校验自动化            |
|  23 | `pkulaw-mcp-grounded-answer`                   | NEU-ZHA              | 强制 grounded 回答        |
|  24 | `legal-citation-automator` / `comprehensive`   | NEU-ZHA              | 引用自动化 + TOA          |
|  25 | `source-locked-verification`                   | lawve                | 仅允许用户材料 / 已访问源 |
|  26 | `mandatory-verification`                       | lawve                | 非平凡事实强制外验        |
|  27 | `legal-fact-checker`                           | NEU-ZHA              | 事实核查关卡              |
|  28 | `red-team-verifier`                            | lawve                | 对抗式核验 AI 法律输出    |
|  29 | `yuandian-law-search` / `zhihe-legal-research` | cat-xierluo          | 中文法律检索工具链        |
|  30 | `法规案例检索`                                 | pa1nrui1             | 中国法检索工作流          |
|  31 | `multi-jurisdictional-research`                | lawve                | 多法域结构化比较          |

### 3.C 法律推理原子能力

|   # | Skill                            | 来源                 | 流程思想（摘要）         |
| --: | -------------------------------- | -------------------- | ------------------------ |
|  32 | `legal-element-extraction`       | Legal-Skills-Chinese | 生活语言 → 法律事实      |
|  33 | `structured-element-extraction`  | Legal-Skills-Chinese | 推理前质量闸门           |
|  34 | `dispute-issue-identification`   | Legal-Skills-Chinese | 争议焦点提取             |
|  35 | `evidence-evaluation`            | Legal-Skills-Chinese | 证据三性 + 证明力        |
|  36 | `deductive-reasoning` (P-F-C)    | Legal-Skills-Chinese | 可检验三段论链           |
|  37 | `conflict-resolution`            | Legal-Skills-Chinese | 法条竞合 / 证据矛盾枢纽  |
|  38 | `argument-chain-construction`    | Legal-Skills-Chinese | 论证组织                 |
|  39 | `argument-strength-evaluation`   | Legal-Skills-Chinese | 自检置信度               |
|  40 | `strategic-risk-prioritization`  | Legal-Skills-Chinese | 风险优先级排序           |
|  41 | `legal-judgment-prediction` ✦    | Legal-Skills-Chinese | 复合编排：调度多原子能力 |
|  42 | `judgment-document-generation` ✦ | Legal-Skills-Chinese | 端到端文书编排主线       |
|  43 | `legal-risk-assessment`          | Anthropic / Chinese  | 严重度×可能性 + 升级     |
|  44 | `judicial-first-impression`      | lawve                | 「法官冷读」对抗审稿     |
|  45 | `opposing-counsel-review`        | lawve                | 对方律师视角攻击论证     |

### 3.D Matter / LPM / 期限 / 审批

|   # | Skill                                      | 来源                   | 流程思想（摘要）            |
| --: | ------------------------------------------ | ---------------------- | --------------------------- |
|  46 | `matter-intake-scoping`                    | LPM / lawve            | 非结构化 → brief + baseline |
|  47 | `matter-plan-builder`                      | LPM                    | scope → phases / owners     |
|  48 | `timeline-generator`                       | LPM                    | 依赖网 + 关键路径 + what-if |
|  49 | `scope-change-controller`                  | LPM                    | 范围变更控制（OOS）         |
|  50 | `risk-and-issues-manager`                  | LPM                    | RAID + 从邮件提取决策       |
|  51 | `document-approval-tracker`                | LPM                    | 多干系人审批瀑布            |
|  52 | `status-report-drafter`                    | LPM                    | 邮件/纪要 → RAG 状态报告    |
|  53 | `daily-briefing`                           | LPM                    | 组合盘早报（可定时）        |
|  54 | `matter-drill-down`                        | LPM                    | 单案运营视图（决策优先）    |
|  55 | `continuous-improvement-engine`            | LPM                    | 结案复盘 → 流程更新提案     |
|  56 | `litigation-deadline-calendar`             | lawve                  | 排期令 → 期限日历           |
|  57 | `trial-scheduling-and-deadline-monitoring` | Legal-Skills-Chinese   | 法定期限监控                |
|  58 | `case-lifecycle-planning`                  | Legal-Skills-Chinese   | 诉讼路线图                  |
|  59 | `new-case` / `立案管理` / `结案归档`       | cat-xierluo / pa1nrui1 | 案件生命周期状态机          |
|  60 | `matter-journal` / `legal-guidance-vault`  | heycounsel             | 案件日志 + 可检索指导库     |

### 3.E 合规 / 隐私 / AI 治理 / 特权

|   # | Skill                                                | 来源                        | 流程思想（摘要）    |
| --: | ---------------------------------------------------- | --------------------------- | ------------------- |
|  61 | `compliance` / `legal-compliance`                    | Anthropic / ai-legal-claude | 多制度 gap analysis |
|  62 | `dpa-review` / RGPD DPA                              | AgentCounsel / lawve        | Art.28 检查清单     |
|  63 | `gdpr-breach-sentinel` / `dpia-sentinel`             | lawve                       | 事件响应 / DPIA     |
|  64 | `privilege-sentinel`                                 | lawve / heycounsel          | AI 提示词特权预检   |
|  65 | `ai-use-case-intake` / governance reviewer           | AgentCounsel / lawve        | AI 用例治理入口     |
|  66 | `eu-ai-act-triage` / classification                  | lawve                       | 风险分层 triage     |
|  67 | `skill-injection-defense` / `skill-security-auditor` | lawve                       | 安装前安全审计      |
|  68 | `advertising-compliance` / `广告合规审核`            | zh-xx / pa1nrui1            | 垂类合规模板        |
|  69 | `sanctions-screening` + adjudication                 | lawve                       | 筛查命中裁决升级链  |

### 3.F 文书交付 / Office

|   # | Skill                                      | 来源                 | 流程思想（摘要）           |
| --: | ------------------------------------------ | -------------------- | -------------------------- |
|  70 | `docx` / `pdf` / `pptx` / `xlsx`           | anthropics/skills    | 官方交付物处理标准         |
|  71 | `legal-document-drafting-formatting`       | lawve                | 实质内容 → 规范 Word       |
|  72 | `legal-document-formatting`                | Legal-Skills-Chinese | 裁判文书规范格式           |
|  73 | `legal-report-pdf`                         | ai-legal-claude      | 分数仪表盘式交付报告       |
|  74 | `tabular-review`                           | lawve                | 多文档 → 带引用 Excel 矩阵 |
|  75 | `md2word` / `legal-text-format`            | cat-xierluo          | MD→Word 实务链             |
|  76 | `法律文书出稿前审查`                       | pa1nrui1             | 出稿前硬门禁               |
|  77 | `canned-responses` / `meeting-briefing`    | Anthropic Legal      | 模板回复 + 会前简报        |
|  78 | `persuasive-legal-writing` / `lawyerscrib` | lawve                | 法律写作质量层             |

### 3.G 协作 / 多 Agent / 调度

|   # | Skill                                       | 来源            | 流程思想（摘要）       |
| --: | ------------------------------------------- | --------------- | ---------------------- |
|  79 | 5 parallel agents + Safety Score            | ai-legal-claude | 并行再聚合打分         |
|  80 | `multi-agent-orchestration` / cross-agent   | cat-xierluo     | 多助手协调             |
|  81 | `legal-architecture`                        | zh-xx           | 法律知识架构设计       |
|  82 | `opc-legal-counsel`                         | cat-xierluo     | 常年法律顾问角色       |
|  83 | `WORKFLOW_ROUTER`                           | AgentCounsel    | 任务 → skill 路由表    |
|  84 | Attorney Verification Checklist（全库模式） | AgentCounsel    | 每交付强制律师核验清单 |

### 3.H 工程 / 产品机制（非法律域但同构）

|   # | Skill / 模式                            | 来源                | 流程思想（摘要）        |
| --: | --------------------------------------- | ------------------- | ----------------------- |
|  85 | `skill-creator`                         | anthropics          | 规范技能包作者体验      |
|  86 | `doc-coauthoring`                       | anthropics          | 人机共写修订流          |
|  87 | `planning-with-files`                   | OthmanAdi           | 磁盘持久计划 + 完成门禁 |
|  88 | `document-review`（多 persona）         | 社区（如 acepe）    | 多视角并行审稿          |
|  89 | document-reviewer + 验收追溯            | shinpr 等           | Design→Plan→验收可追溯  |
|  90 | HITL suspend / resume workflow          | VoltAgent           | Job 中断审批续跑        |
|  91 | Safe Refactor：propose → diff → approve | VoltAgent subagents | 危险动作预览后执行      |
|  92 | Agent Memory / knowledge graph          | cognee              | 长期记忆图              |
|  93 | `continuous-improvement-engine`         | LPM                 | 复盘 → 技能/流程提案    |
|  94 | privilege + skill security auditor      | lawve               | 内容与安装安全层        |
|  95 | production engineering skills           | addyosmani          | 测试 / 门禁 / 可观测    |

---

## 4. LawMind 现状对照与产品差距

### 4.1 已具备的强底座（不要推倒重来）

对照 [GOALS](../GOALS.md) / DFA / Phase 5–8：

| 能力        | 现状要点                                                     |
| ----------- | ------------------------------------------------------------ |
| 任务闭环    | Router → Research → Draft → Review → Render；Clarify–Execute |
| 交付物本位  | `DeliverableType`、acceptance gate、acceptance pack          |
| 信任        | 审计链、来源预览、危险工具审批、Edition 开关                 |
| Matter 写侧 | matter.json / deliverables / approvals / queue / deadlines   |
| 记忆        | 多 scope Memory Adoption + 律师偏好学习 + 合同修订积累       |
| 协作与异步  | 工作流模板、Jobs/SSE、Agent Fleet / Automations 雏形         |
| 桌面        | 审核台、自检摘要、Job Intake、设置与体检                     |

### 4.2 与 Skills 生态对比后的核心差距（产品力视角）

| 差距                               | 律师感知                     | Skills 侧已证明的形态                              | LawMind 今日短板                                    |
| ---------------------------------- | ---------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| G1 分流不够「像分诊」              | 「什么都往死里跑一遍」       | NDA triage 色标、AI Act triage                     | Intake / Router 缺少显式风险档与路径分叉 UI         |
| G2 审查不是「专业小组」            | 「一个助手自说自话」         | 5 并行 agents + 聚合分                             | Fleet 未默认绑定合同审查剧本与 Safety Score         |
| G3 推理不可见为「案件理论」        | 「不知道它怎么想的」         | 要素→争点→演绎→论证强度                            | Reasoning 多在内部；缺一等公民 Issue/Argument 图 UI |
| G4 引用可预览但未「锁死」          | 「还是怕假法条」             | source-locked / norm-validity / citation-validator | 缺强制 grounded 模式与效力校验步骤                  |
| G5 Matter 运营偏「存储」弱「经营」 | 「案子立了但不会自己推进」   | LPM：plan / RAID / scope / daily briefing          | plan/RAID/范围变更未成律师日活表面                  |
| G6 律师核验清单碎片化              | 「审核台信息多但不知先看啥」 | Attorney Verification Checklist 标准化             | SelfCheck / Acceptance 未统一「必核清单」模型       |
| G7 技能包=能力市场未产品化         | 「只会内置几种文书」         | AgentCounsel / Chinese / pa1nrui1 剧本库           | Bundles 有签名校验，缺一等「工作流技能市场」UX      |
| G8 进化闭环偏事后写入              | 「感觉没在变聪明」           | continuous-improvement 提案                        | 学习写入有，缺「复盘提案→采纳→度量首过率」产品环    |
| G9 多交付物审查矩阵弱              | 「一批合同对表很痛苦」       | tabular-review                                     | 缺「多文档×检查列×引用」矩阵交付                    |
| G10 出稿报告不够「给客户看」       | 「导出的是稿，不是决策包」   | legal-report-pdf（分/图/优先级）                   | acceptance pack 偏工程；缺客户向审查报告版式        |

### 4.3 模块级映射（Skill → LawMind 路径）

| Skill 思想                       | 优先映射模块（现有或新建）                                                     |
| -------------------------------- | ------------------------------------------------------------------------------ |
| WORKFLOW_ROUTER + skill metadata | `src/lawmind/router/` · `workspace/lawmind/workflows/` · 未来 `skills/` 注册表 |
| triage 色标                      | Job Intake · Router `runtimeHints` · Matter queue 优先级                       |
| 并行审查 roles                   | Agent Fleet · `collaboration` workflow-run · ReviewWorkbench 分栏              |
| 原子推理链                       | Reasoning 层 · 新建 `LegalReasoningGraph`（见 2.0 策略）· 桌面「案件理论」页   |
| source-locked / citation         | Retrieval · Citation Banner · Source Preview · policy 开关                     |
| LPM intake/plan/RAID             | Matter write-side · deadlines · 新建 Matter Ops 表面                           |
| Attorney Verification            | AcceptanceGate · ReviewSelfCheck · acceptance-pack schema                      |
| continuous improvement           | Memory Adoption · contract-revision · Insights / 学习面板                      |
| privilege / skill audit          | policy · bundle verify · 设置 Doctor                                           |
| tabular / report PDF             | delivery · Review export · PPTX/PDF renderer                                   |

---

## 5. 产品力优先的全面优化建议（允许大改）

下列建议按**产品史诗**组织，而非小补丁。每条含：目标体验、建议改动、主要触点、验收、风险。

---

### 史诗 E1 — 「分诊台」：Intake → Triage → 路径分叉

**目标体验**：律师丢进材料或一句话，30 秒内看到 **GREEN / YELLOW / RED（或等价中文档）**、推荐工作流、需澄清问题、预估工时/风险；一点确认才进入重执行。

**建议大改**

1. 将 Job Intake 升级为 **Triage Session** 一等对象（持久化到 matter）：`triage.json` 含档位、触发规则、recommendedWorkflowId、pendingClarifications、estimatedEffort。
2. Router 输出结构化 `TriageResult`（不只是 intent 标签）；桌面首屏用分诊卡替代「直接开聊」。
3. 内置剧本：`nda-triage`、合同批量 screening、诉讼材料分诊、合规 gap 快筛（对齐 skill #2 #16 #66）。
4. RED 默认强制 Clarify–Execute；GREEN 可一键「按标准剧本执行」。

**主要触点**：`LawmindJobIntakeForm` · router · matters queue · FirstRun / Automations。

**验收**：同一 NDA 样本三次运行档位稳定；RED 路径无法跳过澄清直接 `draft_document`；律师从打开到确认路径 ≤ 3 次点击。

**风险**：过度分诊打扰熟练用户 → 提供「记住我的默认：跳过 GREEN 确认」。

---

### 史诗 E2 — 「审查专案组」：默认并行 Fleet + 聚合 Safety Score

**目标体验**：合同/文书审查不再是单线程聊天，而是可见的专案组：条款分析 / 风险 / 合规 / 义务时间线 / 引用核验 / 验收门禁；结束时一张 **Safety Score + 优先级谈判清单 + 客户向摘要**。

**建议大改**

1. 将「合同审查」做成 **Fleet Playbook**（一等）：固定角色图、权重、聚合算法（对齐 ai-legal-claude #79）。
2. ReviewWorkbench 改为 **专案组视图**：左稿、中批注、右角色结论 tab；顶部 Sticky = Score + 必核项。
3. 引擎层新增 `ReviewCampaign`（或扩展 TaskRecord）：子任务结果写入 matter deliverables，主任务只做聚合与门禁。
4. 导出 `review-report.pdf`（客户/内部两版式），对齐 #73；acceptance-pack 作为审计版附件。
5. 增加角色：`opposing-counsel`（#45）、`judicial-cold-read`（#44）作为可选「加压轮」。

**主要触点**：Agent Fleet · ReviewWorkbench · `deliverables/` · render/pdf · collaboration workflow。

**验收**：单合同审查默认拉起 ≥4 角色；聚合分与高风险条款列表可复现；律师可一键重跑单角色而不整案重来。

**风险**：成本与延迟 → Edition：Solo 默认同级串行「伪并行」；Firm 真并行；显示预估 token/时间。

---

### 史诗 E3 — 「案件理论」：LegalReasoningGraph 一等公民

**目标体验**：每个实质任务旁有一页「案件理论」：争点树、要件、事实/证据锚点、规范依据、开放问题、论证矩阵、冲突与置信度——可编辑、可审核、可导出，草稿正文只是其投影。

**建议大改**

1. 落实 [2.0 策略 §4.2](LAWMIND-2.0-STRATEGY.md) 的 `LegalReasoningGraph`，落盘 `matters/<id>/reasoning/<taskId>.json` + 可读 `THEORY.md`。
2. 用 Legal-Skills-Chinese 主线固化 **pipeline stages**（可配置）：  
   `element-extract → structure-gate → issue-id → retrieve → validity-check → deduce → argue → strength-eval → draft`（#32–#42）。
3. Reasoning Gate：strength 或 openQuestions 超阈值时禁止 render（扩展 Clarify–Execute）。
4. UI：Matter 内「理论 / 卷宗 / 交付」三栏；聊天侧可「采纳到理论」。
5. 复合 skill 模式：预置「裁判文书生成」「诉讼策略备忘」等编排模板，显式列出调用的原子阶段。

**主要触点**：`src/lawmind` reasoning · matter storage · MatterView · Chat sticky。

**验收**：关闭理论页仍可聊天，但高风险交付物无理论锚点时 gate 失败；导出理论 Markdown 可供他案复用。

**风险**：结构化过重吓退 Solo → 默认「轻量理论」（争点+依据+开放问题三块），Firm 开完整图。

---

### 史诗 E4 — 「不可编造」：Grounded 模式与效力闸门

**目标体验**：律师打开「严格援引」开关后，任何规范/案例断言必须带来源；失效/冲突规范高亮；无源结论只能标「待检索」，不能写进对外稿。

**建议大改**

1. Policy：`citationMode: grounded | assisted | off`；Grounded 下 draft validator 新增规则（对齐 #25 #26 #21 #22）。
2. Retrieval 管道增加 **norm-validity** 步骤（本地缓存 + 可选 PKULaw/其他 MCP）。
3. Citation Banner：区分「已核实 / 待核实 / 模型记忆」；待核实阻断 acceptance。
4. Red-team verifier（#28）作为审核台一键「加压核验」Job。
5. 桌面设置与 Doctor 暴露 grounded 是否生效（类似 agentMandatoryRulesActive）。

**主要触点**：policy · retrieval · acceptance specs · Citation UI · bundles/MCP。

**验收**：故意喂过时法条名，gate 捕获；断开外部库时全部引用变「待检索」且不可 strict render。

**风险**：无外部库时可用性下降 → 本地法规包 + 明确空态引导。

---

### 史诗 E5 — 「Matter 操作系统」：从档案到经营

**目标体验**：打开 matter = 经营台：今日必做、RAID、范围基线、计划与关键路径、审批瀑布、期限、组合早报——聊天与审查是手段，不是唯一界面。

**建议大改**

1. Matter 首页信息架构重构为 **Ops Dashboard**（对齐 LPM #46–#55）：
   - Intake brief / Scope baseline
   - Plan（phases · owners · milestones）
   - RAID log
   - Deadlines & critical path
   - Approvals cascade
   - Deliverables & acceptance 汇总（已有 P4.5 可嵌入）
2. 新增对象：`scope.json`、`raid.jsonl`、`plan.json`（与现有 deadlines/approvals 并列）。
3. Automations：`daily-briefing`（跨 matter）、`status-report-drafter`、`scope-change-controller` 工作流。
4. 邮件/会议纪要 → RAID/决策提取（可选 Mail 账户，已有 mail 路由可接）。
5. 「结案归档」状态机（#59）：closeout checklist + continuous-improvement 提案（#55/#93）。

**主要触点**：MatterView · automations · jobs · mail · memory adoption。

**验收**：律师一周主要时间可在 Matter Ops 完成跟踪，无需自建表格；范围变更有审计事件。

**风险**：UI 变重 → Solo 默认折叠为「简报条」；完整 Ops 为 Firm 默认。

---

### 史诗 E6 — 「统一必核清单」：Attorney Verification 产品化

**目标体验**：任何高风险交付物旁有一份**短、硬、可勾选**的律师必核清单；未勾选不能标「已审核通过」；清单随交付类型变化，且写入审计与 acceptance-pack。

**建议大改**

1. 抽象 `VerificationChecklistSpec`（按 DeliverableType / Fleet Playbook），内容来源可对齐 AgentCounsel 模式（#84）与出稿前审查（#76）。
2. Review UI：SelfCheck + Acceptance + Checklist 三合一；勾选写入 `approvals.jsonl`。
3. 清单项可关联理论图节点或引用 id（点一下跳转）。
4. 导出 pack 含 checklist 完成态；合规导出（compliance audit）引用同一模型。

**主要触点**：deliverables specs · ReviewWorkbench · audit export。

**验收**：缺勾选时 review.approve API 返回 422；清单版本号进入审计。

---

### 史诗 E7 — 「技能与剧本市场」：本地 Skills Runtime

**目标体验**：律师/所在设置里浏览、启用、签名校验、版本锁定「工作流技能包」；自然语言自动路由到技能；开发者用与 AgentCounsel 兼容的 SKILL.md 扩展（本地目录，非强迫远程市场）。

**建议大改**

1. 扩展现有 bundles（`verifyLawMindBundleManifest`）为 **Skills Runtime**：  
   `workspace/lawmind/skills/<id>/SKILL.md` + optional scripts/templates。
2. 统一元数据：`name, description, useWhen, doNotUseWhen, requiredInputs, workflow, outputFormat, attorneyChecklist, riskTier, edition`。
3. Router 增加 skill 匹配层（#83）；与 workflows/\*.json 双向可编译。
4. 内置「启动包」：从 Chinese 原子阶段、合同 Fleet、LPM Ops、pa1nrui1 高频剧本各抽可本地化的子集（注意许可证：CC BY-NC-ND / AGPL 等**不可直接 vendoring 进商业发行**——思想重实现，原文需合规）。
5. 设置 UI：技能库 + 安全审计（#67/#94）+ Doctor 健康项。
6. `skill-creator`（#85）做成内部文档/CLI：`pnpm lawmind:skill:init`。

**主要触点**：bundles · router · settings · automations · docs。

**验收**：新增一个本地 skill 目录无需改引擎代码即可被路由；篡改签名被拒绝。

**许可证红线**：收录第三方 SKILL 正文前必须过法务/许可证表；默认策略是「自研兼容实现 + 文档致谢」。

---

### 史诗 E8 — 「审查矩阵与比对」：批量与版本

**目标体验**：律师对 20 份合同或两版协议：一张表（行=文件/条款主题，列=检查项），格内结论+引用；版本比对高亮危险变更。

**建议大改**

1. 新交付类型 `tabular.review`（#74）+ UI 矩阵编辑器。
2. `legal-compare`（#6）接入 FileWorkbench / Review：结构化 diff（不仅是文本）。
3. 批量 screening Job（#16）结果进入 queue，可逐份升级为完整 Fleet 审查。
4. 与 playbook 列定义联动（所内私有列 JSON）。

**主要触点**：delivery · jobs · file workbench · playbooks。

**验收**：10 份 NDA 批量产出 xlsx/csv + 每格 citation；比对报告可审核。

---

### 史诗 E9 — 「越用越像你」：进化度量闭环

**目标体验**：律师能看到「本月首过通过率、人均改写率、偏好命中、某角色特化程度」；系统主动提出 playbook/profile 补丁，律师一键采纳或驳回。

**建议大改**

1. 指标落库：按 matter/deliverable/agentRole 聚合（对齐远景「特化可度量」）。
2. continuous-improvement Job（#55）：结案或每周扫描 → `MemoryAdoption` 建议（pending）。
3. 合同修订积累与审核学习统一进「成长收件箱」UI。
4. Insights 面板从实验页升级为律师可见的进化仪表盘。

**主要触点**：memory adoption · insights · review learning · contract-revision。

**验收**：驳回的建议不再重复打扰；采纳后同类任务首过率样本上升（离线评估集）。

---

### 史诗 E10 — 「信任与特权」：Firm/Private 默认加固

**目标体验**：所内默认：危险工具预览 diff、提示词特权预检、技能包审计、演员归属完整；律师感到「这是所里的系统」而非个人玩具。

**建议大改**

1. privilege-sentinel（#64）接入 compose 发送前（可配置）。
2. 危险工具统一走 propose→diff→approve（#91），与 strictDangerousToolApproval 合流。
3. Actor attribution、协作审计、approval cascade（#51）在 Firm 版默认开。
4. Doctor：grounded、skills 签名、mandatory rules、edition 一致性一屏。

**主要触点**：policy · agent tool pipeline · settings doctor · collab。

**验收**：Private Deploy 检查清单全绿；特权预检有可测夹具。

---

### 史诗 E11 — 「桌面信息架构」：领导驾驶舱（允许大改导航）

**目标体验**：律师每天打开应用，第一眼是「要我拍板的 / 今日期限 / 进行中的专案组 / 可进化建议」，而不是先找聊天框。

**建议大改**

1. 壳层导航以 **Home（领导驾驶舱） / Matters / Review / Fleet / Automations / Knowledge** 重组（现有 AgentFleet / Automations / Meeting 可并入）。
2. Home = daily-briefing（#53）+ Needs Decision（已有按钮可升级为收件箱）。
3. Chat 降为 Matter / Task 的工作表面，而非应用中心（与「不是聊天产品」愿景一致）。
4. 空态与 FirstRun：用分诊 + 模板，而非模型闲聊。

**主要触点**：LawmindAppSidebar · MainBody · header · overlays。

**验收**：可用性测试中，律师完成「处理 3 个待批准 + 查看 1 个案期限」不经过聊天输入框。

**风险**：老用户习惯 — 提供「经典布局」切换一版。

---

### 史诗 E12 — 「中国法务深度包」（差异化）

**目标体验**：中国大陆成文法场景下，检索→效力→要件→文书的路径明显强于通用英文合同工具；可选接北大法宝等 MCP，但不锁死。

**建议大改**

1. 官方「中国法务」skill/workflow 包：吸收 Chinese #19–#42、pa1nrui1 高频诉讼/劳动/合同剧本的**流程骨架**（自研文案）。
2. 文书模板分类强化诉讼/劳动/执行等（已有 contracts/litigation/client/internal 可扩展）。
3. 证据清单 / 期限监控 / 立案-结案状态（#35 #57 #59）进入 Matter Ops。
4. 检索适配器接口标准化（方法论与数据库分离，对齐 Chinese 设计）。

**验收**：无外网法规 API 时仍能跑通「待检索」合规路径；有 API 时引用核实率可测。

---

## 6. 分期路线图（产品力序）

### Wave 0 — 对齐与度量（1–2 周）

- [ ] 选定 20 个黄金任务（合同审查×5、诉讼文书×5、催告/意见×5、批量/比对×5）作回归集。
- [ ] 为 Review / Intake / Matter 埋首过通过率、改写率、gate 失败原因。
- [ ] 许可证表：第三方 skill 只作思想参考的白名单。

### Wave 1 — 分诊 + 必核清单 + Grounded 开关（产品体感最大）

- [ ] E1 Triage Session
- [ ] E6 VerificationChecklistSpec
- [ ] E4 `citationMode=grounded`（先本地规则，MCP 后接）

### Wave 2 — 审查专案组 + 报告

- [ ] E2 Fleet Playbook + Safety Score
- [ ] 客户向 review-report 导出
- [ ] 可选加压角色（对方律师 / 冷读）

### Wave 3 — 案件理论 + Matter Ops

- [ ] E3 LegalReasoningGraph + UI
- [ ] E5 scope / plan / RAID
- [ ] E11 驾驶舱导航（可与 E5 并行设计）

### Wave 4 — 技能运行时 + 批量矩阵 + 进化

- [ ] E7 Skills Runtime
- [ ] E8 tabular.review + compare
- [ ] E9 进化仪表盘
- [ ] E10 Firm 信任加固
- [ ] E12 中国法务深度包

### 明确延后（除非客户买单）

- 全面律所财务/LEDGES 计费（LPM billing 系列）作为独立商业线。
- ThomasMore 三千技能远程编排（与本地优先冲突，仅作 MCP 可选）。
- 以聊天为中心的「百种法律问答」堆砌。

---

## 7. 工程约束与实施原则（大改时仍要守）

1. **Markdown / JSON 真相源**：理论、清单、技能、RAID 可被人类 diff；向量库只派生。
2. **门禁默认开**：strict render、危险工具、grounded、checklist 的 bypass 必须审计且 Edition 可控。
3. **可测试**：每个史诗带 `*.test.ts` + 至少一条桌面 e2e（golden / review / fleet）。
4. **Edition**：Solo 轻、Firm 全、Private 更严；不要强迫 Solo 承受 Firm 复杂度。
5. **许可证**：第三方 SKILL.md 默认不进发行包；流程重写进 `workspace/lawmind/skills` 自有内容。
6. **性能**：并行 Fleet 要有预算（`agentMaxToolCalls` / 角色级超时 / 可取消 Job）。
7. **安全**：读 [SECURITY.md](../SECURITY.md)；技能脚本 = 危险能力，走审批。

---

## 8. 决策日志

| 日期       | 决策                                         | 理由                                                                                  |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2026-07-20 | 创本文；产品力优先允许大改导航与审查信息架构 | Skills 生态显示「分诊 / 专案组 / 理论图 / LPM」是成熟形态，LawMind 底座已具备承接条件 |
|            |                                              |                                                                                       |

---

## 附录 A — 已落地对照（持续勾选）

> 落地后把史诗条目移到这里并链到 PR / 模块路径。

| 史诗     | 状态 | 说明                     |
| -------- | ---- | ------------------------ |
| （尚无） | —    | 本文创建时仅为调研与规划 |

---

## 附录 B — 修订记录

| 日期       | 摘要                                                        |
| ---------- | ----------------------------------------------------------- |
| 2026-07-20 | 初版：源仓库索引、95 条 skill 表、12 条产品史诗、分期路线图 |

---

## 附录 C — 快速链接（外部）

- https://github.com/lawve-ai/awesome-legal-skills
- https://github.com/THUYRan/Legal-Skills-Chinese
- https://github.com/zubair-trabzada/ai-legal-claude
- https://github.com/legalopsconsulting/lpm-skills
- https://github.com/zgbrenner/agentcounsel
- https://github.com/anthropics/skills
- https://github.com/OthmanAdi/planning-with-files
- https://github.com/VoltAgent/awesome-agent-skills
