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

### 律师产品五条铁律（最高优先级 · 必须贯穿）

面向**执业律师**的一切产品与工程取舍，必须同时满足下列五条：

| #   | 铁律                 | 律师侧含义                                                                                                                   | 否决标准（一例）                                                                                |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | **上手简单**         | 少配置、少迷路；默认路径就能交办与跟进                                                                                       | 让 Day-1 / Solo 主路径变难 → 不做或收到次要入口                                                 |
| 2   | **交付结果质量高**   | 交件达到可直接使用的专业水准；在已配齐功能上把模型能力用满，尽量顶掉该任务上的律师一稿                                       | 只能产出待填摘要、不能改稿/计算/成套文书 → 不做主路径                                           |
| 3   | **交付结果稳定性高** | 同样交办结果不飘、流程不偶发翻车；失败可解释                                                                                 | 同任务结果更飘 / 更偶发 → 先修稳态再扩面                                                        |
| 4   | **先复用，后自研**   | 先检索并验证现有 Skill、插件、MCP、工具和工作流，再决定集成、改造或补缺                                                      | 未做外部检索和差距验证就新造同类能力 → 不立项                                                   |
| 5   | **发挥模型能力**     | 默认模型持续变强；尽力把判断交给模型。硬控只留给安全、空交付、明确授权和不可逆操作，不用不必要的硬控把能力掐死、把智能化做差 | 用禁止清单、字数配额、关键词硬拒或无安全理由的工具冻结限制模型判断 → 不立项，改成引导或结果验证 |

### Agent 引导原则（Cursor / Claude / Codex 级 · 贯穿工程）

本段是铁律 5 的工程落地。面向模型编排与工具控制时，用 Skill、原则、独立审稿量规、软教练和提案–接受发挥模型判断；覆盖率不得由写者给自己打分。**已配置的工具默认对本轮可用**：意图编译只去掉和律师指令相反的默认完成条件，落实点名落点与不覆盖原稿，不得为「走对流程」冻结工具表。只有具体安全风险、空交付、明确授权边界、跨度硬门禁或外部系统不可逆操作才使用硬拦截。不得用「禁止清单 / 字数配额 / 关键词硬拒」冒充质量或稳定。路径识别不得同时锁工具又注入相反协议。邮件短路径与明示「改这份 Word」只禁误发、模板重建原件和空修订；检索与对话说明默认仍可用。

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

- [ ] **P0-1 真稿对照必跑**：`--write-baseline` 基线生成器；闸门结果写 `lawmind/metrics/true-manuscript-report.json`；release-readiness 真稿章节；nightly 接线（无夹具诚实 SKIP 不红）。真稿由律师自行脱敏放入，工程侧不伪造。**工程侧已落地（2026-09-19）；闸门仍为诚实 SKIP——须律师把脱敏 `.docx/.pdf` 放入 `fixtures/lawmind-true-manuscript/` 后才会 RUN，故不勾。**
- [x] **P0-2 交件 lint 默认化（法律版 tsc）**：`renderDraft` / `render_tracked_draft` 机械 blocker 翻 `ok: false` 并收窄重试；邮件短路径意见稿文本纳入机械 lint（工具表冻结包不动）；NPC 可用时引用法条现行性试检（软标【待核实】）；cassette 断言 `lint_mechanical` 回灌。
- [x] **P0-3 法源默认可用**：NPC hybrid 默认开（`LAWMIND_OPEN_LAW_NPC=0` 才关）+ 端点节流；设置页 NPC 开关写 `.env.lawmind`；docx「参见」行带 url 时写超链接。断网/WAF 拒绝时诚实回退样本标演示语料。
- [x] **P1-A 案件上下文继承 + 可引用先例库**（对 Space / iManage）：结构化案件 fragment（当事人/未决期限/材料 top-N/时间线摘录，≤800 token）；旧案交付物入 knowledge_fts（`LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1` 才开）；`search_precedents` 工具；对照 Tab 可「引用到对话」。
- [x] **P1-B 材料 Vault 搜索与整理**（对 Agentic Vault）：`materials_fts`（trigram，mtime 增量）；`search_matter` 带 `{relPath,page}`；`GET /api/matters/:id/materials/search`；整理三件套 `propose_organize_plan` → 确认 → `execute_organize_plan` → `revert_desk_write` 新 kind `organize_files`（限 materials 围栏）。
- [x] **P1-C 审查表交付物**（对 Review Tables）：`review.table` 类型（尽调/证据/条款矩阵三模板）；`review_table_update` 批量改/分组/导元数据；文书台轻量表格编辑器；xlsx/docx 导出。
- [x] **P1-D 风格记忆闭环**（对 Harvey Memory）：文书台保存时改稿 delta → 候选 → 待确认；确认后写 LAWYER_PROFILE §八 + 可执行偏好；§八写侧轮转（消 FUTURE-ISSUES 挂账）。不确认零写入。
- [x] **P1-E 冷启动收尾**：钥匙验证完自动建演示案件 + 种子提示 + 可执行默认，不再弹首跑向导（可从设置重开）；修 `applyPostFirstrunPermissionDefaults` 忽略 `executable`。
- [ ] **P2-A 发行纪律**：tag 工作流接线 mac 签名/公证（`LAWMIND_REQUIRE_NOTARIZED=1`）与 win Authenticode（缺 secrets 诚实标红）；release-readiness 增公证状态 / latest*.yml / 真稿三项。证书为外部依赖。**接线已落地（2026-09-19）；本机仍为 adhoc 未公证包，须 Developer ID 证书 + secrets 后才满足「已签名安装包」验收，故不勾。**
- [x] **P2-B 离线许可（软门槛）**：`src/lawmind/license/`；`~/.lawmind/license.json`；ed25519 激活码 + 机器指纹；30 天试用到期只提醒不锁死；Doctor 许可区；SECURITY.md 补边界。不引入远程控制面。
- [x] **P2-C 交办成绩单 + 诊断包**：Doctor 律师可见成绩单（交办成功率/一次通过/lint 拦截/真稿趋势/法源状态）；`GET /api/support/bundle` 脱敏 zip（专测不含 key/secret）。
- [x] **P2-D 文档站发布**：`lawmind-docs.yml` 加 Pages deploy（main 推送）；CNAME 拷入 public；快速指南对齐新首跑流程（截图待真机补拍，诚实标注）。
- [x] **P3-1 首批 3 个 Skill 内化**：`contract-playbook-review`（Anthropic playbook，Apache-2.0，三档+己方/对方纸）；`matter.status` 补范围变更与预算（LPM）；`chronology.timeline` 两阶段预览确认（HoriZon/GCL）。每个带契约测试与出处记录。
- [x] **P3-2 消化流水线节奏化**：`docs/LAWMIND-CANONICAL-LEGAL-SKILLS.md` 第八节「消化记录 / 待消化」两表；`pnpm lawmind:skills:census --fetch` 的增量输出直接指向「待消化」登记格式；每期固定「本期消化 N 个（默认 3 个）」勾选项。

