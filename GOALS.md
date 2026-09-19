# LawMind 目标文件（文档即记忆）

本文档是 **LawMind** 的目标与进度单一入口：方向、当前期次与未完成项集中在此，便于对齐与回溯。  
与 [`VISION.md`](VISION.md) 的关系：`VISION.md` 是简短的工程入口；产品原则以本文 §二 为准，历史叙事见 [docs/archive/LAWMIND-VISION.md](docs/archive/LAWMIND-VISION.md)（归档）。  
**历史期次**：第一至第十三期及第十四期已完成切片的勾选细节已移入 [`CHANGELOG.md`](CHANGELOG.md)「历史期次归档」；本文只保留当前态。

---

## 一、仓库定位

- 本仓库为 **LawMind 单体代码库**：引擎 **`src/lawmind`**、桌面 **`apps/lawmind-desktop`**、文档站 **`apps/lawmind-docs`**。
- 引擎模块与架构五层（Router / Memory / Retrieval / **Reasoning** / Artifact）及 Agent、Matter 写侧等扩展，见 **[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)** §二。
- 不再包含 OpenClaw 网关、extensions 渠道树或移动/桌面伴侣应用目录。

---

## 二、愿景与原则（摘要）

### 产品定位：律师 Agent 生态的消化与交付层

LawMind 不以闭门自研全部律师能力为目标。Cursor、Codex、Claude Code 及兼容 Agent 生态中已经出现并将持续出现大量法律 Skill、插件、MCP 服务、工具、提示词与工作流；LawMind 的核心工作是**尽可能广泛地发现、实际验证、合法吸收并重新组合这些能力**，最终把它们变成律师无需理解底层工具差异即可使用的一体化产品。

“消化成自己的”不是简单复制仓库或堆砌插件，而是完成五件事：

1. **持续发现**：系统性扫描公开生态，不依赖偶然看到的项目或单一榜单。
2. **实际验证**：以真实律师任务、输入材料和交付结果测试能力，不以 README、Star 数或演示视频代替验收。
3. **统一适配**：将不同 Agent 的 Skill、命令、MCP 和工具接口转为 LawMind 可调用的统一能力。
4. **产品化组合**：围绕检索、尽调、合同、诉讼、交易、合规、知识管理和办公交付等日常工作组织默认流程，而不是向律师暴露插件拼装过程。
5. **合法吸收**：记录来源、版本和许可证；允许直接采用时保留必要声明，不允许时借鉴方法并独立实现，不以“自研”掩盖来源。

### 律师产品四条铁律（最高优先级 · 必须贯穿）

面向**执业律师**的一切产品与工程取舍，必须同时满足下列四条：

| #   | 铁律                 | 律师侧含义                                                                             | 否决标准（一例）                                      |
| --- | -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | **上手简单**         | 少配置、少迷路；默认路径就能交办与跟进                                                 | 让 Day-1 / Solo 主路径变难 → 不做或收到次要入口       |
| 2   | **交付结果质量高**   | 交件达到可直接使用的专业水准；在已配齐功能上把模型能力用满，尽量顶掉该任务上的律师一稿 | 只能产出待填摘要、不能改稿/计算/成套文书 → 不做主路径 |
| 3   | **交付结果稳定性高** | 同样交办结果不飘、流程不偶发翻车；失败可解释                                           | 同任务结果更飘 / 更偶发 → 先修稳态再扩面              |
| 4   | **先复用，后自研**   | 先检索并验证现有 Skill、插件、MCP、工具和工作流，再决定集成、改造或补缺                | 未做外部检索和差距验证就新造同类能力 → 不立项         |

### Agent 引导原则（Cursor / Claude / Codex 级 · 贯穿工程）

面向模型编排与工具控制时，用 Skill、原则、独立审稿量规、软教练和提案–接受发挥模型判断；覆盖率不得由写者给自己打分。**已配置的工具默认对本轮可用**：意图编译只去掉和律师指令相反的默认完成条件，落实点名落点与不覆盖原稿，不得为「走对流程」冻结工具表。只有具体安全风险、空交付、明确授权边界、跨度硬门禁或外部系统不可逆操作才使用硬拦截。不得用「禁止清单 / 字数配额 / 关键词硬拒」冒充质量或稳定。路径识别不得同时锁工具又注入相反协议。邮件短路径与明示「改这份 Word」只禁误发、模板重建原件和空修订；检索与对话说明默认仍可用。

