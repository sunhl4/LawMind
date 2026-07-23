# Changelog (LawMind)

All notable changes to this **LawMind-only** repository are tracked here.

Historical **OpenClaw** upstream release notes were removed when the repository was slimmed to LawMind (engine + desktop + docs). For archeology, refer to the former upstream project history if you still have access.

## Unreleased

### Changes

- Desktop / Engine（易上手 + 交付可靠 · 第四波）：Plan 交接写入 `session.json`（`/api/sessions/:id/plan-handoff`，本地与服务端按时间戳合并）；在办导出成功后可「用 Word 打开」。见 `docs/LAWMIND-SIMPLE-RELIABLE-PLAN.md` §6。
- Desktop（易上手 + 交付可靠 · 第三波）：在办「通过」后导出引导条（strict Word / 去文书台）；Plan 交接按会话持久化（刷新可恢复）+ Compose「已保存执行计划」填入/清除条。详见 `docs/LAWMIND-SIMPLE-RELIABLE-PLAN.md` §4。
- Desktop / Engine（易上手 + 交付可靠 · 续）：在办待签批内嵌必核清单 +「一键勾选必核」后可直接通过；Compose「开始执行」将末条计划注入【确认执行】交办（Plan→Execute 交接）。
- Desktop / Engine（易上手 + 交付可靠）：首跑可「跳过习惯」；默认「先计划」权限 + Compose 常驻切换与「开始执行」；签批必核落盘到草稿；严格导出校验落盘清单；禁止无环境变量的 `bypassChecklist`；文书台一览「可交付」就绪条（`assessDeliverableReadiness`）。
- Engine / Desktop（模型能力包络）：按 catalog `contextTokens` 推导 `maxTokens` / compact 预算 / 工具次数 / 历史条数（不再写死 4096·128k）；澄清期放行 `research_task` 与只读，仅拦起草/工作流/渲染；接线 ContextPlan；记忆窗口随模型缩放。详见 `docs/LAWMIND-MODEL-CAPABILITY-REVIEW.md` §8。
- Engine / Desktop（模型能力 PR3）：compact **summarize-then-drop**——丢弃前提取律师/助手要点与工具名并回灌 system note，落盘 `compact-digest.md`；对话文件引用对小文本自动嵌入正文（`/api/fs/read`），路径引用文案诚实标明。
- Engine / Desktop（模型能力续）：`analyze_document` / `read_project_file` 支持 `offset`/`limit` 分页（默认页约 40k 字，原 analyze 仅 8k）；会议室 agenda 同步嵌入小文本；相关记忆召回 5→8、单段 2.5k→4k。
- Engine / Desktop（模型能力续 2）：工具未知参数改为剥离+旁注（不再硬失败）；Solo 默认开启 `reviewCampaignParallel`；引用门禁文案区分「聊天草稿可续」与「仅挡 Word 导出」。
- Engine（模型能力续 3）：Stop/SSE 断开时 `AbortSignal` 取消进行中的模型 HTTP（不再只等轮次间隙）；检索非 JSON 时降级为带风险标记的纯文本 claims，避免空结果。
- Engine / Desktop（团队成长 Wave D）：审查专案组 playbook 角色绑定工作区助手（报告/角色 Tab 显示助手名）；案件 `team-roster.json` + 会议室「记住本案编制」；概览「本案团队」条（编制 + 未闭环委派）；`GET /api/delegations?matterId=`；action-summary 近 48h 互审/委派完成角标（不计入待拍板）；**T1.4 改写幅度**（修订完成记字符/段落 delta → quality meta；设置岗位表 / 在办团队 / Doctor 可见）。
- Engine / Desktop（内测指标表）：`team-growth-dashboard` 汇总一次过/改写/学习处理/路由命中/互审覆盖；`routing.resolve_ok` 审计；`GET /api/metrics/team-growth` + `POST …/baseline`；Doctor「团队成长 · 内测指标」可记基线对比；e2e mock + 设置页可见。
- Engine（信任）：合同修订积累在审核通过路径**不再静默写** `LAWYER_PROFILE`；关键修改点 → pending adoption（与手动 finalize API 一致）。
- Desktop（在办 IA）：常驻分区导航「待拍板 / 交出去的活 / 按流程办」；修正子页截断标题；设置「去在办」落到待拍板。
- Engine（R-P0-3）：`turn-orchestrator` 续拆 — intake/auto-wf 短路 → `turn-orchestrator-shortcuts.ts`；主循环 → `turn-orchestrator-model-loop.ts`（主文件 ~594→~368 行）。
- Desktop：设置「岗位」可编辑路由 defaults（byKind / byDeliverableType）；修 `--lm-fg` token；去掉已删侧栏的 automationsListVersion；在办 e2e 覆盖团队视图；案件洞察文案不再提已移除驾驶舱首页。
- Desktop / Engine（审查加固）：「沉淀学习」不再静默写入 `session-summary.md`（仅 pending）；在办深链按 session 精确匹配、按 matter 放开筛选；侧栏「待我拍板」默认选中首项办理。
- Engine：记忆检查 **采纳** 真正落盘——`applyMemoryAdoptionWrite`（`case.progress`→session-summary + CASE 进展；律师/助手 profile；争点/风险等 CASE 章节）。
- Engine / Desktop（团队成长 Wave A–C）：签批指标与「需修改→待教」；成长 API；默认路由 + Firm 强制互审；合同审查多步种子；**在办默认「团队」按助手聚合**（忙闲/一次过/待教下钻队列）；待教角标进记忆；修订完成 / 合同修订包回流 pending 学习。
- Docs：扩充「数字团队成长」详细工程计划（分方向成长模型、API/数据规格、Wave A–D DoD、Demo）→ `docs/LAWMIND-TEAM-GROWTH-PLAN.md`。
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
