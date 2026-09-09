# Changelog (LawMind)

All notable changes to this **LawMind-only** repository are tracked here.

Historical **OpenClaw** upstream release notes were removed when the repository was slimmed to LawMind (engine + desktop + docs). For archeology, refer to the former upstream project history if you still have access.

## Unreleased

### Changes

- Desktop：永久防白屏——渲染进程禁止拉取 `node:fs/path/crypto`（执业口径/改稿条/可执行偏好拆成浏览器安全叶子）；根级 ErrorBoundary + 启动兜底文案；Electron `did-fail-load` / `render-process-gone` 自动重载；CI `lawmind:check:renderer-node`。
- Desktop / Engine（律师工作台）：一级导航增加「工作台」（对话 | 工作台 | 在办）。今日计划、案件门类、期限确认写入、谈话整理与用户标准库进入日常路径；出稿仍在对话，待拍板仍在在办。不写飞书日历。
- Engine / Desktop（技能消化 · 稳态加固）：补复杂 DOCX（页眉/页脚/表格/修订 XML/回读）测试；修复工作台案件侧栏类型分支与 MCP 测试 DOM 类型；force_render / 律师显式接受占位符时同步旁路 citation strict，避免测试/demo 仍被第二道门禁误拦。桌面 typecheck 与 engine-tools 基线恢复全绿。
- Engine（技能消化 · 运行时强制完善）：非锁定意见/检索路径在证据检查前自动用命题矩阵跑一次法规试检并合并来源；无命中继续交付并标【待核实】。合同意见支持结构化 `contract_review_edits`，精确计划优先、正文正则仅兼容。CompileFill adapters 已接入实际草稿路径。XML 重试改从锁定基线重建，不在已替换正文重复找原文。邮件/指定目录 Word 仍跳过。
- Engine（技能消化 · 运行时强制收尾）：`update_draft` / `execute_workflow` 亦把意见推荐措辞写入 redline-plan；非锁定 `apply_surgical_edits` 可省略 edits 回落 sidecar。起诉状/责任上限进入 CompileFill adapter。不改邮件短路径与指定目录 Word 工具表。
- Engine（技能消化 · 运行时强制 + 填槽 IR）：非锁定路径写条号前若本回合未试检 `search_statute`/`search_case_law`，出稿结果软标【待核实】（邮件/指定目录 Word 不标）。XML 未见修订时引擎收窄计划并重导一次。意见「推荐措辞」可解析对编译进 redline-plan。劳动/期限/函件抽槽收成 CompileFill IR。不改邮件短路径与指定目录 Word 工具表。
- Engine（技能消化 · 引擎填槽）：交办已给数字时劳动补偿/期限骨架直接跑规则引擎；解除日在交办里时仲裁时效也算出届满日。时间轴按日期线性列出。意见稿交件头写封闭类型，宏观/中观按 12 类检查单开写，并编进责任上限四位置与破局条款；快问文首写分诊档仍给结论。函件交办写了致/委托人则填进稿纸。不改邮件短路径与指定目录 Word 工具表。
- Engine（技能消化 · 编译深度再续）：非锁定审查钉选 Word 时意见稿打上原合同基线；`apply_surgical_edits` 快照意见后再对合同正文落改。起诉状/证据目录按交办点名证据填论证链（未点名写待补）。诉讼文首写推定阶段。导出 XML 未见修订时给收窄重试提示，不重跑导出。不改邮件短路径与指定目录 Word 工具表。
- Engine（技能消化 · 编译深度续）：废止法名编进效力层级与引用核对（不误伤劳动合同法）。意见/检索/快问注入检索协议：写条号前先试检。非锁定审查钉选 Word 时完成=意见+红线。bind/路由/交付物类型共用一份场景正则。不改邮件短路径与指定目录 Word 工具表。
- Engine（技能消化 · 编译深度）：非锁定合同审查走改稿计划 sidecar → `apply_surgical_edits` → `render_tracked_draft`，导出后核对 `w:ins`/`w:del`（警告不挡导出）。绑定后只注入本阶段 1–2 份技能正文，其余当索引。口语叙事编译成要件事实后再填起诉状/意见/快问。检索备忘填命题矩阵（先试检）；意见路径披露 `search_case_law`。意见/起草注入己方纸·对方纸与买卖口径。邮件短路径与指定目录 Word 改稿的工具表未改。不新增第一屏办件。真稿 vs 潘睿/copilot 仍开放。
- Engine / Desktop（技能消化 · 封闭类型 + 交件对象 + 家事/资本市场/治理）：意见/起草注入封闭 12 类合同路由与对内/客户/法院交件对象；家事继承、资本市场核对、公司治理进办件「更多」（薄路由，不碰邮件短路径与指定目录 Word 改稿）。意见/检索稿带来源边界三栏。仓库内 NDA 十份语料钉住知识产权类型与意见骨架。真稿 vs 潘睿/copilot 仍开放。
- Engine（LPM 运营字段 + 场景交件栏）：办案周报/范围变更/结案备忘按进度、RAID、置信、带日期下一步出稿；家事/资本/治理交件栏加厚。`apply_surgical_edits` 跨度过宽时内部收窄到最短差异再落改。不新增第一屏办件。
- Engine / Desktop（飞书只读 + 诉讼劳动检索交件）：飞书云文档进入 integrations 目录（可选、默认关闭，只读、不写云文档/日历）。证据目录与起诉状证据对照接论证链；劳动计算写仲裁前置；检索备忘写效力层级；取保/债权申报不套民事起诉状。
- Engine（LPM 本地顾问 / 资源 / 沟通）：本地顾问对接、办案人力安排、干系人沟通计划并进「办案周报」办件，直接出内部骨架；沟通计划先出邮件口径，飞书/日历写入不是交件。家事加财产栏、资本加披露时点。不新增第一屏办件。
- Engine / Desktop（广告产品合规 + 民事阶段 + 签发/协作）：广告/产品合规进办件「更多」。上诉状、执行异议、立案材料清单走诉讼文书交件栏，不套起诉状。待签发清单和协作建议并进办案周报（清单不是审批页；协作默认邮件和本地目录）。
- Docs / Terminology / Architecture：同步 UI 文案与术语表，`lawmind:ui-copy-lint` 新增 `gate`/`门禁`/`推理图` 禁词；renderer 与 server 侧错误消息收敛为「核对/出稿检查/法律分析」；刷新 `LAWMIND-ARCHITECTURE.md`、GOALS、律师快速指南、REPO-LAYOUT。
- Engine / Desktop（第十四期切片文档口径对齐）：出口代理 `src/lawmind/platform/outbound-proxy.ts`、clause DSL 骨架 `src/lawmind/clause/dsl.ts`、metrics 补齐 `src/lawmind/metrics/`、SSE jobs stream 与设置页有限并发刷新已接入并文档化。
- Desktop：props 拆分继续——fleet desk view store、confirm dialog host、review workbench meta column 等组件进一步解耦。
- Engine / Desktop（法律一致性编译器 Wave 2）：增量历史扫描；lint ≥20 条 + 买卖/借款族 + 引用有效性骨架；定金超限只出建议不代改；分级交付/渐进自主函数（外发永不自动）；决策头；升级卡建议；红线立场库；合成影子 replay；审阅时长与 lint 逃逸写侧。计划：`docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md`。500 人天的人/数据债未清。
- Engine / Desktop（法律一致性编译器 Phase 0）：`src/lawmind/lint/` 10 条机械规则（定金上限、或裁或诉、金额/定义/交叉引用等）经起草/改稿中间件 advisory 挂 `lintReport`；改稿台自检一行；参数库骨架含 source+生效日。历史扫描最多 3 根（整理夹建议建案、杂烩不自动建案；改法 ≥5 次进待确认，冲突取最新）。北极星快照 + Doctor「交付北极星」。计划：`docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md`、GOALS 第十四期。
- Engine（R-P1-6 Wave-1）：个人知识库 **FTS-first hybrid-lite**——`knowledge_fts`（trigram）索引 CASE/记忆/playbook/golden 等；`searchPersonalKnowledge` 融合 BM25 + 争点加权并压低日记假命中；接线 `search_workspace`、相关记忆召回、`GET /api/search/workspace?source=knowledge|all`。无 embedding（Wave-2）。
- CI（R-P2-2）：覆盖率 ratchet 地板抬升（statements ~42.5→~44.3）；补 fleet-transcript / build-agent-fleet / automations / schema 边场景单测。
- Engine：`render_document` / `force_render` 在律师批准或 bypass 时同步跳过引擎双核对（`strictGates: false`），与出稿检查旁路语义一致。
- Desktop / Engine（Cursor/Claude Code 借鉴 · L1–L5）：提案式改稿（reject 回滚、agent 写盘→红线、全部接受/拒绝）；Compose `@` 钉源进 ContextPlan；委派 ID/depth/超时取消 abort；Stop→`paused` 可续跑；本案 `RULES.md` 硬注入。见 `docs/archive/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md`。
- Desktop / Engine：交付物 barrel 不再 re-export Node 侧 `workspace-loader`（`node:fs`），修复 Vite e2e/渲染进程空白页。
- Desktop（易上手 + 交付可靠 · 收尾）：e2e mock 支持 `plan-handoff` 与签批落盘必核；覆盖「在办必核→通过→导出 Word」与 plan-handoff API round-trip。见 `docs/archive/LAWMIND-SIMPLE-RELIABLE-PLAN.md` §7。
- Desktop / Engine（易上手 + 交付可靠 · 第四波）：Plan 交接写入 `session.json`（`/api/sessions/:id/plan-handoff`，本地与服务端按时间戳合并）；在办导出成功后可「用 Word 打开」。见 `docs/archive/LAWMIND-SIMPLE-RELIABLE-PLAN.md` §6。
- Desktop（易上手 + 交付可靠 · 第三波）：在办「通过」后导出引导条（strict Word / 去文书台）；Plan 交接按会话持久化（刷新可恢复）+ Compose「已保存执行计划」填入/清除条。详见 `docs/archive/LAWMIND-SIMPLE-RELIABLE-PLAN.md` §4。
- Desktop / Engine（易上手 + 交付可靠 · 续）：在办待签批内嵌必核清单 +「一键勾选必核」后可直接通过；Compose「开始执行」将末条计划注入【确认执行】交办（Plan→Execute 交接）。
- Desktop / Engine（易上手 + 交付可靠）：首跑可「跳过习惯」；默认「先计划」权限 + Compose 常驻切换与「开始执行」；签批必核落盘到草稿；严格导出校验落盘清单；禁止无环境变量的 `bypassChecklist`；文书台一览「可交付」就绪条（`assessDeliverableReadiness`）。
- Engine / Desktop（模型能力包络）：按 catalog `contextTokens` 推导 `maxTokens` / compact 预算 / 工具次数 / 历史条数（不再写死 4096·128k）；澄清期放行 `research_task` 与只读，仅拦起草/工作流/渲染；接线 ContextPlan；记忆窗口随模型缩放。详见 `docs/archive/LAWMIND-MODEL-CAPABILITY-REVIEW.md` §8。
- Engine / Desktop（模型能力 PR3）：compact **summarize-then-drop**——丢弃前提取律师/助手要点与工具名并回灌 system note，落盘 `compact-digest.md`；对话文件引用对小文本自动嵌入正文（`/api/fs/read`），路径引用文案诚实标明。
- Engine / Desktop（模型能力续）：`analyze_document` / `read_project_file` 支持 `offset`/`limit` 分页（默认页约 40k 字，原 analyze 仅 8k）；会议室 agenda 同步嵌入小文本；相关记忆召回 5→8、单段 2.5k→4k。
- Engine / Desktop（模型能力续 2）：工具未知参数改为剥离+旁注（不再硬失败）；Solo 默认开启 `reviewCampaignParallel`；引用门禁文案区分「聊天草稿可续」与「仅挡 Word 导出」。
- Engine（模型能力续 3）：Stop/SSE 断开时 `AbortSignal` 取消进行中的模型 HTTP（不再只等轮次间隙）；检索非 JSON 时降级为带风险标记的纯文本 claims，避免空结果。
- Engine / Desktop（模型能力 R1 / W1–W2）：手动 compact 可选 LLM 再摘要（`LAWMIND_COMPACT_LLM=0` 可关）+ dryRun 预览确认；distill 待采纳预览注入 prompt；超大 tool 结果截断入史；intake 逃生口/CASE 已填可跳过；system prompt 可 `compact` 工具目录；交付管线 note 条件注入；「本轮已应用」默认首轮；Doctor 展示强制规则截断。详见 `docs/archive/LAWMIND-MODEL-CAPABILITY-REVIEW.md`。
- Engine / Desktop（模型能力 R2 / W3–W4）：Compose「仅调研」权限模式；只读工具移出 subprocess sandbox；无 matter 软失败 `needsMatter`；推荐法律检索白名单一键写入；超长委派结果落盘 `delegations/<id>.result.md`；互审 `trust: advisory`；会议室 transcript 窗口加长。
- Engine / Desktop（模型能力 R3 / W5–W7 初档）：按任务 temperature；`LAWMIND_REASONING_MODE` 未设且有凭据时默认 model；auto-workflow 可关；`STRICT_TOOL_STREAM` 改为 opt-in；Doctor 展示 capabilityEnvelope。
- Engine / Desktop（模型能力 R4 后置收尾）：directive 用 plan envelope；自定义模型 `stop`；Worker 模型槽（工具轮）；Solo 沙箱 workflow 可预批；澄清 key 跨轮；编辑丢工具确认；工具轨迹 pref；会议室开网开关 + 滚动 `meeting-summary.md`；`agentMaxHistoryMessages` policy；LexEdge 进桌面 adapters；Role allowlist 告警。见 `docs/archive/LAWMIND-MODEL-CAPABILITY-REVIEW.md`。
- Engine / Desktop（团队成长 Wave D）：审查专案组 playbook 角色绑定工作区助手（报告/角色 Tab 显示助手名）；案件 `team-roster.json` + 会议室「记住本案编制」；概览「本案团队」条（编制 + 未闭环委派）；`GET /api/delegations?matterId=`；action-summary 近 48h 互审/委派完成角标（不计入待拍板）；**T1.4 改写幅度**（修订完成记字符/段落 delta → quality meta；设置岗位表 / 在办团队 / Doctor 可见）。
- Engine / Desktop（内测指标表）：`team-growth-dashboard` 汇总一次过/改写/学习处理/路由命中/互审覆盖；`routing.resolve_ok` 审计；`GET /api/metrics/team-growth` + `POST …/baseline`；Doctor「团队成长 · 内测指标」可记基线对比；e2e mock + 设置页可见。
- Engine（信任）：合同修订积累在审核通过路径**不再静默写** `LAWYER_PROFILE`；关键修改点 → pending adoption（与手动 finalize API 一致）。
- Desktop（在办 IA）：常驻分区导航「待拍板 / 交出去的活 / 按流程办」；修正子页截断标题；设置「去在办」落到待拍板。
- Engine（R-P0-3）：`turn-orchestrator` 续拆 — intake/auto-wf 短路 → `turn-orchestrator-shortcuts.ts`；主循环 → `turn-orchestrator-model-loop.ts`（主文件 ~594→~368 行）。
- Desktop：设置「岗位」可编辑路由 defaults（byKind / byDeliverableType）；修 `--lm-fg` token；去掉已删侧栏的 automationsListVersion；在办 e2e 覆盖团队视图；案件洞察文案不再提已移除驾驶舱首页。
- Desktop / Engine（审查加固）：「沉淀学习」不再静默写入 `session-summary.md`（仅 pending）；在办深链按 session 精确匹配、按 matter 放开筛选；侧栏「待我拍板」默认选中首项办理。
- Engine：记忆检查 **采纳** 真正落盘——`applyMemoryAdoptionWrite`（`case.progress`→session-summary + CASE 进展；律师/助手 profile；争点/风险等 CASE 章节）。
- Engine / Desktop（团队成长 Wave A–C）：签批指标与「需修改→待教」；成长 API；默认路由 + Firm 强制互审；合同审查多步种子；**在办默认「团队」按助手聚合**（忙闲/一次过/待教下钻队列）；待教角标进记忆；修订完成 / 合同修订包回流 pending 学习。
- Docs：扩充「数字团队成长」详细工程计划（分方向成长模型、API/数据规格、Wave A–D DoD、Demo）→ `docs/archive/LAWMIND-TEAM-GROWTH-PLAN.md`。
- Desktop：会议室与对话共用全局左栏（材料树 + 会话）；页内仅保留场次目录 + 办理区；讨论中可拖入材料。
- Desktop：会议室可随时「终止发言」/「终止并补充」（中止当前助手 turn 后写入律师意见再继续）。
- Desktop：会议室右栏办理区加宽（铺满列，上限约 `72rem`）。
- Desktop：会议室 live 态 sticky 操作条；仅材料也可开场；运行中 CTA 分层（置顶终止 / 有文案才「终止并补充」）；记录区加高。
- Desktop：会议室模型出错后暂停并可「结束讨论」（不调模型退出）；修复本地服务 `buildAgentConfig` 同步路径。
- Desktop：在办改为真正的拍板台——隐藏全局案件侧栏；左栏为待签批/待补充/待批准分组目录（可按案件筛选），右栏办理区。
- Desktop：对话气泡支持原地「修改 / 删除」（删问连带删答）；「停止」协作式中止服务端轮次；Compose 可压缩并提炼偏好/案件摘要至记忆采纳队列。
- Skills S5–S6 MVP：中国法务自研包 + 本地技能签名库；审查矩阵 CSV（含 citation）；compose privilege tip；Doctor 私有化检查清单；Firm `reviewCampaignParallel`；`pnpm lawmind:skills:golden -- --compare`。
- Desktop：移除 Solo「驾驶舱」首页（`HomeView` / `preferClassicChatHome`）；默认打开即对话。
- Desktop：文书台与在办职责拆分——文书台主做改稿/批注/交付预览，「回到在办签批」；在办对待审文书可直接通过/驳回/需修改（无需全文预览）；必核未齐时引导回文书台。
- Desktop：工具批准「改拟稿」收窄——有 `content` 的文书写入不再弹窗改全文（改「改参数」/引导文书台）；短字段与邮件 `body` 仍可改。
- Desktop：澄清 P0–P2——在办表格「提交补充并继续」；对话弱引导/短确认缩略；file/enum/bool/date 控件与材料路径挂接。
- Desktop：对话「去在办补充」深链到对应待补充行（sessionId/taskId），并滚到办理区表格。
- Desktop：Compose 上下文用量改为 Cursor 式圆环+分数，与模型选择同行；点击可查看 token、整理上下文、沉淀知识库、打开设置→记忆。
- Engine：`ClarificationQuestion.inputType` + `clarification-fields.ts`（短确认判定、材料编码、resume 文案）。
- Desktop：在办顶栏去掉 Spawn「更多」及「回对话下达 / 交出去的活」；下达用顶栏「对话」，委派监控走设置→协作。
- Desktop：去掉「正在连接本地服务」启动横栏；在办页去掉「待办/办理中」状态 pill 横条（聚焦「待我拍板」时仍显示退出聚焦）。
- Desktop：自动办件迁入 **设置 → 自动办件**；顶栏「会议室·办件」改为独立「会议室」Tab。
- Desktop：对话材料栏去掉「未关联 / 案件」捷径按钮（案件入口改走侧栏列表与顶栏案件 chip）。
- Desktop：去掉顶栏「待我拍板」角标（文书台/侧栏折叠时不再出现）；入口仅侧栏「待我拍板」。
- Docs: root governance files (**`AGENTS.md`**, **`CLAUDE.md`**, **`VISION.md`**, **`CONTRIBUTING.md`**, **`GOALS.md`**, **`SECURITY.md`**, this file) reframed for LawMind-only workflow.