- **直接兼容**：优先支持公开且成熟的 Agent Skills、MCP 与工具协议，减少无价值的专有格式。
- **吸收而非套壳**：保留好能力的任务知识和验证方法，但统一交互、上下文、工具调用与交付标准，不让律师在多个开发者工具之间切换。
- **对照而非崇拜**：Star 数、品牌和模型声明只是发现线索；是否进入 LawMind 由真实律师任务结果决定。
- **补缺而非重造**：只有在外部方案不存在、许可证不可用、质量不达标或无法融入产品时才自研，并记录差距证据。

### 关于“可审计”

LawMind **不把可审计当作产品价值、法律质量证明或用户信任来源**。记录了过程不等于结论正确，能够回放也不等于交付有用；把日志、哈希链、来源字段或审批页面包装成“可信法律 AI”，属于虚假代理指标。

现有日志、来源、事件、批准和完整性设施应按具体用途保留或删减：

- 为调试、故障恢复、用户撤销、安全调查或明确法规义务服务的，按最小必要原则保留；
- 不能改善律师任务完成率、交付质量、稳定性或必要安全性的，不再作为路线图优先级；
- 产品文案不得以“可审计”“可追溯”替代对正确率、缺陷召回、引用有效性和真实交付效果的证明。

- **产品定位（现阶段）**：优先面向个人律师，把外部 Agent 生态中已验证的法律能力统一消化为日常工作台；律所协作是延伸能力。
- **能力边界**：覆盖律师日常可交办事项，包括检索、尽调、合同、诉讼、交易、合规、材料整理、数据分析与办公交付；合同是高价值子集，不是产品边界。
- **任务北极星**：律师提出任务并提供材料后，LawMind 应选择和组合最合适的能力，持续执行到可用交付物；衡量结果，而不是对话轮次、功能数量或审计事件数量。中间步骤（列目录、检索、分析）不向律师提问「要不要继续」；只有外发、改原稿等真授权才打断。

---

## 三、当前期次与未完成项

### 第十九期 — 商业产品化冲刺（对标 Harvey · 当前期次）

依据：2026-09-18 市面对标评审（[docs/LAWMIND-AGENT-PARITY-REVIEW.md](docs/LAWMIND-AGENT-PARITY-REVIEW.md)）+ Harvey 2026-09 公开 release（Harvey II / Tenet / Agentic Vault / Review Tables / Command Center）。主线：**把「交件能不能直接用」从工程切片变成商业承诺**。计划全文：画布 `lawmind-harvey-next-steps-2026-09`。

- [ ] **P0-1 真稿对照必跑**：`--write-baseline` 基线生成器；闸门结果写 `lawmind/metrics/true-manuscript-report.json`；release-readiness 真稿章节；nightly 接线（无夹具诚实 SKIP 不红）。真稿由律师自行脱敏放入，工程侧不伪造。
- [ ] **P0-2 交件 lint 默认化（法律版 tsc）**：`renderDraft` / `render_tracked_draft` 机械 blocker 翻 `ok: false` 并收窄重试；邮件短路径意见稿文本纳入机械 lint（工具表冻结包不动）；NPC 可用时引用法条现行性试检（软标【待核实】）；cassette 断言 `lint_mechanical` 回灌。
- [ ] **P0-3 法源默认可用**：NPC hybrid 默认开（`LAWMIND_OPEN_LAW_NPC=0` 才关）+ 端点节流；设置页 NPC 开关写 `.env.lawmind`；docx「参见」行带 url 时写超链接。断网/WAF 拒绝时诚实回退样本标演示语料。
- [ ] **P1-A 案件上下文继承 + 可引用先例库**（对 Space / iManage）：结构化案件 fragment（当事人/未决期限/材料 top-N/时间线摘录，≤800 token）；旧案交付物入 knowledge_fts（`LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1` 才开）；`search_precedents` 工具；对照 Tab 可「引用到对话」。
- [ ] **P1-B 材料 Vault 搜索与整理**（对 Agentic Vault）：`materials_fts`（trigram，mtime 增量）；`search_matter` 带 `{relPath,page}`；`GET /api/matters/:id/materials/search`；整理三件套 `propose_organize_plan` → 确认 → `execute_organize_plan` → `revert_desk_write` 新 kind `organize_files`（限 materials 围栏）。
- [ ] **P1-C 审查表交付物**（对 Review Tables）：`review.table` 类型（尽调/证据/条款矩阵三模板）；`review_table_update` 批量改/分组/导元数据；文书台轻量表格编辑器；xlsx/docx 导出。
- [ ] **P1-D 风格记忆闭环**（对 Harvey Memory）：文书台保存时改稿 delta → 候选 → 待确认；确认后写 LAWYER_PROFILE §八 + 可执行偏好；§八写侧轮转（消 FUTURE-ISSUES 挂账）。不确认零写入。
- [ ] **P1-E 冷启动收尾**：钥匙验证完自动建演示案件 + 种子提示 + 可执行默认，不再弹首跑向导（可从设置重开）；修 `applyPostFirstrunPermissionDefaults` 忽略 `executable`。
- [ ] **P2-A 发行纪律**：tag 工作流接线 mac 签名/公证（`LAWMIND_REQUIRE_NOTARIZED=1`）与 win Authenticode（缺 secrets 诚实标红）；release-readiness 增公证状态 / latest*.yml / 真稿三项。证书为外部依赖。
- [ ] **P2-B 离线许可（软门槛）**：`src/lawmind/license/`；`~/.lawmind/license.json`；ed25519 激活码 + 机器指纹；30 天试用到期只提醒不锁死；Doctor 许可区；SECURITY.md 补边界。不引入远程控制面。
- [ ] **P2-C 交办成绩单 + 诊断包**：Doctor 律师可见成绩单（交办成功率/一次通过/lint 拦截/真稿趋势/法源状态）；`GET /api/support/bundle` 脱敏 zip（专测不含 key/secret）。
- [ ] **P2-D 文档站发布**：`lawmind-docs.yml` 加 Pages deploy（main 推送）；CNAME 拷入 public；快速指南对齐新首跑流程（截图待真机补拍，诚实标注）。
- [ ] **P3-1 首批 3 个 Skill 内化**：`contract-playbook-review`（Anthropic playbook，Apache-2.0，三档+己方/对方纸）；`matter.status` 补范围变更与预算（LPM）；`chronology.timeline` 两阶段预览确认（HoriZon/GCL）。每个带契约测试与出处记录。
- [ ] **P3-2 消化流水线节奏化**：`docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md` 第八节「消化记录 / 待消化」两表；`pnpm lawmind:skills:census --fetch` 的增量输出直接指向「待消化」登记格式；每期固定「本期消化 N 个（默认 3 个）」勾选项。