> 落地状态（2026-09-19 复核）：上表 12 项工程切片已随 `feat(p0-*)`…`feat(p3-*)` 提交并随工作树一并验收（`pnpm test` 4104 passed、双端 typecheck、五道门禁全绿）。仅 **P0-1**（待律师脱敏真稿）与 **P2-A**（待 Developer ID 证书）因外部输入未勾——这两项无代码可补，`lawmind:release-readiness` 已如实标红/标 SKIP。

### 第十九期 · 对标缺口补齐（Harvey / Legora / Spellbook 逐能力缺口）

依据：2026-09-19 逐能力缺口对照画布 `lawmind-harvey-gap-closure`（口径：同角色同域的四家闭源产品）。本组按「**交付前不让律师再介入**」的前提实施：新增能力不得引入逐格确认、逐条点击或轮中追问。

- [x] **缺口 P0-1 人类基准盲评**：`src/lawmind/evaluation/human-baseline.ts`（同题双稿、盲评量规、一条命令出分）+ CLI `pnpm lawmind:human-baseline` + Doctor 成绩单「人类基准」行。无夹具时诚实 `SKIP`/`INSUFFICIENT`，不假绿。**工程侧已落地；须律师把同题双稿放入基准集后才会 RUN。**
- [x] **缺口 P0-2 规模抽取**：`review_table_update` 新增 `extract_batch`（按材料并行、逐格 `source`/置信、抽不动写「无法判断（证据不足）」、只读 OCR 兜底）；`reviewTableAcceptanceProblems` 把「有值但无出处」定为缺口、「显式弃答」不算缺口；材料序按路径升序，同批材料两次跑出同一张表。
- [x] **缺口 P0-3 类案默认可用**：`src/lawmind/retrieval/case-law-readiness.ts` 探测本地类案索引（cncases/caseopen）现成状态、诚实降级指引（明说不会编造）；Doctor 增「类案」行；法宝等需凭据的源仍走显式开关。
- [x] **缺口 P1-1 Word 插件（就地审查）**：`apps/lawmind-desktop/resources/word-addin/`（清单模板 + 任务窗格）+ `/word-addin/*` 静态面与 `/api/word-addin/*` 数据面；渲染完成后自动回填结果，插件在 Word 里落成原生修订轨。**只走回环、不引远程控制面；无插件时桌面路径零影响**（见 [docs/lawmind/LAWMIND-WORD-ADDIN.md](docs/lawmind/LAWMIND-WORD-ADDIN.md)）。**须真机 Word 侧载实测。**
- [x] **缺口 P1-2 表格审核状态**：审查表逐行 `reviewed`/`locked`/指派，本地持久、零协同依赖；导出保留审阅状态摘要；批量重抽不覆盖已锁行。
- [x] **缺口 P1-3 跨文书一致改**：`apply_surgical_edits({ task_ids, edits })` ——**先全批预检再落笔**（任一份锚定过宽/多处命中未声明 `occurrences:"all"` 即整批停、零写入），命中 0 处的文书记入变更清单，逐份重新生成 Redline 提案并落 `drafts/<batchId>.cross-document.json` 变更清单。
- [x] **缺口 P1-4 审查表 → 文书**：`review_table_update ... to_draft` 把已核验结论与 `source` 直接推进文书正文（缺出处的行不入正文；未取得项单列「诚实标注，未作推断」）。
- [x] **缺口 P1-5 先例库术语自适应**：`search_precedents({ target_task_id, term_map })` 抽本文已定义术语表 → 确定性改写 → 剩余外来叫法以 `unmappedForeignTerms` 报出；落改时另报「本次新引入的外来当事人叫法」，一份文书里不许两套称谓。（「先例库显式开启」沿用 `LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1`，未开启时明示不可用。）
- [x] **缺口 P1-6 风格记忆闭环**：`planBatchAdoption`（纯读预览：写到哪、diff 多少）+ `adoptBatch`（确认后一次采纳多条，单条写入面抛错不掀整批）；`POST /api/memory/adoption/adopt-batch`（`dryRun` 默认 true，未确认零写入）；MemoryInspector「批量采纳风格项」含逐条前后差异。

```bash
pnpm test \
  && npx vitest run src/lawmind/evaluation/human-baseline.test.ts src/lawmind/deliverables \
     src/lawmind/retrieval/case-law-readiness.test.ts src/lawmind/agent/tools/engine \
     src/lawmind/integrations/word-addin src/lawmind/memory/batch-adoption.test.ts \
     apps/lawmind-desktop/server/lawmind-server-route-word-addin.test.ts \
     apps/lawmind-desktop/server/lawmind-server-word-addin-auth.test.ts \
     apps/lawmind-desktop/src/renderer/MemoryInspector.batch.test.tsx
pnpm --filter lawmind-desktop typecheck
```