---

## 历史期次归档（自 GOALS.md 移入 · 2026-09-03）

> 以下为 GOALS.md 第一至第十四期已完成期次的勾选清单原文，按时间序保留事实与口径批注（含「口径：工程存在，外部验证待补」等标注）；未完成项（14.11）与当前态见 `GOALS.md`。引用的历史文档已封存于 `docs/archive/`。

### 第一期 — 最小闭环

- [x] 建立双记忆模板：`workspace/MEMORY.md` / `workspace/LAWYER_PROFILE.md`
- [x] 核心数据结构：`TaskIntent` / `ResearchBundle` / `ArtifactDraft` / `AuditEvent`
- [x] 代码骨架：`src/lawmind/` 五大模块（Router / Memory / Retrieval / Artifacts / Audit）
- [x] 接入通用大模型（Retrieval adapter，OpenAI-compatible + 环境变量预设）
- [x] 接入法律专用模型（Retrieval adapter，同上）
- [x] Word 模板文件（`workspace/templates/word/`）
- [x] 人工审核 UI / CLI 交互（CLI + LawMind 桌面「审核」页：草稿列表、签批、渲染交付物）
- [x] 完整端到端测试（smoke 脚本 + Router/Reasoning/Engine 正式测试用例）

### LawMind Phase A（可审计交付底座，与顶尖产品路线对齐）