**期次模板（抄到下期）**：

```
- [ ] 本期消化 3 个外部能力：____ / ____ / ____
      （要求：builtin 正文 + BUILTIN_SKILL_SEED_IDS 注册 + 能力映射 + 契约测试 + 第八节「消化记录」一行；NC/未声明只写方法借鉴）
```

```bash
pnpm test && pnpm --filter lawmind-desktop typecheck && pnpm lawmind:compiler-gate
LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript   # 放稿后必须 RUN 且全过
pnpm lawmind:release-readiness && pnpm lawmind:docs:build && pnpm lawmind:desktop:e2e:pr
```

### 第十八期 — 对话补档案

律师拍板：对话里说补就**直接写入**（写错再改）；工作台贴传票/谈话的手工入口先留；不开办件菜单——开口或丢传票/谈话/文件夹时，**本轮工具表带上对应读写**，「更多工具」目录覆盖工作台真实能力。

对照：Cursor 打开工作区就能读改；Codex 隐式匹配 + 本轮披露 + cassette 断言工具表；DeepSeek harness 工具卡/Stop/轮中补材料。LawMind 要同等 harness，交付物是**工作台那份期限/谈话/卷宗**，不是聊天摘要。

计划全文：[docs/LAWMIND-CHAT-MATTER-FILL.md](docs/LAWMIND-CHAT-MATTER-FILL.md)。

- [x] **第 1 波 写穿**：`extract_legal_events` / `apply_legal_events` / `compile_intake_brief` / `apply_intake_brief` / `update_matter_profile` 与工作台 HTTP 同一 helper；档案类办件第一轮广告这些工具；`list_more_tools` 目录能启用；Skill/系统提示不再把人赶回工作台确认；cassette 断言广告且 `deadlines.jsonl` / `intake-brief.json` 真落盘。
- [x] **第 2 波 材料口**：对话框粘贴截图即钉选；工作台期限/谈话可丢 PDF/图（手工仍确认）；OCR 空则视觉兜底（律师不配环境变量）；路径/目录走 `explore_folder` + `import_host_file`；`revert_desk_write`。
- [x] **第 3 波 铺开**：证件照填当事人、发票收进本案、无案件时才允许建新案；邮件开庭通知不得被短路径冻住写入。
- [ ] **对照实测**：真传票 PDF/照片 + 谈话记录走对话补上后，工作台今日开庭与谈话页是同一条。无真稿则 skip，不以假图冒充。

```bash
pnpm exec vitest run src/lawmind/agent/turn-orchestrator-cassettes.test.ts \
  src/lawmind/agent/tools/disclosed-turn-tools.test.ts \
  src/lawmind/agent/tools/legal/list-more-tools.test.ts \
  src/lawmind/desk src/lawmind/intent/gold-set.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-lawyer-desk.test.ts \
  apps/lawmind-desktop/src/renderer/lawmind-chat-compose-chrome.test.tsx \
  apps/lawmind-desktop/src/renderer/LawmindLawyerWorkbench.test.tsx
pnpm --filter lawmind-desktop typecheck
```