### 第十九期 · 最短改动硬约束 + Word 一键就地改稿（2026-09-20 补记）

两条主线，都是「交付前不让律师再介入」的收口：

- [x] **最短改动升为全链路落槌硬约束**：判定改为**与长度无关**的一条——「一处改动里没动的字必须留在修订轨之外」；
      引擎按 (原文, 改后) **重算**成多处最短改动（锚点式：反复摘掉 ≥4 字的公共片段），而不是「find 太长就拒」。
      五个边界统一：模型输入（`apply_surgical_edits` 自动拆分，回执给 `minimalSplitEdits`）、hunk 生成
      （所有模式都出最短 span）、文件落盘（一处 hunk 展开成多段最短 op、从右到左落盘保证 lookbehind 锚点稳定）、
      Word 插件锚点、以及**成品复核**（读实际 `.docx` 的 `w:del`/`w:ins`，检出「整句删+整句增」即不当作已完成）。
      规则文本从 5 份拷贝收成一处；`surgical-span-gate` 降级为模型自查经验值。
      详见 [docs/lawmind/LAWMIND-MINIMAL-EDITS.md](docs/lawmind/LAWMIND-MINIMAL-EDITS.md)。
- [x] **Word 插件「审这份」→ 桌面端自动跑**（对「就地工作」）：取件即跑同一套
      `apply_surgical_edits` → `render_tracked_draft`，律师**不必再回桌面端点一次**；案卷不唯一就在
      Word 窗格下拉选定（`needs_matter`），文件被改过转 `stale`，卡住的运行由孤儿清理如实转 `failed`。
      取件写**授权留痕**（actorId / 文件 / 点击时内容指纹 / 授予的本机目录 / 案卷 / 时间），
      且只对工作区外文件临时授予源目录（仅本次运行）。开关 `wordAddinAutoRun`（solo 默认开，
      律所版默认关＝保留「桌面端必须有一次显式动作」的档位）。
      安全线复核过：`send_email` 仍机械暂停、`prepare_outbound_mail` 不在预批准名单、
      Word 回合内 `render_document` 被工具自身拒绝。详见
      [docs/lawmind/LAWMIND-WORD-ADDIN.md](docs/lawmind/LAWMIND-WORD-ADDIN.md)。
- [x] **交办即终稿（修订 Word 不再用审稿硬墙）**：`render_tracked_draft` 始终出本机 Word，疑问标进稿内
      【待核实】/修订痕迹，不经审核台放行、不因 Guardian 结论挡导出。`contractEdit` 稿本就不跑独立审稿。
      正式新建件 `render_document` 仍受引用/覆盖门禁；真正外发仍由 `send_email`（待发信 + 律师批准）把关。
      旧 policy 键 `guardianTrackedRedline` / 环境变量档位已忽略，不再恢复硬墙。

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

### 第十九期 · Doctor 设置页拆除（2026-09-26 补记）

上面各期条目里的「Doctor 许可区 / 成绩单 / 类案行 / 产品指标」指的是已拆除的「设置 → 系统健康」页，历史条目不改动。现状：成绩单数据仍在 `GET /api/health` 的 `doctor.scorecardRows`，诊断包端点 `GET /api/support/bundle` 仍在，唯 UI 入口已撤（待产品决定是否恢复）；排障入口改走 `pnpm lawmind:doctor` 与 `/api/health`。

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

### 第二十期 — 判断层编译器化（决策层自主化 · 2026-Q4）

> 调研：[docs/lawmind/LAWMIND-DECISION-LAYER.md](docs/lawmind/LAWMIND-DECISION-LAYER.md)（现状缺口 / Jev 调研 / 方案空间）。  
> 计划全文：[docs/lawmind/LAWMIND-DECISION-LAYER-PLAN.md](docs/lawmind/LAWMIND-DECISION-LAYER-PLAN.md)。  
> **一句话**：把 LLM 从「运行时判定器」降级为「编译期工具」——运行期该是「编译一次、执行多次、可回归验证」，不是「每次都重新推理」。承接第十四期的编译器，把范围从**文书一致性**扩到**判断层**。

前提（本文档写作时逐行核实）：判断层现在的缺口是**正则 / 一次完整 LLM 调用 / 哑字段**；而 `escape-candidates.jsonl` / `escape-corpus.jsonl` / `escape-stance.jsonl` 自第十四期起就在写盘——**但全仓没有任何一处读它们**（只有 `engine/reviewing.ts` 调 writer）。飞轮有写入端，没有读取端。

> **读这一期的约定（2026-09-21 复核时补记）**：`[x]` 表示**代码与测试已落地**，
> **不等于**「该能力已在真实数据上产出东西」。凡是需要真实办件数据才能出产物的
> （校准器、棘轮可升级项、分歧记录、材料通道观测、影子一致率），条目里会写明
> `⏳` / 「未达成」/「当前为零」。**不要把 `[x]` 读成「已验证可用」。**