- [x] 引擎黄金路径单测：`matter` → 草稿 → `review` → `render(docx)` → 审计含 `draft.reviewed` / `artifact.rendered`（`src/lawmind/integration/phase-a-golden-engine.test.ts`）
- [x] 审计 Markdown 导出：`buildAuditExportMarkdown` + 按 `matterId` / `taskId` / 时间筛选（`src/lawmind/audit/index.ts`，桌面 `GET /api/audit/export`）
- [x] PROFILE 分段解析：`listAssistantProfileSections` + `GET /api/assistants/<id>/profile-sections`
- [x] 体检字段扩展：`GET /api/health` 含 `lawMindRoot`、`doctor.*`（`apps/lawmind-desktop/server/lawmind-health-payload.ts`）

### 第二期 — 扩展与深化

- [x] PPT 渲染（`render-pptx.ts`，引擎按 `draft.output === "pptx"` 分发）
- [x] 案件级记忆：`workspace/cases/<matter-id>/CASE.md`（`loadMemoryContext` / `ensureCaseWorkspace` / 引擎与 Agent 工具；见 `src/lawmind/memory/index.test.ts`）
- [x] 律师偏好显式学习：`appendLawyerProfileLearning`、`buildLawyerProfileReviewLearningLine`、审核台勾选写入「八、个人积累」、`POST /api/lawyer-profile/learning`
- [x] 文书模板分类：`BuiltInTemplateCategory` + `GET /api/templates/built-in`（contracts / litigation / client / internal）