### 第十七期 — 隐式意图编译

北极星：律师**丢材料或说一句话就能交办**。合同审查、诉讼状、函件、刑事、合规、并购等能力留在引擎里，默认不再让律师先选「办件」。

对照 Codex：catalog 隐式匹配 + 渐进披露 + 显式 `$skill` 覆盖。LawMind 额外用**确定性信号抽取**（文本动词 × 文件形态 × 案件/邮件语境）保证审查↔诉讼等致命误绑可测。

- [x] **P0 金标集**：`src/lawmind/intent/gold-set.ts` ≥50 条；致命对 `contract.review` ↔ `litigation.draft` 不得翻转。编译器自行择一，不再向律师提问分类。
- [x] **P1 隐式绑定默认**：`compileIntent` 为 SSOT；空态改为「直接说事」；对话无办件菜单、无改路由按钮。一行「本轮按××处理」仅作状态。
- [x] **P2 Catalog + 渐进披露**：未绑定时注入能力目录（8k 上限，不含邮件短路径）；已绑定仍只注入 1 份 Skill 正文。多意图写入 `chain` 并预填 2 步清单。
- [x] **P3 文件形态**：文件名 + 正文前段 peek（docx/pdf/txt）；诉状头压过正文里的「合同」；邮件短路径与指定 Word 改稿仍硬钉。
- [x] **P4 交件约束（能力正交）**：从自然语言抽取「意见书新文档 / 不改原稿 / 点名落点（桌面·下载·文稿）」。律师指定只要意见书时，去掉「必须红线才算完成」的默认，不冻结工具表；`render_document` 可写入点名的系统文件夹；会话同步输出意见。不是单句硬编码。
- [x] **跨对话检索（对照 Cursor / Codex）**：律师说「上周那个合同要点」「另一段对话里的改法」时，助手用 `search_conversations` / `read_conversation` 检索本机其他对话。「上周」作排序加分；命中可点开（`citeAs` / 过程条芯片，跨助手可打开）；空词不甩最近列表。⌘⇧O / `/chats` 搜侧栏。邮件短路径与指定 Word 改稿不因此冻结检索。
- [x] **Agent 对标 P0–P2（2026-09-15）**：系统提示不再教办件点选；`$skill` / `read_skill`；计划模式可改步骤后「开始执行」；非合同交件量规；XML 无修订轨不得显示已完成；真稿闸门无夹具则 skip。详见 [docs/LAWMIND-AGENT-PARITY-REVIEW.md](docs/LAWMIND-AGENT-PARITY-REVIEW.md)。
- [x] **步骤多少不打断律师（2026-09-17）**：软预算不再弹出「继续 / 先停在这里」。交办后默默办到交付；只有外发、改原稿等真授权才进「待我拍板」。硬顶只防空转，对话里接着办。对话线程不再堆过程芯片、短路径按钮或步骤拍板卡（过程在「在办」）。
- [ ] **对照实测（真稿）**：闸门与 sidecar 基线比对已就位（`fixtures/lawmind-true-manuscript/` 有真实 `.docx`/起诉状才跑，不以仓库内 NDA markdown 冒充）。仍须律师放入真稿后才会从 skip 变成比对。见第十五期。

```bash
pnpm exec vitest run src/lawmind/intent src/lawmind/drafts/paired-review-deliverable.test.ts \
  src/lawmind/drafts/redline-plan.test.ts src/lawmind/artifacts/default-output-location.test.ts \
  src/lawmind/platform/word-revision-instruction.test.ts \
  src/lawmind/skills/lawyer-capabilities.test.ts \
  src/lawmind/agent/turn-orchestrator-cassettes.test.ts \
  src/lawmind/agent/turn-orchestrator-prompt.test.ts \
  src/lawmind/agent/tools/disclosed-turn-tools.test.ts \
  src/lawmind/agent/conversation-search.test.ts \
  src/lawmind/agent/tools/legal/search-tools.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-records.test.ts \
  apps/lawmind-desktop/src/renderer/LawmindSideChatSessions.test.tsx \
  apps/lawmind-desktop/src/renderer/lawmind-session-link.test.ts \
  apps/lawmind-desktop/src/renderer/LawmindChatThoughtPanel.test.tsx \
  apps/lawmind-desktop/src/renderer/LawmindIntentStatusBar.test.tsx \
  apps/lawmind-desktop/src/renderer/lawmind-chat-compose-toolbar.test.tsx \
  apps/lawmind-desktop/src/renderer/LawmindChatEmptyGuide.test.tsx
pnpm --filter lawmind-desktop typecheck
```