- [x] **P0-1 决策语料导出器**：`src/lawmind/metrics/decision-samples.ts` —— 统一读取逃逸候选/语料/立场、product-events、runtime-events、quality 快照、`approvals.jsonl`，归一成 `decision-samples.jsonl`。**纯读取默认、缺样本诚实报 `present: false`、截断显式标注**（不编 0%）。CLI `pnpm lawmind:decision-samples`（`--dry-run` / `--json`）。
- [x] **P0-2 逃逸读取端**：`metrics/lint-escape-candidates.ts` 补 4 个 reader（`readEscapeCandidates` / `readEscapeCorpus` / `readEscapeStance` / `readLintEscapeFiles`）——此前只有 writer，飞轮写入端从未被消费。
- [x] **P0-3 数据体检报告**：`decision-samples-report.json`——各信号计数、来源覆盖、时间窗、正文片段统计、标签平衡、缺口自述。**首份实测结论见计划 §3.5：`escape-*.jsonl` 从未产生过任何记录，P1/P3 在真实办件数据之前无法起步。**
- [x] **P0-3b 落点屏蔽**：`.gitignore` 增 `workspace/lawmind/lint/`、`workspace/lawmind/decision/`、`workspace/rounds/`（运行时产物，真相源在代码）。
- [x] **P0-3c 影子演练跑通**：`scripts/lawmind/lawmind-round.ts`（`pnpm lawmind:round`）——跑**真实引擎链路**（plan → confirm → research → draft → review）产出首批真实逃逸数据。**实测结果：逃逸三文件首次有记录（各 2 行），决策语料 2 → 10 条，并首次出现 `rule_miss`；对照组（干净批准）确认零写入。** 详见计划 §3.7。
  - **同时修正了我自己写错的口径**：飞轮 lint 的是**改后稿**（律师提交的那版），所以 `lawyer_edit ≠ 编译器漏网`；它**看不见**「原稿有缺陷、提交前已改掉」那一类。已改正 + `escape-flywheel-semantics.test.ts`（7 例）锁定。
  - **实测出两条真实规则缺陷**：① `statutory.deposit_cap` **只认显式百分比**，合同只写金额（310,000 / 1,032,000 = 30.04%，超上限）时**静默放过**——最该拦的那条恰好抓不到；② `consistency.party_pair`（合同主体成对规则）会因信函**摘要**写了「乙方」而误报；且 linter 的输入是 `title + summary + heading + body` 全文。两条均**已固化证据、未修**（判据扩张需法律顾问验收，路线图 §1.5 铁律）。见 `lint/deposit-cap-coverage.test.ts`（5 例）。
- [x] **P0-4 方案 A 确定性收口**：四项全部落地。**4a `facts_grounded` 按实测证据否决了「升为 blocker」**（`facts` 在当前数据形状下恒为 0，升上去 = 所有 edition 必然拦截渲染），改为「补 IRAC 来源映射 + 可诊断 hint + 显式升级前提 + 反向回归测试」；4b 权威冲突改按「同主题 × 不同权威」判定，修掉「同源误报」与「不相关也漏报」；4c 特权提示改结构化评估（文本 × 受众 × 附件名，只加严不放松）；4d 条款类型三份漂移副本合并为 `clause/clause-type-keywords.ts`。详见计划 §3.6。
- [x] **G0 判据分级（`docs/lawmind/LAWMIND-DECISION-LAYER-PRODUCTION-PLAN.md` §3）**：给 150 个检查单项定「判定主体」（machine / judge / lawyer），把机械项从 LLM 手里拿回来。
  - **150 项完整分级表**（`guardian/item-judgments.ts`，machine 21 / lawyer 17 / judge 112），每项带 rationale；4 条覆盖率断言（含硬数字）**逼新增条项必须同时定级**。
  - **11 个机器验证器**（`guardian/machine-verifiers.ts`）——全是既有 lint 规则 / 门禁字段的**薄适配层**，零新依赖。每个验证器配「通过 / 未覆盖 / **不可用**」三条测试，共 43 条（11 × 3 + 顶层 2 + fail-closed 8）。
  - **三态门控**（`policy/judgment-tiering.ts`，默认 `shadow`）：`off` 等价改造前；`shadow` 双跑只记一致率（**零行为影响**）；`on` 时机械项不进提示词。支持**按验证器停用**（自动回滚，停用后其项**降回 judge**，不是失效放行）。
  - **实测修正两处计划数字**：清单实为 **150** 项（初稿写 135，漏计多行条目）；`citations` / `sources` **跨 spec 重名**，故判定表用 `<specId>/<itemId>` 复合键。**machine 占比实测 14%**（初稿假设 30%）——清单本质是「看/改/停」实质审查提示，机械化空间本就有限；**已删除 30% 这个门槛**，因为它会激励把主观项误标成 machine。
  - 顺带修复：`WordRevisionChecklistItem.lens`（法条依据）此前在构造检查项时**被丢弃**，模型判该类项时看不到对应法条。
- [x] **G1 分级 cassette + 两处静默漏洞修复**：
  - **cassette 断言「哪些项进提示词」**（`guardian/tiering-prompt.test.ts`，12 例）：off/shadow 下 machine 项仍在提示词（否则测不出一致率）；`on` 下不在、judge 项仍在；**验证器停用后该项回到提示词**。
  - **漏洞一（覆盖率）**：检查单 16 项截断发生在分级**之前**，`on` 模式会把名额浪费在永不进提示词的 machine 项上。改为**先摘机械项再截断**，名额回填给 judge 项（cassette 断言 `pr.force` 被回填）。
  - **漏洞二（静默丢失）**：`on` 模式下 lawyer 项本会离开提示词，但**升级卡片（G3）还不存在** → 它们将既不被判、也不进卡片。新增 `isLawyerEscalationAvailable()`（**默认 false**）闸住：升级通道未接通时 lawyer 项**继续由模型判**。理由：`LAWMIND-LEGAL-COMPILER-ROADMAP.md` §2.3 的「永不编译、只升级」**以升级这条路真的存在为前提**。