### 第三期 — 商业化与合规

- [x] 多律师协作支持（委派注册表 + `collaboration-audit.jsonl` + `GET /api/collaboration/summary`）
- [x] 私有化部署方案（检查清单：[LawMind 私有化部署](docs/archive/LAWMIND-PRIVATE-DEPLOY.md)（归档））
- [x] 合规报表与审计链增强（`buildComplianceAuditMarkdown`、`GET /api/audit/export?compliance=true`）
- [x] 法律模板/技能包本地签名校验（`verifyLawMindBundleManifest`，[LawMind 包清单](docs/archive/LAWMIND-BUNDLES.md)（归档）；非远程市场）

### 第四期 — Deliverable-First Architecture（DFA / 商业化关键里程碑）

> 本期把 LawMind 从「会写漂亮汇报」推进到「能交件」——参见 [LawMind DFA](docs/archive/LAWMIND-DELIVERABLE-FIRST.md)（归档）。

- [x] **P1 交付物本位（基础）**：`DeliverableType` 一等公民、`router/deliverable-meta.ts` 检测、`keyword-draft.ts` 按交付物生成完整正文
- [x] **P2 验收门禁（核心）**：`src/lawmind/deliverables/` 注册表 + `validateDraftAgainstSpec()` + 6 类内置 spec（rental/general 合同、demand letter、合同审查、通用文书）
- [x] **P2.1 桌面/HTTP/Agent 接入**：`ReviewWorkbench` 挂 `<AcceptanceGate>`；`GET /api/drafts/:taskId` 携带 `acceptance`；`POST /render` 默认 strict 返回 422；agent `render_document` 内置 gate（可 `bypass_acceptance_gate=true` 越权）
- [x] **P3 来源锚点**：`GET /api/sources/:id/preview?taskId=` 返回原文 + 支撑结论 + 引用章节；桌面 `LawmindSourcePreview.tsx` 在审核台正文 / Citation Banner / 详情对话内提供 hover popover（对标 Harvey/Spellbook）
- [x] **P4 三档版本封装**：`src/lawmind/policy/edition.ts`（Solo / Firm / Private Deploy 8 项 feature 开关）+ 桌面 `useEdition()` 钩子 + `GET /api/policy/edition`
- [x] **P4.1 工作区私有 spec 加载**：`<workspace>/lawmind/deliverables/*.json` 自动注册（`workspace-loader.ts`），事务所私有合同（如 `contract.employment`）零代码扩展
- [x] **P4.2 验收交付包导出**：`src/lawmind/delivery/draft-acceptance-pack.ts` + `GET /api/drafts/:taskId/acceptance-pack` + `pnpm lawmind:gate -- --pack <taskId>`（受 `acceptancePackExport` 控制）
- [x] **P4.5 案件验收聚合**：`GET /api/acceptance-summary?matterId=` 一次性返回所有草稿的 ready / placeholder / blocker 计数；MatterWorkbench 草稿行渲染 `DraftAcceptanceBadge` + 「去审核」直跳
- [x] **P5 30 秒首跑**：`LawmindFirstRunDialog` 角色 → 模板 → 自动建案 + seed prompt；首次启动（无 matter）自动触发，可永久关闭

### 第五期 — 信任与可解释性硬化（5.1–5.5）

- [x] **5.1 Clarify–Execute**：`awaiting_clarification` 时工具层拒绝 `execute_workflow` / `draft_document` 等重流程；`pendingClarificationKeys` 会话持久化；单测 + 架构/工程记忆说明
- [x] **5.2 红线进 Prompt**：`lawmind.policy.json` 的 `agentMandatoryRules` / `agentMandatoryRulesPath` 注入 `buildSystemPrompt`；体检 `agentMandatoryRulesActive`（不泄露全文）
- [x] **5.3 子任务可见**：`TaskRecord.executionPlan`、任务创建默认步骤、`GET` 任务详情与桌面详情 UI；与 checkpoints 并存
- [x] **5.4 学习去重**：`appendLawyerProfileLearning` / 助手 profile append 同任务重复跳过；审计与审核台提示
- [x] **5.5 路由可见**：`GET /api/health` 暴露 router / reasoning / edition；可选 `runtimeHints`（Firm/Private 或 `includeTurnDiagnostics`）

### 第六期 — 自主执行与助理团队

- [x] **6.1 工作流续跑与引导**：`execute_workflow` 支持 `existing_task_id` + `restart_from: "research"`；检索失败返回 `recoverable` 提示；system prompt 强化交付优先与续跑说明；`taskIntentFromRecordOnly` + 单测
- [x] **6.2 团队工作流模板**：`workspace/lawmind/workflows/*.json`；`GET /api/collaboration/workflow-templates`、`POST /api/collaboration/workflow-run`；设置 → 协作内列出模板并试运行；架构文档协调 Clarify–Execute
- [x] **6.3 审核首屏自检**：`LawmindReviewSelfCheckSummary` 聚合验收 / 引用 / 交付类型并跳转详情
- [x] **6.4 工具预算可观测**：`lawmind.policy.json` 可选 `agentMaxToolCallsPerTurn`；`LAWMIND_AGENT_MAX_TOOL_CALLS`；`GET /api/health` 字段 `lawmindAgentMaxToolCalls`
- [x] **6.5 愿景/架构脚注**：`LAWMIND-VISION.md` Phase 6 进度注、`LAWMIND-ARCHITECTURE.md` 多助手流说明

### 第七期 — 异步任务、系统通知与 Edition 危险工具收紧

- [x] **7.1 团队工作流异步任务**：`POST /api/collaboration/workflow-run` 支持 `async: true` → `202` + `jobId`；`GET /api/jobs/:id`、`GET /api/jobs?limit=&status=&since=`；**`GET /api/jobs/:id/stream`**（SSE + `onProgress` 推送 + 心跳）；`executeWorkflow` 可选 `onProgress` 写 job `progress`（`lawmind-server-jobs.ts`、路由接入 `lawmind-server-dispatch.ts`）
- [x] **7.2 桌面完成通知**：Electron `Notification` + `lawmind:show-notification` IPC / preload；「在办 · 按流程办」/设置协作区「运行所选模板」**优先 EventSource、失败回退轮询**，终态时一次系统通知；**近期任务**对非当前 `queued`/`running` 任务**有限并发 SSE（默认 2 路）**刷新列表（`LawmindSettingsCollaboration.tsx`）
- [x] **7.3 Edition 收紧危险工具**：`EDITION_FEATURES.strictDangerousToolApproval`（Firm / Private 开启）；`buildAgentConfig` 注入；`toolRequiresExplicitApproval` + `execute_workflow` 扩展清单；`LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` 在严格版下不绕过（`src/lawmind/agent/dangerous-tool-policy.ts`、`runtime.ts`）
- [x] **7.4 进度脚注**：`LAWMIND-VISION.md` Phase 7 工程注
- [x] **7.5 异步 Job 加固**：`workspace/lawmind/jobs/*.json` 持久化与进程重启时将非终态 job 标为 `interrupted_by_restart`；`POST /api/jobs/:id/cancel`（队列内立即取消，运行中在步骤批次间协作式中止，不中断单次 `sendAndWait`）；`idempotencyKey` 防重复提交；`executeWorkflow` 可选 `shouldAbort`；通知点击聚焦并滚动至设置协作区；协作面板取消按钮与通知不可用提示
- [x] **7.6 合同修订积累主路径与文档同步**：审核通过后按草稿 `contractRevisionCapture` 写入 `learning/contract-revisions/`（`contract-revision-on-review-approved.ts`）；桌面不增加批量合同目录设置 UI（`desk-settings` 仍 API/手工 JSON + 启动时加载供可选对话前缀）；[LAWMIND-CONTRACT-REVISION-ACCUMULATION.md](docs/archive/LAWMIND-CONTRACT-REVISION-ACCUMULATION.md)、[LAWMIND-DESKTOP-FILES-AND-CONTEXT.md](docs/archive/LAWMIND-DESKTOP-FILES-AND-CONTEXT.md)（均归档）、[LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md)、使用手册 §12 与本条对齐