### 第十六期 — 律师工作台与可配置标准

北极星：律师**打开 LawMind 就能完成当天工作**——看今日待办、跟案件与开庭、处理待回复邮件、整理谈话、按自己的标准审合同——不必再切邮箱、日历台账或自建 Excel。出稿仍在「对话」交办；待拍板仍在「在办」。

**为何要新界面**：对话适合交办出稿，办案台适合「这一案」的档案与任务。四类日常需求（今日闭环、合同/诉讼分门、自建标准、谈话收案）是跨案件、跨天的运营面，塞进对话会把交办变成待办清单，塞进单一案件页又看不到今天全局。因此一级导航增加 **工作台**，与对话、在办并列：

| 入口       | 律师用来做什么                                                        | 不在这里做       |
| ---------- | --------------------------------------------------------------------- | ---------------- |
| **对话**   | 交办、追问、出稿                                                      | 不堆今日清单     |
| **工作台** | 今日计划与完成态、待回复邮件、案件门类、期限/开庭、谈话整理、旧案对照 | 不直接出对外终稿 |
| **在办**   | 待拍板、办理进度、签批                                                | 不替代今日计划   |

设计原则（平台，不是某一家律所的 SOP）：

- **门类可配**：案件是合同 / 诉讼 / 其他；诉讼再记案号、法院、审级、诉讼地位、开庭日。缺字段不挡建案。
- **事件先确认再写入**：传票、12368 短信、答辩/举证期限抽出候选，律师点确认才进期限；daemon 按提前提醒窗口写入自动办件收件箱；日历用 ICS 导出，**不写飞书日历**。
- **标准是律师写的**：`lawmind/standards/` 可增删停用；审查自动套用、可撤销；红线学习默认关闭，确认后才启用。不是内置《民事案由规定》分类器。
- **谈话整理是办件**：粘贴谈话 → 需求 / 要件事实 / 候选案由 / 证据缺口；案由只从律师词表出候选，点采用才写入档案；旧案对照只提示案由与证据缺口，不把旧案事实写进本案。

- [x] **Matter 门类与卷宗**：`matterKind` + 可选 docket；办件第一屏升出诉讼文书与谈话整理。
- [x] **法律事件 → 期限**：抽取 → 确认写入；daemon 提前提醒；ICS 导出。
- [x] **今日工作环**：手写计划 + 邮件待回复 + 期限 + 待拍板聚合；计划可勾完成。
- [x] **接着昨天**：未勾完的律师手写计划在 14 天内挂回「要我处理」，勾完写原日 JSON，不复制待办。
- [x] **本案进展时间线**：卷宗概览只读聚合期限 / 来信 / 出稿 / 签批 / 谈话，不扫审计日志。
- [x] **材料 Tab**：`cases/<id>/materials` 按修改时间列目录（不扫 SHA）；协作副本从卷宗表单挪到材料页。
- [x] **本案当事人卡片**：卷宗概览展示角色 / 送达；`matter.json.parties` 与 `clientId`/`counterparty` 同源，伦理墙和冲突扫描读同一名称。不是律所 CRM。
- [x] **期限链 + 来源徽章**：可选单前置 `dependsOnDeadlineId`；完成前置才进今日/提醒（开庭不闸）；确认写入时上诉期可挂到同批或已有开庭；期限页显示来源与「等…完成」，律师仍可手动完成。ICS 含闸定期限。不写系统日历。
- [x] **邮件待回复**：摘要分类 `needs_reply`；自然语言仍走现有自动办件。
- [x] **用户标准库**：设置里 CRUD；审查按绑定自动套用；学习候选待确认。
- [x] **谈话整理 + 旧案对照**：IntakeBrief、案由词表、相似案件面板（事实隔离提示）。
- [x] **一级「工作台」**：顶栏「对话 | 工作台 | 在办」；设置中维护标准与案由词表。
- [ ] **对照实测（真稿）**：闸门已就位，夹具仍空，见第十五期。飞书日历写入、Outlook 全量客户端、国家案由规定全文分类器 **不做**。

```bash
pnpm exec vitest run src/lawmind/desk src/lawmind/practice/user-standards.test.ts \
  src/lawmind/application/services/deadline-service.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-lawyer-desk.test.ts \
  apps/lawmind-desktop/src/renderer/LawmindLawyerWorkbench.test.tsx \
  apps/lawmind-desktop/src/renderer/app/LawmindAppHeader.test.tsx
pnpm --filter lawmind-desktop typecheck
```

### 第十五期 — 外部法律能力普查与消化

目标不是收集少数知名项目，而是建立可重复运行的**广覆盖发现机制**，形成 LawMind 的外部能力供应链。