- [x] **G2 逐项结果落盘（部分）**：`guardian/item-outcome.ts` —— 把「哪一项、由谁判、判了什么」落成 `workspace/lawmind/decision/guardian-item-outcomes.jsonl`，喂给已存在但**从未被调用过**的 `delivery/judgement-ratchet.ts`。
  - **⚠️ 修掉一个会静默放行一切的严重缺陷**：`deriveFiredByTask` 原把 `cleanDelivery` 定义成「本任务没有任何项报项」，而棘轮只在「恰好一项报项 **且** cleanDelivery」时才计入误报——两者互斥，导致 `firedClean` **恒为 0**、`falsePositiveRate` **恒为 0**，于是**只要样本够、顾问已验收，每一项都会被判「可升 blocking」**。即把「从未观测到误报」当成「没有误报」。
  - **修正**：`cleanDelivery` **必须外生**（来自交付侧），本模块绝不自己推导；信号缺失的任务**整条不产出**——宁可让棘轮没数据，也不给假数据。
  - 新增 `countTasksAwaitingExternalSignal()`：让「信号没接通」可见，避免被误读成「规则质量还不够好」。
  - **⛔ 由此暴露一个阻塞项**：`UnescalatedDeliveryEvent`（计划 §4.2）仍未实现，所以棘轮**当前拿不到 cleanDeliveryByTask、无法产出任何可升级项**。这使 §4.2 从「重要」升级为**阻塞**。
- [x] **G2 收口 · 未升级交付的外生验收信号**（`metrics/unescalated-delivery.ts`）——阻塞项已解除，**棘轮从空转变成真的会转**。
  - 交付事件（`metrics/runtime-events.ts`）新增两字段：`interruptionReason`（SEAL 观察面：系统凭什么自己放行）+ `humanAcceptance`（外生信号）。由 `engine/rendering.ts` 在交付点计算（`resolveDeliverSignals()`，纯函数）。
  - **外生性是硬要求**：`reviewedBy` 以 `system:` 开头（自动交付）时一律 `unknown`——**系统给自己签的字不算验收**，那正是 SEAL（arXiv 2607.24300）要防的「判定器给自己判卷」。
  - **三态而非布尔**：`humanAcceptance` 保留 `unknown` 一档。律师还没审核时，当「不干净」会让每项被记成真报项（误报率虚低 → 乱升级），当「干净」则相反。**信号未到的任务整条不产出**。
  - **删掉初稿的 `judgmentSummary` / `itemSnapshot`**：交付点拿不到、别处（`guardian-item-outcomes.jsonl`）又有更细的真相源。**留一个填不上的字段就是本仓自己批评的「哑字段」**（决策层文档 §2.4）。
  - **`summarizeExternalSignalCoverage()`** 回答一个在 Doctor 上看起来一样、处置却完全不同的问题：**「棘轮没有可升级项，是规则质量不够，还是信号通路没接通？」**（`decidedRatio` 为 `0` 是有交付但全不可判，`null` 是连交付都没有——`0 ≠ null`）。
  - 端到端测试锁定三种结局：缺信号 → 不产出；信号齐但误报超限 → `false_positive_rate_above_cap` **不升**（回归上述缺陷）；信号齐 + 样本够 + 顾问已验收 + 零误报 → **`promotable: true`**。
- [x] **G3 论证结构保证 + 升级通道三层（`docs/lawmind/LAWMIND-DECISION-LAYER-PRODUCTION-PLAN.md` §5 / §6）**：把「结构保证」与「只升级」两条口径都落成可用的东西。
  - **论证结构五条**（`deliverables/reasoning-validator.ts` 的 `reasoningStructureChecks`）：争点有依据 / 论证矩阵可追溯 / 权威在正文被引用 / IRAC 三级齐 / 无未决问题。全部是图上集合运算，**不给正确性判断**（对应 `Closing the Loop` 的分层：计算性部分给可证明正确性，open-textured 部分给结构保证）。**一律 warning**，advisory 先行。
  - **覆盖不完整可自述**：`ReasoningReport.skippedChecks`（新字段）。拿不到正文引用时**记 skipped 而不是判通过**——「没核对」不得显示成「核对通过」。图都没有时标 `structure:*`。
  - **升级通道**（引擎）：`buildJudgmentEscalationAction` + 新 kind `judgment_escalation`；`platform/judgment-escalation.ts` 从 Guardian sidecar 读待定夺项。**这是 `isLawyerEscalationAvailable()` 存在的前提**——主观项「不判，只升级」必须有升级的去处。
  - **三 edition 姿态**：`resolveEscalationPosture` —— solo → `advisory`（打断成本高，先让他看见）；firm / private_deploy → `block`（口径不一致必须确认）。未知取值按所在 edition 缺省处理。**通道开关与 edition 解耦**：判定主体必须跨 edition 一致，否则战绩序列不是同一个东西。
  - **API 四条路由**（`server/lawmind-server-route-judgment.ts`）：`/api/judgment/{summary,task,escalations,tiering}`。**待定夺项在 API 层剥掉内部 id**（`itemKey` 不进律师面字段），并有一条专门断言。
  - **UI 两个组件 + 决策头扩展**：`LawmindJudgmentEscalationCard` / `LawmindJudgmentItemsPanel` / `LawmindDecisionHeader` 覆盖行。加载、空、错误三态齐；**读失败说「读不到」而不是「暂无事项」**——故障与「没有」必须区分。
  - **标签从既有检查单派生**（`delivery/judgment-labels.ts`）：不手写 150 条，避免重演 P0-4d 的复制漂移。
  - **修掉两个自造缺陷**：① `lawyer` 项排除未按 mode 收口，升级通道一开会在 shadow 期偷走主观项（静默行为改变），已补 `mode === "on"` 前置 + off/shadow 两条回归；② `store.stripRaw` 是白名单式的，`escalationItems` 不进白名单会静默丢失，已补 + 专门回归。
  - **收尾接线 + 真实回合 cassette**：卡片在 `agent/turn-orchestrator-finalize.ts` 里并入 `requiresAction`（通道开 + 姿态 `block` 才并；`advisory` 时不打断）。给测试台补了 `linkedTaskId` 才能让 cassette 走到这条生产路径——**不补就等于没测**。4 例 cassette 断言回合结束后律师真的会看到这张卡。
  - **测试**：结构检查 21 条、升级通道 12 条、三 edition 姿态 9 条、API 8 条、UI 9 条、真实回合 cassette 4 条。`pnpm lawmind:ui-copy-lint` 与 `lawmind:check:renderer-node` 通过。
  - **⚠️ 两处欠账（已于 2026-09-21 补齐，见下一条）**：① 真机 Electron e2e 未跑；② `advisory`（solo 缺省）下卡片不进 `requiresAction`，solo 看不到这张卡。