### 第八期 — Matter-centered 写侧 + Role 编制 + Reasoning Gate（2026-Q3）

> 本期把 LawMind 从「派生只读 Matter」推进到「matter-centered 写侧 + 岗位化 +
> 推理门禁 + 显式记忆采纳 + UI 收敛」。架构见 [LAWMIND-ARCHITECTURE.md](docs/LAWMIND-ARCHITECTURE.md) §二。

- [x] **8.1 Engine + ToolPolicy pipeline 重构**：`src/lawmind/index.ts` 拆为
      `engine/{factory,planning,researching,drafting,reviewing,rendering,queries,
context,types,shared}.ts`；`runtime/tool-pipeline.ts` 八段中间件
      （budget / roleAllowlist / approval / clarificationGate / argSchema / timeout /
      audit / execute）替换 `runTurn` 内联逻辑（W1+W2）
- [x] **8.2 Matter 写侧 + JSON 真相源**：`application/services/{matter-write,
deliverable,approval,queue-write,deadline}-service.ts` + `adapters/matter-storage/`
      落 `workspace/matters/<id>/{matter.json,deliverables/*.json,approvals.jsonl,
queue.jsonl,deadlines.jsonl}`；engine hot path 全程双写；`/api/matters` /
      `/api/approvals` / `/api/queues` 优先读 JSON，缺失回退 `MatterIndex`；agent
      新增 `open_work_queue_item / request_approval / record_deadline`（W3+W4）
- [x] **8.3 Memory Adoption Service + Inspector**：`memory/adoption-service.ts`
      统一所有 Markdown 写入（pending / adopted / auto_adopted / dismissed 四态，
      覆盖 firm / lawyer / client / matter / playbook / opponent / project /
      assistant 八个 scope）；`MemoryInspector.tsx` + `/api/memory/adoption{,/suggest,
/adopt,/dismiss}`；案件认知页消费 service（W5+W6）
- [x] **8.4 Role 一等对象 + delegate_to_role + targetRole**：`core/role.ts`
      把 6 个 preset 升级为 Role；ToolPolicy 与 `engine/drafting.ts` 强约束工具与
      deliverable 类型；`/api/roles` + `LawmindSettingsRoles.tsx`；orchestrator
      支持 `assigneeRoleId`，新增 `delegate_to_role` 工具与
      `ApprovalRequest.targetRole` 入库 + 过滤；`collaboration-tools.ts` 拆到
      `tools/coordination/{delegate,handoff,meeting,utils}.ts`（W7+W8）
- [x] **8.5 Reasoning Gate**：`DeliverableSpec.reasoningGate` 字段 +
      `deliverables/reasoning-validator.ts`；strict 模式下与 acceptance gate 并联
      把守 render；高风险内置 spec（demand letter / contract review / general
      contract / litigation outline）默认开启；桌面 `LawmindAcceptanceGate` 同列
      展示 reasoning 报告（W9）
- [x] **8.6 Insights 解耦 + ux.matter_action 双写**：`src/lawmind/insights/` 4
      个 compute-\* 纯函数 + 单测；事件双写 `ui.matter_action` + `ux.matter_action`，
      policy `productInsightsCollection` 控制采集；UI 抽到
      `apps/lawmind-desktop/src/renderer/insights/`（W10）
- [x] **8.7 MatterWorkbench 拆分 seam**：在
      `apps/lawmind-desktop/src/renderer/matter/` 落地多视图 + insights barrel + Timeline/ListPane；
      `apps/lawmind-desktop/e2e/matter-cockpit.spec.ts` 锁定黄金路径；主文件 `MatterWorkbench.tsx` 约 2000 行（第十二期 W2 继续迁入 `matter/*`）
- [x] **8.8 季末验收 + 文档冻结**：`pnpm lawmind:acceptance` 接入
      `pnpm lawmind:quarterly-demo`（`scripts/lawmind/lawmind-quarterly-demo.ts`）跑
      matter → planned deliverable → 高风险 approval → 状态推进 → reasoning gate →
      memory adoption → JSON 真相源回读 全链路；新增
      `src/lawmind/integration/quarterly-acceptance.test.ts`；同步本节与
      `LAWMIND-ARCHITECTURE.md` 二、新增段

### 第九期 UX 硬化（2026-05，90 天体验计划）

- [x] **W1 就绪态**：`LawmindReadinessStrip` + `MODEL_NOT_CONFIGURED_USER_HINT` 文案统一 + 发送/向导一致
- [x] **W2 首跑/向导**：首跑 bootstrap 可见错误；API 向导检索策略 `details` 折叠；律师向种子 prompt
- [x] **W3 可读性**：`.lm-meta` 13px 基线；核心控件 `title`；设置「界面字号」`localStorage`
- [x] **W4 E2E**：smoke 就绪条；`matter-cockpit` + `pnpm lawmind:desktop:e2e`；本节骨架
- [x] **W5–6 审核/对话**：渲染门禁摘要；自检置顶；`LawmindChatDraftStatusBar` + 启发式单测
- [x] **W7 Matter**：概览默认三卡 +「更多洞察」折叠；Plan 模式 `title` 路线图
- [x] **W8 协作/模型**：协作文案瘦身；`byAssistantId` 模型记忆；委派 toast；工作流模型标签
- [x] **W9–10 工作 IA**：`lm.ui.workTab.v1` 实验开关；工作子 Tab（对话/审核）+ 深链兼容
- [x] **W11 状态收敛**：`matter/MatterOverviewExtras`；`statusLabel` + `GET /api/tasks/:id`
- [x] **W12 黄金路径**：`e2e/golden-path.spec.ts`；律所版灰显；全量回归入口 `pnpm test`

### 平台级 Big-Bang 重构（已完成）

- [x] 冻结平台统一契约：`docs/lawmind/LAWMIND-PLATFORM-CONTRACTS.md` + `src/lawmind/platform/contracts.ts`
- [x] Ingest Orchestration 收敛：`src/lawmind/platform/ingest-helpers.ts` + `analyze_document` / `read_project_file` 统一错误码
- [x] Task Execution 状态机收敛：`src/lawmind/platform/execution-state.ts` + chat/jobs 响应 `executionState`
- [x] Desktop API/UI 状态字段收敛：`getPendingClarificationState` 优先 `executionState`/`gateDecisions`；`GET /api/bootstrap`
- [x] Strict 门禁升级：CI 接入 `lawmind:multitask:validate` + `pnpm lawmind:verify`（含 HTTP smoke）
- [x] 切换与回退预案：`LAWMIND_PLATFORM_CONTRACTS_V1` + [LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md](docs/lawmind/LAWMIND-BIGBANG-CUTOVER-ROLLBACK.md)