- [x] **多轴搜索**：按 Agent 载体（Cursor / Codex / Claude Code / Agent Skills / MCP）、法律工作类型、法律领域、交付格式和中英文关键词组合检索 GitHub。
- [x] **候选总表**：见 [docs/LAWMIND-EXTERNAL-LEGAL-CAPABILITY-CATALOG.md](docs/LAWMIND-EXTERNAL-LEGAL-CAPABILITY-CATALOG.md)。
- [x] **源码核验**：用仓库文件树区分厚包与 SKILL.md 空壳；ThomasMore 3,571 项中仅 18 项有 ≥5 个文件。
- [x] **能力地图与去重**：见 [docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md](docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md)。规范库约 70 个可执行单元；删除同名薄包和教学/空壳。
- [x] **消化队列**：该文档第六节按直接兼容 / 适配封装 / 方法借鉴 / 暂不采用列出；合同 copilot 为 NC，只借鉴结构。
- [x] **内在逻辑复审**：见 [docs/LAWMIND-SKILL-LOGIC-REQUIREMENTS.md](docs/LAWMIND-SKILL-LOGIC-REQUIREMENTS.md)。薄 Skill 当功能全集，原子 Skill 当推理指令集，厚包当 L0–L5 运行时语法。
- [x] **按开箱/质量/稳态重排**：见 [docs/LAWMIND-SKILL-THREE-LAWS-REVIEW.md](docs/LAWMIND-SKILL-THREE-LAWS-REVIEW.md)。确认、审核、审计、律师可见闸门退出主路径；P0 改为默认能力包、默认政策、推断、质量内核、计划脚本自检重试。
- [x] **持续更新**：查询词、截止日、枢纽仓库和许可证消化规则收在 `src/lawmind/skills/census/external-skill-census.ts`。`pnpm lawmind:skills:census` 离线打印增量查询；`--fetch` 在有 `gh` 时对照目录快照找新仓库。不预装数千条 SKILL.md。
- [x] **P1 质量内核（意见/计算/诉讼/检索）**：劳动与期限走 `calculate` 引擎；起诉状要素母版（线性栏目）；检索备忘正反类案+现行法条栏目；合同**意见**路径分层+推荐措辞。邮件短路径与指定目录 Word 改稿的工具表和导出规则未改。
- [x] **封闭 12 类合同路由**：意见/起草注入类型卡（买卖…公司投资，可双标签）；未知归服务类。邮件短路径与指定目录 Word 改稿不注入。
- [x] **交件对象分流**：对内底稿 / 客户 / 法院；邮件短路径与指定目录 Word 改稿不注入。
- [x] **可选执业口径**：工作区 `lawmind/practice-playbook.json`；缺文件用开箱默认，从不挡干活。律师在设置里改口径只影响**之后**的新任务，已生成草稿不自动重算。邮件短路径与指定目录 Word 改稿不注入该口径。
- [x] **交件契约对照（合成）**：钉住邮件短路径 Skill/工具表、Word 改稿仅 `contract-redline-craft` + `render_tracked_draft`、意见宏观/中观/微观+推荐措辞、起诉状线性栏目、劳动 `calculate` 金额、surgical 最短锚定。见 `src/lawmind/evaluation/skill-deliverable-contract.test.ts`。
- [x] **编译深度（非锁定路径）**：意见审查 lean 注入 1–2 份技能正文、改稿计划 sidecar、导出后 XML 修订自检（警告不挡导出）、口语→要件事实中间层、检索命题矩阵填栏目、己方纸/对方纸×买卖口径。邮件短路径与指定目录 Word 改稿的工具名与冻结包未改。不新增第一屏办件。
- [x] **编译深度续（效力 / 检索协议 / 成套 / 总控正则）**：废止法名（合同法等，不含劳动合同法）编进效力层级与引用核对。意见/检索/快问注入检索协议（先 `search_statute` 试检；无命中标【待核实】）。非锁定审查钉选 Word 时**默认**意见+修订稿（教练，不是完成硬条件）。办件 bind / 关键词路由 / 交付物类型共用 `capability-patterns`。邮件短路径与指定目录 Word 改稿不注入检索协议与成套交件。真稿对照仍开放。
- [x] **编译深度再续（成套基线 / 证据链 / 阶段）**：非锁定审查钉选 Word 时 `draft_document` 打上 `contractEdit` 基线并保留意见栏目；`apply_surgical_edits` 把意见快照后换成合同正文再落改。起诉状/证据目录从交办提取已点名证据（未点名写待补）。诉讼文首写推定阶段。XML 修订核对失败时给出收窄重试提示，不重导出、不挡邮件/Word。真稿对照仍开放。
- [x] **编译深度（引擎填槽）**：交办已给工龄/月工资/起算日时，劳动补偿与期限骨架直接跑规则引擎填金额和届满日；解除日在交办里时仲裁时效也算出届满日，不再写「请调用 calculate」。时间轴按交办日期线性列出（不用 markdown 表）。意见稿交件头写封闭类型，宏观/中观按 12 类检查单开写，并编进责任上限四个位置与破局条款；快问文首写分诊档但仍给结论。函件交办写了致/委托人则填进稿纸。不改邮件短路径与指定目录 Word。真稿对照仍开放。
- [x] **编译深度（运行时强制 + 填槽 IR）**：非锁定意见/检索在证据检查前自动用命题矩阵试检法规并合并来源；无命中软标【待核实】（不停工、不挡邮件/Word）。非锁定导出若 XML 无修订，引擎从锁定基线重建、收窄计划并重导一次。意见支持结构化 `contract_review_edits`，精确计划优先，正文正则仅兼容；`update_draft`/`execute_workflow` 同步写 `redline-plan`；非锁定 `apply_surgical_edits` 可回落 sidecar。劳动/期限/函件/起诉状/责任上限统一 CompileFill IR 并接入草稿路径。复杂 DOCX 页眉/页脚/表格/修订 XML/回读有合成端到端覆盖；engine-tools 与桌面 typecheck 基线全绿。不改邮件短路径与指定目录 Word。真稿对照仍开放。
- [x] **NDA 语料对照（仓库内）**：`fixtures/lawmind-review-matrix-nda10` 十份保密协议钉住知识产权类型、意见审查路径、推荐措辞、surgical 最短锚定。不是潘睿/copilot 真稿对照。
- [ ] **对照实测（真稿）**：闸门与 sidecar 基线比对已就位（`src/lawmind/evaluation/true-manuscript-gate.ts`）：无真实 `.docx` / 起诉状则 skip。用真实合同/起诉状对比潘睿红线、LawMind surgical edit 与 copilot 计划脚本；比的是交件能不能直接用、同任务是否同质量。仓库内 NDA 语料不能替代。
- [x] **P0 开箱能力包**：办件已配齐快问、审查、起草、检索、函件、诉讼文书、劳动计算、期限计算、时间轴、整理案卷、邮件合同、写材料。无配置也能跑；分层审查/要素/检索矩阵接到非锁定路径。邮件短路径与指定目录 Word 改稿的工具表和导出规则未改，仅收紧其注入 Skill，避免被新审查 Skill 带偏。
- [x] **P2 长尾（部分）**：刑事/破产、发票/法院短信、知产争议、并购尽调、数据合规、广告/产品合规（「更多」）、办案周报（LPM 进度/范围/RAID/置信/带日期下一步；结案备忘、本地顾问对接、办案资源计划、干系人沟通计划、待签发清单、协作建议走同一办件，不新增第一屏）、家事继承、资本市场核对、公司治理进「更多」。意见/检索稿带来源边界三栏与法源效力层级。证据目录按论证链。劳动计算含仲裁前置。民事上诉状/执行异议/立案材料清单不套起诉状。飞书云文档只读索引（可选、默认关闭，**不会写入**飞书云文档/日历/台账）。surgical 跨度过宽时引擎内收窄锚定后重试。真稿 vs 潘睿/copilot 仍开放。