- [x] **G3 欠账补齐：待定夺项的旁路展示 + 真机 Electron e2e**（2026-09-21）
  - **补齐时发现真正的问题比原记录更严重**：那张卡**在应用里根本没有挂载点**（只在单测里被渲染过）。所以第 ② 条不是「solo 看不到」，而是**谁都看不到**——正是本仓反复批评的「实现了但没接线」。
  - **旁路展示**（`LawmindJudgmentEscalationCard` 新增 `variant`）：`block` 姿态下引擎把卡并进 `requiresAction`、在对话里停下等确认；`advisory`（单人执业缺省）**刻意不打断**，于是必须有第二个展示点——挂在**改稿台**（`ReviewWorkbenchMetaColumn`，决策头之后），那正是律师要签批、要看见「还有哪几处没定」的地方。
    - `inline` 形态：**没有待定夺项时整块不出现**（不给每份稿子加噪声），**但读不到时照样出声**——故障不得冒充「没有」。
    - 文案随姿态变：`advisory` 说「不打断当前流程」，`block` 说「不会替您选一条路继续」。**姿态由服务端给**（`/api/judgment/{task,escalations}` 新增 `escalationChannel` / `escalationPosture`，与引擎同源），界面不自己推断；服务端没给或取值写坏时按 `block` 说（保守，不让律师以为无人处理）。
  - **真机 Electron e2e**（`e2e/judgment-escalation-electron.spec.ts`）：往工作区写**真实形状**的 Guardian sidecar → 真实本地服务 → 真实路由 → 界面，断言卡片内容、姿态与「内部判定表键不进律师面」。**这是引擎→路由→界面整条链的准入测试**；stub 套件测的是 mock 自己的 JSON，链上任何一段断掉它都照样绿。
  - **PR 套件 e2e**（`e2e/judgment-escalation.spec.ts`，已加入 `lawmind:desktop:e2e:pr`）：四态 advisory / block / 空 / 读不到；新增两个 mock 开关（`POST /__e2e__/judgment`，缺省 `empty` 不污染既有 spec）。
  - **变异验证**：把挂载点注释掉后，真机用例确实失败（`toBeVisible` 超时）——证明它测的是接线，不是组件自身的渲染能力。单测另加「审核台**真的挂了**这张卡」三例，防的正是「组件写好了、没人挂」。
  - **顺带修正两处测试基建**：① `fetchApi` 对 5xx 会指数退避重试，用它当「读不到」的刺激会看起来像「没反应」（测试假象），mock 与单测改用**不可重试的 404**；② 真机 spec 不进默认（浏览器）套件（需先 bundle server + build renderer，属 electron 作业）。
  - 已知既有失败（与本次无关、不在 PR 门禁列表内）：`e2e/review-campaign.spec.ts`——移除本次挂载后同样失败。
- [x] **P1 飞轮接线（方向已修正：素材而非闸）**：新增 `learning/edit-examples.ts` —— 把律师改稿的 **(改前, 改后) 完整对照**存为可检索范例，接进**既有的**范例注入通道（`golden-recall` 同权打分 → `memory_hit`）。**这修正了原计划的方向**：原 P1 是「攒样本编译规则（加闸）」，实测后改为「攒**范例对**（加素材）」——详见计划 §3.8。
  - 与 `golden/` **分开存**：那是「律师判定为典范」，这是「律师动过手」（很多改稿在修缺陷，不是示范）。
  - **存得宽、注入得省**（存 600 字/侧、注入 220 字/侧）。实测：首版 600 字原样入 prompt 会在块中间被截断，把「律师说明」（最值钱的「为什么改」）挤掉；修法含**把最短最值钱的字段放最前面**。
  - **只加不改**：原偏好通道（≤160 字 → 待确认 → `LAWYER_PROFILE`）完全未动。
  - **素材不是闸**：注入文案有测试断言**不得出现**「必须 / 一律 / 禁止 / 不得」；检索不到则整块不注入；写入失败不得影响偏好通道返回值。
  - 端到端有断言：范例块**真的进到 `prepareTurnPromptContext` 的产物里**（只测「写盘成功」不够——本轮教训正是「数据在盘上、没人读」）。
- [x] **P4 降级说明**：棘轮（advisory → blocking）是「**加闸**」机制，与 §3.8 的方向相反，优先级**下调**。判定逻辑与测试保留（它防的是「靠橡皮图章解锁」），但不再作为主线推进。
- [x] **第二类「该算的算好，喂给模型」**：`reasoning/derived-facts.ts` —— 判断层三类里的**第二类**。起因：真实合同的定金超限只写**金额**（310,000 / 1,032,000 = 30.04%）不写百分比，`statutory.deposit_cap` **静默放过**；而模型不擅长算术（它在猜 token，不在做除法）。于是把**占比与法定上限算好**作为素材喂给模型，模型只负责判断怎么处理。**它同时解决盲区与误报**（不加新规则、不需顾问验收、模型升级后自动升值）。
  - **三条硬约束**：① **事实不是结论**（只说数字与出处，测试断言产出里不得出现「违反/无效/必须/不产生定金效力」）；② **必须给算式**（`arithmetic` 字段——这是「素材」与「神谕」的分界，让模型能复核而非照抄）；③ **算不出来就什么都不说**（找不到「合同总价款/标的额」标记时不猜——猜错的权威数字比没有更糟）。
  - **与门禁无关**：只作 `memory_hit` 素材，不进任何门禁；异常一律吞掉；永不抛。
  - 端到端断言：算好的事实**真的进到 `prepareTurnPromptContext` 的产物里**（含算式与出处）。详见计划 §3.8.6。