### 参考项目 P0 落地（2026-05）

> 依据 [docs/archive/LAWMIND-REFERENCE-PROJECT-LESSONS.md](docs/archive/LAWMIND-REFERENCE-PROJECT-LESSONS.md)（归档）实施计划。

- [x] **统一待处理动作**：`requiresAction` + `POST /api/chat/resume` + [LAWMIND-INTERRUPT-RESUME.md](docs/archive/LAWMIND-INTERRUPT-RESUME.md)（归档）
- [x] **待我拍板**：侧栏入口 + `GET /api/action-summary`、`POST /api/approvals/resolve`、聊天内 `LawmindRequiresActionCard`（不再挂 compose「待你处理」条）
- [x] **工作流库**：`workspace/lawmind/workflows/` 种子模板；桌面主路径为「在办 · 按流程办」与 compose 模板画廊（原独立 `LawmindWorkflowLibrary` 组件已收敛）
- [x] **任务看板**：`MatterTaskBoard` 聚合 tasks / queue / approvals / drafts
- [x] **系统体检**：`buildWorkspaceStandardReport` + `LawmindSettingsDoctor` + [LAWMIND-WORKSPACE-STANDARD.md](docs/archive/LAWMIND-WORKSPACE-STANDARD.md)（归档）
- [x] **P1 信任**：`matterScopeMiddleware`、`buildWorkspaceSessionHealth`、MCP 路线图 [LAWMIND-INTEGRATIONS.md](docs/archive/LAWMIND-INTEGRATIONS.md)（归档）

### 参考项目 P1 落地（2026-05）

> 第二期：体验收口 + 信任硬化 + 只读 MCP（见借鉴清单 P1）。

- [x] **来源锚点**：`GET /api/sources/:id/preview` 段落 `anchorId` / `excerpt`；审核台与 `LawmindSourcePreview` 跳转高亮
- [x] **律师责任声明**：`lawmind-attorney-disclaimer` 统一审核条、验收包导出、首跑文案
- [x] **任务看板 Jobs**：`GET /api/jobs?matterId=` + `MatterTaskBoard` kind=`job`
- [x] **工具批准编辑续跑**：`decision: edit` + `editedArgs`；`LawmindRequiresActionCard` JSON 编辑；E2E golden-path
- [x] **工具治理页**：`GET /api/tools/registry` + `LawmindSettingsTools`
- [x] **网络 allowlist**：`lawmind.policy.json` `networkAllowlist`；Brave 联网工具策略校验
- [x] **审计 hash-chain**：`emit(..., integrityChain)` + `GET /api/audit/export?integrity=true`（Firm+）
- [x] **工作流 schema**：`acceptancePackRequired` / `requiredSources`；库卡片标签；`gateHint` 轻提示
- [x] **会话时间线**：`buildMatterSessionTimeline` + `GET /api/matters/session-timeline`
- [x] **只读 MCP POC**：`pnpm lawmind:mcp:readonly` + [LAWMIND-INTEGRATIONS.md](docs/archive/LAWMIND-INTEGRATIONS.md)（归档）配置示例
- [x] **首跑高级入口**：`LawmindFirstRunDialog` → 系统体检；用户手册「从工作流库启动任务」

### 参考项目 P1+ 产品化（2026-05）

> ProWorkBench / Ralph / AgentActa / Claude for Legal 借鉴清单续做。

- [x] **集中批准队列**：`LawmindApprovalQueue` + `listPendingToolApprovals` + `GET /api/action-summary` 的 `toolApprovals`
- [x] **高安全模式体检**：Doctor 展示 allowlist / 危险工具 / 审计 hash-chain 三项
- [x] **审计链默认写入**：Firm/Private 下 `emit()` 默认 `integrityChain`（可 `integrityChain: false` 关闭）
- [x] **队列 phase**：`WorkQueueItem.phase` + 任务看板 subtitle
- [x] **会话健康增强**：工具待批准、活跃 jobs、队列阻塞信号
- [x] **执行轨迹时间线**：`LawmindChatExecutionTrace` `mode=timeline`
- [x] **连接器目录**：`docs/archive/LAWMIND-INTEGRATIONS.md`（归档）connector catalog 表

### 参考项目 P2 波次（2026-05，可借鉴 MVP）

- [x] **审查矩阵**：`buildMatterReviewMatrix` + `GET /api/matters/review-matrix`；案件工作台「审查矩阵」标签
- [x] **记忆真相源**：`LawmindMemoryTruthSources` 按 scope 分组 + `GET /api/memory/source-text` 只读预览；`MemoryInspector` 中文 scope 标签
- [x] **来源标注**：`SourceAnnotation` + `GET/POST /api/sources/:id/annotations`；来源预览弹层 + 可选 `source.annotation` 记忆建议
- [x] **Token 统计**：`model-usage` 本地账本 + `runTurn` 累计 `modelUsage`；`GET /api/health` `usageSummary`；设置页「本地使用统计」
- [x] **Jobs 本地定时**：`scheduled` 状态 + `scheduleRunAt` + `processDueScheduledJobs` 30s tick；任务看板展示预约任务
- [x] **桌面 UI 构建修复**：`requires-action` 改用 `crypto.randomUUID()`，避免 Vite 打包 `node:crypto` 导致白屏
- [x] **MCP 扩展**：`list_source_annotations`、`get_review_matrix`、`get_draft_acceptance_pack`（`src/lawmind/mcp/readonly-tools.ts`）
- [x] **业务领域岗位**：`practice-personas.ts`；工作流库筛选 + 设置页领域标签

### 参考项目 P3 收口（2026-05，计划项全部落地）

- [x] **内置命名工作流**：9 个种子模板（NDA、律师函、尽调审查表、客户邮件摘要等）+ `namedAgent` 字段
- [x] **工作流自动播种**：`ensureBuiltinWorkflowSeeds`；桌面服务启动时写入缺失 JSON
- [x] **DMS / PM 三阶段路线图**：`docs/archive/LAWMIND-INTEGRATIONS.md`（归档）扩展（M1–M3、产品矩阵、IT 检查清单）
- [x] **用户手册**：内置工作流一览表 + `namedAgent` schema 说明

### 参考项目 P4（2026-05，M2 连接器 POC + 定时工作流）

- [x] **M2 只读连接器**：`src/lawmind/integrations/` + `GET /api/integrations` + `GET /api/integrations/:id/documents?matterId=`
- [x] **filesystem 案件目录索引**：`cases/<matterId>/` 文件元数据；`lawmind/integrations.json` 配置样例
- [x] **Doctor 集成状态**：`doctor.integrations` + `LawmindSettingsDoctor` 外部集成（M2）分组
- [x] **案件本地文档索引 UI**：`MatterLocalDocIndex`（概览 Tab）
- [x] **renewal-monitor 工作流**：内置模板 + `schedulable` + 工作流库「可预约执行」标签
- [x] **单测稳定性**：`matter-write-service.test.ts` 临时目录 `rm` 重试

### P1–P3 体验收口（2026-05，桌面可点可用）