### 第十四期 — 法律一致性编译器奠基（历史扫描 + lint + 北极星 · 2026-Q3，收尾）

> 计划全文：[docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md](docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md)（500 人天 / 12 个月）。  
> Phase 0 + Wave 2 + Wave 3 工程切片已落地（勾选细节见 `CHANGELOG.md` 第十四期）；**人/数据债见 14.11，不是 500 人天全部完成**。lint 通过 ≠ 法律正确。外发仍须签批。

- [x] **术语表同步**：律师可见面禁词由 `lawmind:ui-copy-lint` 机械拦截；`gate`/`门禁`/`推理图` 等工程师语言收敛为「核对/出稿检查/法律分析」；`docs/LAWMIND-TERMINOLOGY.md` 与 lint 脚本口径一致。
- [x] **架构文档刷新**：`docs/LAWMIND-ARCHITECTURE.md` 明确四层运行域（桌面壳/本地 API/引擎/交付与文档）、安全层、SSE 事件总线；原五层概念模型保留作为数据流理解。
- [x] **SSE 总线**：`/api/chat` 与 `/api/jobs/:id/stream` 已接入 SSE；设置页协作区使用有限并发 SSE（默认 2 路）并失败回退轮询。
- [x] **props 拆分**：在办/文书台/改稿等核心组件 props 进一步拆分（如 fleet desk view store、confirm dialog host、review workbench meta column），减少根组件传参面。
- [x] **出口代理**：外部网络请求经 `src/lawmind/platform/outbound-proxy.ts` 统一代理，按 `lawmind.policy.json` 的 `networkAllowlist` 显式放行，默认拒绝非本地明文。
- [x] **DSL 骨架**：`src/lawmind/clause/dsl.ts` + `ast.ts` 提供合同条款领域 AST；合同类交付物的机械核对会接入默认条款模式（起草中间件 / 审核台经 `deliverableType`）。
- [x] **指标补齐**：`src/lawmind/metrics/` 覆盖 runtime 事件、product 指标、team-growth dashboard、north-star 与 lint-escape 候选；Doctor「产品指标」与设置页可查看。
- [ ] **14.11 人/数据/凭证债（无法在仓库内「做完」）**：法律顾问抽审、真实 ≥10 已结案、LLM 评审人类校准 ≥80%、法宝/Lexis 联调、M4 生产流量指标、DOCX 修订回读