- [x] **第二类扩展为四类事实**（§3.8.7）：`deliverable_scope`（交付物体裁，解「合同类规则用在信函上」的困惑）、`deposit_cap_ratio`、`payment_sum`（**实测在本仓 fixture 上抓到「付款合计比总价多 400 元」**）、`penalty_asymmetry`（**只述可比性，不判「不公平」**——基数不同比倍数没有意义）。
  - **四个实测 bug 已修并由测试锁定**：① 章节标题先命中标记导致真实条款读不到；② 算式比值精度不足（`0.3` vs `30.04%` 自相矛盾）；③ 标签跨句错误归属（`722,400` 被贴上不存在的名目）；④ `contract.review` 按前缀归成「合同文本」（它是**审查意见书**，按前缀会给出**相反**提示）。
  - **prompt 预算**：块约 445 tokens 而 `memory_hit` 默认只给 200 → 显式放宽 `capTokens` 并把优先级设为 45（**在 memory hit 之间事实优先**，但不挤占 protocol/skill/craft）。新开风险 **D10**（素材通道争抢预算）。
  - **⚠️ 修掉一处静默截断（2026-09-21 复核发现）**：`collectDerivedFacts` 的默认 `limit` 曾是 **4**，而 `COMPUTERS` 顺序即优先级 → 生产装载路径（`loadDerivedFactsForMatter` 不传 `limit`）**永远只看得到前 4 类**，排在后面的 `payment_ratio_sum` / `limitation_deadline` / `deadline` / `penalty_asymmetry` 在真实回合里**从未出现过**（文档却写「已闭环到 prompt」）。已把默认改为**不按条数截断**，条数上限只在调用方显式传入时生效；真正的截断点是渲染器字符预算——它**整条取舍并写明还剩几条**（可见）。回归：`derived-facts.test.ts` 新增「生产装载路径不得按条数静默截断」3 例 + `edit-examples-prompt.test.ts` 断言尾部类事实（`payment_ratio_sum`）真的进 `prepareTurnPromptContext` 产物。
- [x] **第二类补齐为七类事实 + D10 收口**（§3.8.8）：
  - 新增三类**纯算术/一致性**事实：`unit_price_times_quantity`（单价 × 数量 vs 标的额）、`total_inconsistent`（同一标记多个值）、`payment_ratio_sum`（比例合计 vs 100%）。`limit` 的截断顺序＝注册顺序（顺序即优先级）。
  - **明确不做 4×LPR**：`statute-params.ts` 自己写明「LPR 序列未入库」→ 没有值就算不出上限，按第 3 条硬约束不做（有测试断言它不会被误产出）。
  - **D10 收口**：新增 `agent/material-blocks.ts` —— 三个素材通道（派生事实 / 改稿范例 / 黄金范例）从「各自 queue、各自被截」改为**一个受预算约束的片段**，**整块取舍**、丢弃**具名说明**、复用 `memory_hit`（不新造预算类别）、优先级 45。
  - **又抓到四处误报，根因相同**（「标记后 N 字」窗口跨句）：收敛为三个句子级原语 `sentenceAfter` / `sentenceAround` / `sentenceBefore`，取值/判语境/取名目各用其一；并把「违约金费率」「容差」用纯事实的**语境闸**排除（而非语义猜测）。
- [x] **第二类再补两类日期事实 + D10 可观测收口**（§3.8.10）：
  - `deadline`（显式日期 + 紧随期间 → 到期日，按民法期间规则**夹取月末日**：1月31日 + 1月 = 2月28日）与 `limitation_deadline`（诉讼时效届满日 = 起算日 + 3 年，期间值取自 `DEFAULT_LIMITATION` / 民法典第188条，**不硬编码**）。
  - **两条"算不出来就不说"的边界**：**工作日不折算**（需节假日表，本仓没有）；**无显式日期不产出**（「收到本函之日起十日内」没有起点）。**日期遮蔽是必需的**——否则 `2026 年 11 月 30 日前` 会被读成「11 个月」+「30 日」，算出不存在的期限。
  - **D10 收口**：`summarizeMaterialBlockHealth()` —— 丢弃**可测**，不只写在 prompt 文案里（此前律师看得见、系统看不见，无法回答「某通道是不是长期被丢」）。口径：`presentCount = 纳入 + 丢弃`（本来没内容不进分母）；`dropRate` 在零样本时为 `null` 不编造 0%；`worstChannel` 需样本 ≥ 5。新增产品指标 kind `material_block`。端到端断言**走真实 `prepareTurnPromptContext` 之后**指标确实落盘。
- [x] **P2 约束与分歧**：2.1 strict JSON schema（`llm/json-schema-capability.ts`，**默认行为零变化**——白名单为空、`auto` 只对已核实端点启用；`on` 时 400 拒绝则同调用内降级并记入进程缓存）；2.2 Guardian 改「逐项判定 + 代码聚合 verdict」（`aggregateGuardianItems`，缺答即 fail、编造项即 fail，旧 `{verdict,gaps}` 形状仍兼容）；2.3 三路径分歧 shadow（`router/route-divergence.ts`，零额外调用：关键词/模型/分诊都是白拿的）；2.4 分歧 → 升级（默认 `shadow` 只记录；`escalate` 时经既有 `requiresConfirmation` 通道升级，不新造卡片类型）。详见计划 §5.5。
- [x] **P3 自拟合校准**：`metrics/firm-calibrator.ts` —— 特征抽取 + 标签派生 + 确定性 logistic 拟合（同数据两次拟合结果完全一致）+ **冷启动诚实拒绝**（门槛 40 条 / 每类 ≥ 5，未达标不产出且 `predict` 返回 `undefined`，不给「大概 0.5」）+ 偏置声明写进产物。**机器已建好；在本仓产出可用校准器仍未达成**（当前仅 1 条可用样本），与 P1 卡在同一处。详见计划 §6.5。
- [x] **P4 棘轮推广（已实现，但方向下调）**：`delivery/judgement-ratchet.ts` —— 把「测量换信任」从**交付**扩到**判断项**（纯函数，故「退化自动回锁」是结构性的）。升级判据选 **precision 而非 recall**（升 blocking 后误报会挡住律师的路，危害结构翻转）；三条不变量与 `isAutonomyUnlocked` 逐条对应，其中**一处有意差异**（交付侧空序列也拒，判断侧空序列是合法战绩、`null` 才是缺数据）；多加硬前提 `advisorAccepted`（顾问未验收一律拒，优先于统计）。归因保守：只在某项**独占**该任务报项时才计入其误报（宁可少算不要算错）。详见计划 §7.5。
  - ⚠️ **但方向已按 §3.8 下调**：棘轮的本职是「让判断项获得拦停权」，即**加闸**——与「管道该修成素材」相反。逻辑与测试保留（它防的是「靠橡皮图章解锁硬闸」这件事本身仍然值得防），但**不再作为主线**。主线改为 P1 的范例通道。