- [x] **对话草稿状态条**：`LawmindChatDraftStatusBar` 使用 `GET /api/drafts/:taskId`（非 `/review`）
- [x] **记忆 Inspector**：案件工作台「认知」Tab 挂载 `MatterMemoryInspector`
- [x] **Redline 基准稿**：`POST /api/drafts/:taskId/redline/baseline` + 审核台双按钮与空状态引导
- [x] **FTS 冷启动提示**：案件搜索 `indexMissing` + 体检重建说明 + `.env.example` 注明 `LAWMIND_ALLOW_INDEX_REBUILD`
- [x] **E2E 导航**：`e2e-helpers` 兼容默认顶栏与工作子导航
- [x] **侧栏增强**：`project-only` 保留；cockpit 时案件快捷列表 + 有待决时底栏「待我拍板」
- [x] **W11 子面板**：`MatterReasoningBoard` / `MatterQualityCockpit` / `MatterRoleBoard` 挂载 + draft `reasoningReport`
- [x] **整洁与文档**：删除孤儿 `LawmindChatActivityFeed`；DMS fixture 说明；用户手册「日流程自检」

### 参考项目 P5（选型建议；下列各项后续均已落地）

> 验收 Phase 4 后择一开工；建议优先级（改动面 / 价值平衡）：

1. [x] **MemoryInspector diff** — `buildAdoptionPreviewDiff` + `GET /api/memory/adoption/:id/preview-diff` + Inspector「预览变更」
2. [x] **审计 replay JSON** — `buildAuditReplayExport` + `GET /api/audit/export?replay=true`
3. [x] **SQLite FTS 只读索引** — `src/lawmind/indexing/` + `GET /api/search/workspace` + Doctor 重建
4. [x] **Redline / tracked changes** — `redline-proposal` + 审核台 Accept/Reject（段落级 MVP，无 Word TC）
5. [x] **真实 DMS OAuth** — iManage/SharePoint env 桩 + fixture + `cases/<matterId>/.lawmind-dms.json`

### 第十期 — Claude Code 工程借鉴（P0–P2，2026-05）

- [x] **P0 消息预处理**：`lawmind-message-preprocess.ts`、Brief 模式、工具组折叠、虚拟列表（>100 条）
- [x] **P0 Compose**：发送队列、`permissionMode`、待批准徽章、stash、`/⌘K` 命令面板
- [x] **P0 任务/批准 UI**：`LawmindTaskDrawer`；工具批准为聊天内 `LawmindRequiresActionCard` 一点 resume（二次 Dialog 已拆除）
- [x] **P1 执行契约**：扩展 `RunTurnEvent`（`token_budget` / `compact_boundary`）
- [x] **P1 Memory 召回**：`memory/relevant-recall.ts` + `runtime` 注入
- [x] **P1 Compact**：`agent/compact.ts`、`context-budget.ts` + `GET/POST /api/sessions/:id/context-budget|compact`
- [x] **P1 会话 Transcript**：`adapters/session-transcript/` + `POST /api/sessions/:id/resume`
- [x] **P1 工具元数据/权限**：`permission-mode.ts`、`ToolDefinition.isConcurrencySafe`；`tool-concurrency.ts` + 单测
- [x] **CLI**：`pnpm lawmind:doctor -- --json`
- [x] **P2 子进程工具沙箱**：`tool-sandbox.ts`、`subprocessSandboxMiddleware`；`doctor.p2.toolSandbox`；设置页 Doctor P2 区块
- [x] **P2 workflow snapshot**：`lawmind-server-jobs.ts` `workflowSnapshot` 入队/预约；`missing_workflow_snapshot` 兜底
- [x] **P2 Team Memory 同步脚手架**：`team-memory-sync.ts`（Firm + opt-in + 密钥扫描；默认关闭）

### 第十一期 — 卓越产品平台化（2026-05）

- [x] **Q1 黄金旅程冻结**：`src/lawmind/product/golden-journeys.ts` 固化 matter production、contract review trust、role delegation memory 三条旅程，供发布报告复用。
- [x] **工具治理元数据**：`src/lawmind/agent/tools/governance.ts` 为工具补齐风险、matter scope、运行模式、幂等性、重试性、审计和 sandbox 建议；`GET /api/tools/registry` 返回 governance。
- [x] **ContextPlan**：`src/lawmind/runtime/context-plan.ts` 将 matter state、MATTER_STRATEGY、pending actions、transcript、memory recall、source anchors、role context 分层描述。
- [x] **Deliverable lifecycle**：`src/lawmind/core/deliverable-lifecycle.ts` 固化 planned → drafting → pending_review → approved → rendered → delivered → learned，写侧 service 阻止跳过审核的 shortcut。
- [x] **Workflow playbook 摘要**：`src/lawmind/agent/collaboration/playbook-summary.ts` 将 workflow 模板转成含来源要求、审批点、风险和验收包要求的 playbook 视图。
- [x] **质量飞轮发布报告**：`src/lawmind/evaluation/replay-fixtures.ts` 内置 12 个合成回归 fixture（结构/lint 回归层，非真实任务回放）；`release-report.ts` + `pnpm lawmind:release-readiness` 生成发布准备报告；`pnpm lawmind:verify` 接入报告输出。（口径：工程存在，外部验证待补）
- [x] **路线文档**：`docs/archive/LAWMIND-EXCELLENCE-ROADMAP.md`（归档）记录本期落地口径与验收命令。

### 第十二期 — 六维能力 ≥4.5（2026-Q2–Q3）

> 目标：工程 review 六维（架构、法律贴合、可维护性、测试/发布证据、Harvey/Word 对标、开源借鉴）全部 **≥4.5**。  
> 详细达标线与排期见 [LAWMIND-EXCELLENCE-ROADMAP.md](docs/archive/LAWMIND-EXCELLENCE-ROADMAP.md)（归档）§六维能力 ≥4.5 升级计划。

#### W1 — 测试/发布证据 + 法律场景可证（3.0 → 4.5）

- [x] **Benchmark CLI**：`pnpm lawmind:benchmark` 跑 `BUILTIN_BENCHMARK_TASKS`；`lawmind:release-readiness` 默认并入结果；`LAWMIND_BENCHMARK_STRICT=1` 时 gate 失败 exit 1（口径：工程存在，外部验证待补）
- [x] **Quality 灌数**：smoke/quarterly-demo 后写入 `workspace/quality/*.quality.json`；发布报告 Dashboard 非空（口径：工程存在，外部验证待补）
- [x] **黄金旅程实证**：三条 `golden-journeys` 各 1 条 E2E 或 integration（matter-production / contract-review-trust / role-delegation-memory）（口径：工程存在，外部验证待补）
- [x] **E2E 扩展**：`contract-review-trust.spec.ts` 纳入 `lawmind:desktop:e2e:pr`
- [x] **Replay 结构测**：12 fixtures 中 ≥8 个非 LLM 结构断言单测（口径：工程存在，外部验证待补）

#### W2 — 工程可维护性（3.5 → 4.5）

- [x] **MatterWorkbench 拆分 seam**：`MatterTimelinePanel`、`MatterWorkbenchListPane`、`useMatterSessionTimeline`（主文件仍 >800 行，后续 PR 继续迁入 `matter/*`）
- [x] **App.tsx** ≤1000 行（`lawmind-app-root.tsx` + `lawmind-app-utils.ts`）；**FileWorkbench** 拆 `file/*`，单文件 ≤1000 行
- [x] **legal-tools** 拆 `tools/legal/*`，单文件 ≤600 行（`engine-tools` 拆分可单列 PR）
- [x] **runtime.ts** 外提 `turn-orchestrator.ts` / `runtime-model-call.ts`（公开 API 仍自 `runtime.ts` 导出）
- [x] **贡献约定**：单文件软上限写入 `CONTRIBUTING.md`