```bash
pnpm exec vitest run src/lawmind/lint src/lawmind/historical-scan src/lawmind/metrics/north-star.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-historical-scan.test.ts \
  apps/lawmind-desktop/server/lawmind-server-route-metrics.test.ts
pnpm --filter lawmind-desktop typecheck
```

### 历史期次索引

第一期至第十三期、平台级 Big-Bang 重构、参考项目 P0–P5、第十四期已完成切片（14.0–14.10、14.12）的勾选清单与验收命令，全部见 [`CHANGELOG.md`](CHANGELOG.md)「**历史期次归档（自 GOALS.md 移入）**」。

---

## 五、非目标与边界（简要）

以下为当前阶段**暂不纳入**的方向，作为路线图护栏：

- 将 LawMind 收窄为单一文书类型（例如“只做合同”）或纯聊天产品。
- 只因外部能力不是 LawMind 自研就拒绝采用，或在没有检索、运行和差距证据时重复造轮子。
- 不核验许可证、来源和代码就复制第三方实现；许可证记录服务于合法采用，不包装为产品价值。
- 用 Star 数、README 宣传或“支持法律”标签代替真实任务验证。
- 把日志、哈希链、回放、来源字段、审批步骤或“可审计”文案当作法律正确、交付质量或用户信任的证明。
- 在未获用户授权时执行对外发送、付款、提交法院/监管机构等不可逆操作。
- 引入与 **127.0.0.1 本地桌面 API** 安全模型不匹配的隐式远程控制面（除非单独设计并文档化）。
- 用**判断类硬控**（改点配额、句号即拒、关键词长度冻结写路径、禁止名单 spam）冒充交付质量或稳定性；判断类问题应由 Skill、量规与结果验证处理。

有强用户需求或明确合规背书时，可再评审调整。

---

## 六、参考

- 工程愿景入口：[VISION.md](VISION.md)
- **律师快速指南（非技术）**：[docs/LAWMIND-LAWYER-QUICKSTART.md](docs/LAWMIND-LAWYER-QUICKSTART.md)
- **术语表（一动作一词）**：[docs/LAWMIND-TERMINOLOGY.md](docs/LAWMIND-TERMINOLOGY.md)
- **LawMind 架构文档**：[docs/LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)
- **LawMind 文档站（VitePress）**：[apps/lawmind-docs/README.md](apps/lawmind-docs/README.md)（`pnpm lawmind:docs:dev` / `lawmind:docs:build`）
- **长期回看项**：[docs/LAWMIND-FUTURE-ISSUES.md](docs/LAWMIND-FUTURE-ISSUES.md)
- **Agent 对标审查（上手/智能/稳态/律师专用）**：[docs/LAWMIND-AGENT-PARITY-REVIEW.md](docs/LAWMIND-AGENT-PARITY-REVIEW.md)
- **对话补档案（第十八期）**：[docs/LAWMIND-CHAT-MATTER-FILL.md](docs/LAWMIND-CHAT-MATTER-FILL.md)
- **客户交付手册**：[docs/LAWMIND-DELIVERY.md](docs/LAWMIND-DELIVERY.md)
- **历史文档归档区（只读）**：[docs/archive/README.md](docs/archive/README.md)——愿景、决策、用户手册、桌面 UI 约定、Cursor/Claude 债表、Deliverable-First、安全清单、模型适配等历史快照均在归档区
- 仓库说明：[README.md](README.md) · 贡献：[CONTRIBUTING.md](CONTRIBUTING.md) · 安全：[SECURITY.md](SECURITY.md)

---

_最后更新：2026-09-19（第十九期：商业产品化冲刺，对标 Harvey；第十八期对话补档案真稿实测并入 P0-1）。_