- [x] **P5 外部判定器（仅当第三票）**：`models/decision-model.ts` —— **端口**而非「接入 Jev」（需要的是「异质第三方判定者」这个能力，不是 TypeSafe 这个供应商）。四条硬约束有测试锁定：① 默认 `off`，**不存在「配了 key 就自动开」**；② **`egressMode: offline` 一票否决**（在读取任何其他配置之前判定，且**刻意不沿用**「模型 API 不受 egressMode 约束」的既有豁免）；③ 凭据不全不产出半配置端口；④ 不可用时返回 `undefined`，不编造。**未接进任何判定路径**——P2.3 的分歧数据还没有，在拿到它之前接入等于把可测量的缺口换成不可测量的第三方承诺。详见计划 §8.5。

> 边界：**编译器有覆盖率天花板**（承接第十四期 R7），覆盖不了主观裁量——主观项永不编译、只升级给律师。规则必须有法律顾问验收（_Wrong params are worse than no lint_）。lint 通过 ≠ 法律正确（`src/lawmind/lint/types.ts:3`）。

```bash
pnpm exec vitest run src/lawmind/metrics src/lawmind/clause src/lawmind/stance \
  src/lawmind/reasoning src/lawmind/deliverables src/lawmind/policy src/lawmind/router \
  src/lawmind/llm src/lawmind/guardian src/lawmind/delivery src/lawmind/models \
  src/lawmind/runtime/legal-verify-middleware.test.ts
pnpm lawmind:decision-samples -- --dry-run            # 空工作区必须诚实报缺，不报 0
pnpm --filter lawmind-desktop typecheck
```

> 环境开关（P2 / P4 / P5）：
>
> - `LAWMIND_LLM_JSON_SCHEMA=auto|on|off` —— strict JSON schema 能力判定（默认 `auto`，白名单为空 → 行为与升级前一致）
> - `LAWMIND_ROUTE_DIVERGENCE=0` —— 关闭三路径分歧 shadow（**主开关**）
> - `LAWMIND_ROUTE_DIVERGENCE_POSTURE=off|shadow|escalate` —— 分歧姿态（默认 `shadow`：只记录不改行为）
> - `LAWMIND_DECISION_MODEL_MODE=off|shadow|on` —— 外部判定器（**默认 `off`**；`egressMode: offline` 时无条件不可用）
> - `LAWMIND_DECISION_MODEL_{BASE_URL,API_KEY,ID,TIMEOUT_MS}` —— 外部判定器凭据（四项齐全才可用）
> - policy `judgementPromotion: { minSamples, maxFalsePositiveRate }` —— P4 升级门槛（默认 20 / 0.10）

### 试点测量协议（预注册 · 2026-09-22）

**在看任何试点数据之前**写定；全文：[docs/lawmind/LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md](docs/lawmind/LAWMIND-PILOT-MEASUREMENT-PROTOCOL.md)。

- **三条判据**：一次通过率（**升**是好）／机械核对逃逸率（**降**是好）／改稿幅度中位（**降**是好）。
  口径到函数级：`src/lawmind/metrics/north-star-trend.ts`（21 例，含诚实约束）。
- **样本门槛**：单周 ≥5 次交付才报比率（否则 `null`，不编 0%）；改稿幅度需**每个可用周都有样本**才进结论；
  **≥4 个可用周**才给方向，否则明说「暂不判断」。
- **投票规则**：三项全改善→`improving`、全恶化→`worsening`、全未动→`flat`、有分歧→`mixed`。
  **`mixed` 必须原样报出**，不许挑好看的那一项。
- **口径冻结清单**：观测期内不得改动（趋势口径／north-star v2／判定主体解析／edition 默认值／lint 规则集）；
  确需改时追加版本号并标注「此前序列不可比」。
- **预先承诺的动作**：`improving` 继续投判断层与素材层；`flat` **不追加功能**、先查「是不是没用起来」；
  `worsening` **冻结新功能**查回归；样本不足 → 结论是「证据不足」而非「没变差」。
- **明确不做**：跨所横比、行业基准推断、显著性检验、拿单周升降当结论、用「一次通过率」宣称法律正确性。
- **复算**：`pnpm lawmind:north-star-trend -- --workspace <dir> [--window 90]`
  （退出码恒 0 ——「样本不足」是结论，不是错误）。

> 为什么写这一节：**数据到手后再定口径 = 事后挑口径**，且「没用」这个结论必须**能被得出** ——
> 否则后面先做哪个功能只能靠感觉。观测窗口 ≥ 8 周（其中 ≥ 4 周达到样本门槛）。

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

_最后更新：2026-09-20（第十九期补记：对标缺口补齐 P0-1/P0-2/P0-3 与 P1-1…P1-6；人类基准与 Word 插件待外部输入/真机验证）。_