#### W3 — 对标 Harvey/Word（3.0 → 4.5）

- [x] **docx tracked changes**：`render-docx-tracked.ts` + `POST /api/drafts/:id/render-tracked`（officecli，失败回退 plain docx）
- [x] **真 DMS OAuth**：SharePoint Graph（`sharepoint-graph.ts`）；iManage 保持 fixture
- [x] **Matter 时间线**：一级 Tab「时间线」；`buildMatterSessionTimeline` 聚合 audit/approval/job
- [x] **集成差距表**：`docs/archive/LAWMIND-INTEGRATIONS.md`（归档）Harvey/Spellbook 对照

#### W4 — 架构守住 + 开源借鉴收口（≥4.5）

- [x] **契约 CI**：`lawmind-platform-contracts-check.ts` 纳入 `lawmind:multitask:validate`
- [x] **ContextPlan 集成测**：`context-plan.integration.test.ts`；`runtime.ts` 注入 ContextPlan markdown
- [x] **REFERENCE 状态表**：`docs/archive/LAWMIND-REFERENCE-PROJECT-LESSONS.md`（归档）§落地状态矩阵
- [x] **Queue dependsOn**：`queue-write-service` + 任务看板 subtitle
- [x] **架构目录对齐**：`LAWMIND-ARCHITECTURE.md` §二

#### 第十二期合并验收

```bash
pnpm lawmind:verify
LAWMIND_BENCHMARK_STRICT=1 pnpm lawmind:release-readiness -- --out dist/lawmind-release-readiness.md
pnpm lawmind:desktop:e2e:pr
pnpm lawmind:quarterly-demo
```

- [x] 发布报告：`Benchmark gate: pass`（mock 对齐模式）+ Quality Dashboard 可灌数（口径：工程存在，外部验证待补）
- [x] `pnpm lawmind:verify` + `LAWMIND_BENCHMARK_STRICT=1 pnpm lawmind:release-readiness` + `pnpm lawmind:desktop:e2e:pr`（38 过 / 2 跳 / 0 败）+ `pnpm lawmind:quarterly-demo`

### 第十三期 — Cursor / Claude / Codex 式高级引导（判断力优先 · 不改通路 · 2026-Q3）

> 把「高级引导优先于判断类硬控」写入全产品目标；硬门禁只保留安全 / 空交付 / 律师权威。  
> 硬控债表：[docs/archive/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md](docs/archive/LAWMIND-CURSOR-CLAUDE-CRAFT-REVIEW.md)（归档）。

- [x] **13.0 入宪 + 全通路计划**：第四铁律；Craft 样板；A–L 通路对照与 W0–W4 分期（已落地，见债表）
- [x] **13.1 / W1.1 改稿双轨合一**：`update_draft` amplitude 硬拒 → soft 或大改走 Redline 提案（通路仍为 `update_draft`）
- [x] **13.2 / W1.2–W1.3 Intake 软化**：关键词·长度冻结 → Soft Ask + Intake Skill；钉源/邮件齐备不假澄清（交办表单保留）
- [x] **13.3 / W1.4 意见书与自动化禁语**：opinion 路径 `## 禁止` → 原则 + Opinion Craft（automations 入口不变）
- [x] **13.4 / W2 系统提示分层 + Citation Skill**：禁止名单瘦身；research/render 教练
- [x] **13.5 / W2 内置 Skill 面**：Intake、Citation、交付用语与合同 Craft 可发现可签名
- [x] **13.6 / W3 工具预算检查点 + Compact 重注红线**：软预算续跑；压缩后 RULES/deliverable 仍在
- [x] **13.7 / W4 可观测收口 + 回归**：gate-history 区分 safety/judgment；空修订/未批准/危险工具仍硬拒
- [x] **13.8 律师版 Cursor 默认姿势（2026-08-19）**：有凭据时模型路由默认开启；系统提示勿等律师先选通道；办件降为可选快捷。不新增入口、不削弱末端硬门禁。
- [x] **13.9 产品化能力（2026-08-19）**：高频办件（合同审查 / 函件 / 检索 / 诉讼 / 写材料 / 邮件合同）收成 Skill + 流水线，本轮自动绑定；禁止把正式交付交给模型自由发挥。
- [x] **13.10 办件选流程（2026-08-19）**：律师先附材料，再在「办件」列表选流程；指令写能力锁，不必记激活词。

```bash
pnpm exec vitest run src/lawmind/drafts/contract-redline-craft.test.ts \
  src/lawmind/drafts/apply-surgical-edits.test.ts \
  src/lawmind/agent/mail-contract-fast-path.test.ts
```

### 第十四期 — 法律一致性编译器奠基（已完成切片）

> 计划全文：[docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md](docs/LAWMIND-LEGAL-COMPILER-ROADMAP.md)（500 人天 / 12 个月）。  
> Phase 0 + Wave 2 + Wave 3 工程切片已落地；**人/数据债 14.11 未清，见 `GOALS.md` §三，不是 500 人天全部完成**。lint 通过 ≠ 法律正确。外发仍须签批。

- [x] **14.0 计划入宪**：WS0–WS6 重校准（扫描 90 / lint 120 / 自修订 50 / 分级交付 55 / 立场 60 / benchmark 55 / 北极星 25 / 横切 45）；决策头延后
- [x] **14.1 历史扫描**：最多 3 根；整理夹建议建案、杂烩不自动建案；设置 + 首跑入口；`GET/POST /api/historical-scan*`
- [x] **14.2 习惯阈值**：红线 accept ≥5 入待确认；冲突取最新 mtime；不静默写 profile
- [x] **14.3 lint 内核**：10 条机械规则 + 参数库骨架（定金 20% / 时效 3 年 / 4×LPR 倍数）；起草/改稿 advisory；改稿台「机械核对」一行
- [x] **14.4 北极星基线**：`north-star.json` + Doctor「交付北极星」（空样本为「尚无」）（口径：工程存在，外部验证待补）
- [x] **14.5 增量扫描**：cursor + 二次扫描跳过未变文件；指纹不变不重复入队知识（WS0）
- [x] **14.6 自修订闭环**：1 轮；仅自动规范化全角空格；超法定上限定金等法定参数只出建议式提案、不代改原文；或裁或诉进残留（WS2）
- [x] **14.7 买卖+借款族包 + 引用有效性骨架**：规则合计 ≥20；离线废止/无法核验（WS1）
- [x] **14.8 分级交付 + 渐进自主函数 + 决策头 + 升级建议**：外发永不自动；缺逃逸序列不解锁（WS3）
- [x] **14.9 结构化立场库 + 合成影子 benchmark**：红线 accept 入库；审阅时长 / lint 逃逸写侧（WS4–WS6）（口径：工程存在，外部验证待补）
- [x] **14.10 工程收口**：租赁/劳动/股权/建工族包；出稿路径内部低风险 `auto_deliver`（外发永不自动）；`firm.preference` 落盘；合成+工作区影子；离线 LLM 评审一致率；逃逸候选 jsonl；所级默认立场种子（口径：工程存在，外部验证待补）
- [x] **14.12 工程残余**：自修订回写草稿；KEY_MODIFICATIONS→立场；立场自检残留；各族 ≥8 条；合成影子 ≥10；逃逸三向 jsonl；`pnpm lawmind:compiler-gate`；建工触发不含裸「承包」；自修订不改标题
