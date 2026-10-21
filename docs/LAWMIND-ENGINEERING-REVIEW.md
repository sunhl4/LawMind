# LawMind 工程审查（2026-09-26）

审查对象是当时工作区里约 690 个未提交文件，加上 2026-09-24 的手册精修。结论先写在这里，避免下一轮再把已经删掉的界面装回去。

## 界面取舍（2026-09-27 确认，不要改回去）

这些页面和入口是有意删掉或收掉的。审查建议过「把离线开关、诊断包、MCP 装回设置」，**不执行**。

| 已删除或已收起                                                                  | 现在怎么用                                                                                                           | 不要做的事                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 系统健康 / 成绩单 / 用量统计 / 文书模板 / 本机能力档位 / 安全（工具沙箱）设置页 | 查找重建、案件整理在设置 → 工作区；Word 连接在设置 → 外观；许可在设置 → 账号                                         | 不要恢复「体检」整页，不要把成绩单画回设置 |
| 出网档位、分析脚本的界面开关                                                    | 仍由工作区根的 `lawmind.policy.json`（`network.mode` / `allowAnalysisScripts`）和 `PATCH /api/policy/workspace` 决定 | 不要在「模型与连接」里再加一排出网下拉     |
| 诊断包按钮、后台日志查看器                                                      | 端点还在：`GET /api/support/bundle`、`GET /api/daemon/log`。律师看到的是「你走后发生了什么」（`LawmindDaemonRecap`） | 不要把导出按钮放回账号页                   |
| 设置里的 MCP 页                                                                 | 页面组件已删。配置接口仍是 `GET/PUT /api/mcp/servers`                                                                | 不要把「外部工具」再画回设置               |
| 对话模型选择器只列自己添加且已配置的模型                                        | 内置目录和平台模型不进这个列表                                                                                       | 不要改回「所有已配置模型都列出来」         |

对话长度三档、顶栏一级 **两个**工作面（对话 / 工作台）、账号页、平铺设置侧栏，都保持现在的样子。`agents`（在办）仍可进入，但不占顶栏一级 tab：入口是「待我拍板」、命令面板 `/agents`，或设置 → 协作里的「去『在办』处理」。改稿与整理资料只在已经进入后出现次级 tab。类型里的 `meeting` 不是可进入的工作面，不要把会议室 tab 装回去。

**手册与界面冲突时，以当前桌面壳为准**（`LawmindAppHeader.tsx`、`LawmindFirstRunDialog.tsx`、`lawmind-settings-nav.ts`），不要按旧文档把「在办」一级 tab 或首跑习惯问卷装回去。

## 已经修好、且不碰界面的问题

这些是代码或门禁，不是把界面改回去。

- `safeCommand` 显式环境不再剥掉 `BRAVE_*`。lawmindd 的联网检索需要这把钥匙；加载器钩子和凭据根仍然剥掉。
- 助手在场和名册检索用 `session.sessionId`，不再读不存在的 `session.id`。
- 事件日志撕尾：单条超过 1MB 窗口时放弃修复，不再把整份日志截成空文件。
- 审查矩阵批注改为原子写加文件锁。
- 事件自动化在锁内复验最小间隔，桌面和 lawmindd 不会对同一事件各跑一次。
- 演示语料闸门只看试检之前的主检索；`force_render` 这条演示旁路不再被闸门先拦死。引用门禁拦截记为 `citation_gate`，不再冒充渲染引擎故障。
- 策略文件里的 `toolSandbox` 已被合同拒绝，沙箱只认 `LAWMIND_TOOL_SANDBOX=1`。团队记忆同步的门保持关闭：那个键不能写进策略文件，也没有别的开关。密钥扫描函数留着，给以后的传输用。
- 编译错误（版本类型重复导出、`redacted` 不回灌草稿、`writeSync` 参数）已清掉。
- 文案 lint 的多行 import 误报、`styles.css` 与源模块不同步、文件大小基线指向已删文件，都已收口。
- 19 个超时测试改走本机 cassette；18 个仍在断言旧策略合同的测试已改到新合同。
- 手册里「体检页」入口、顶栏工作面、第四种自动化触发、新端点，已按当前桌面壳改过。没有把删掉的设置页写回操作步骤。若手册仍写「顶栏三个一级 tab / 五个工作面含在办一级」，以界面为准改手册，不要改界面去迁就旧表述。

当时复验：全量单测 5879 通过，桌面 e2e 58 通过，引擎与桌面 typecheck 无错误，文档站能构建。

## 后续只做非界面项

| 项                           | 状态                 | 做法                                                                                                                                                                                                |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本地 API 的类型检查          | 已有，写明了         | `pnpm typecheck:desktop-node` 覆盖 `apps/lawmind-desktop/server/` 和 `electron/*.ts`。`pnpm --filter lawmind-desktop typecheck` 只覆盖渲染进程。日常说明写在 `docs/lawmind/DEVELOPER-WORKFLOW.md`。 |
| 引擎测试不许 stub 全局 fetch | 已接门禁             | `pnpm lawmind:check:no-global-fetch-stub`，进 `lawmind:verify` 和 CI。口径在手册第 35 章。                                                                                                          |
| 收口前跑完整验证             | 已写进工作流         | 迁移收口跑 `pnpm lawmind:verify`，不要只跑 `pnpm test`。                                                                                                                                            |
| 引擎相邻目录                 | 已写分工，不合并     | 见 `docs/LAWMIND-REPO-LAYOUT.md`「相邻目录」表。                                                                                                                                                    |
| 工作台纯函数外移             | 已做，屏幕不变       | 日期、期限、今日条目排序在 `lawmind-lawyer-desk-format.ts`。`LawmindLawyerWorkbench.tsx` 的版式和文案不动。                                                                                         |
| 工作台继续拆组件             | 不做，除非单独开任务 | 主文件仍然大。下一次拆必须只搬无界面逻辑，不能改律师看到的结构。                                                                                                                                    |

没有设置入口的页面组件已删（`LawmindSettingsMcp.tsx`）。MCP、整理进案件（`POST /api/historical-scan/file`）、诊断包和后台日志仍留着接口，给以后的内置步骤用，不在界面上开口。团队记忆同步的上传门保持关闭，密钥扫描函数留着。对话里旧的「显示工具过程」偏好键还在读，只是没有设置开关，也没有把开关加回去。

## 记忆长期使用（2026-09-27）

引擎 + 桌面双门复审与外链调研见 [LAWMIND-MEMORY-LONGTERM-REVIEW.md](./LAWMIND-MEMORY-LONGTERM-REVIEW.md)。结论：Markdown + 确认后落盘的方向保留；优先补真失效/撤回、跨案摘录过门、审核标签与设置文案一致。不把已删设置页装回去，也不整仓换 Mem0/Graphiti。

## 手册对齐当前界面（2026-10-09 复核）

以桌面壳为准改手册，没有改界面迁就文档。律师日常路径：

- 顶栏一级：**对话 / 工作台**（`lm-tab-workspace` / `lm-tab-desk`）。没有「在办」一级 tab。
- **在办**（`mainView === "agents"`）：有待决策时侧栏或顶栏「待我拍板」进入并聚焦收件箱；命令面板 `/agents`；设置 → 协作深链「去『在办』处理」。点「待我拍板」会带上待决策筛选；从协作深链进办理列表时不自动套该筛选。
- 改稿、整理资料：只在已经进入后出现次级 tab。侧栏在工作台、改稿、整理资料上不挂载，这三面有待决策时「待我拍板」改到顶栏。
- 首跑（`LawmindFirstRunDialog`）：单步，**只选身份**（独立执业 / 律所协办 / 合伙人），选完即建演示案件开工；**不**选文书类型，也**不**问行文/风险/对客习惯，更不写冷启动风格偏好。重开入口：**设置 → 账号 → 开始时的偏好 → 重新填写**（不是「高级」）。
- 设置侧栏平铺：账号、模型与连接、工作区、外观、协作、自动办件、记忆库、免责声明。原「系统健康」已拆到工作区 / 外观 / 账号，不要写回整页。
- 改稿按钮文案一律是「改稿」。

`meeting` 留在 `LawmindMainView` 里，但 `LawmindMainBodyContent` 不渲染 `MeetingView`，顶栏没有会议室，输入条「+」也没有。`onOpenTopLevelMeeting` 打开的是对话。`e2e/meeting-flow.spec.ts` 守着入口已撤。手册第 2.4、16.7、24.5、34.8、50.3、62.1 与律师快速指南已按这个事实改过。

### 死代码：删还是留

| 代码                                                                                           | 决定           | 原因                                                                                                           |
| ---------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------- |
| `lawmind-meeting-nav-bus.ts`                                                                   | 删除           | 没有任何引用。注释里的「从输入条 + 打开会议室」已经不存在。删它不改变界面。                                    |
| `MeetingView`、`MatterTeamMeeting*`、`pickMeetingViewProps`、`lawmind-meeting-deliberation.ts` | 保留           | 产品壳不挂载，单测还在。删掉要改顶栏和侧栏里对 `mainView === "meeting"` 的分支，那是界面文件。这一轮不动界面。 |
| `src/lawmind/cases/team-meeting.ts` 与委派里的 `appendTeamMeetingLinesSync`                    | 保留           | 委派仍会往 `team-meeting.jsonl` 写系统行。这是留痕，不是死屏幕。                                               |
| `SETTINGS_NAV_RETIRED_ITEMS` 与旧分区重定向                                                    | 保留           | 老的上次停留分区和深链不能崩。`doctor` 深链渲染空白是有意的。                                                  |
| MCP 配置接口、诊断包、后台日志                                                                 | 保留           | 界面不上这些入口。端点留给以后的内置步骤。不要把页面画回去。                                                   |
| `LawmindCollaborationDesk`                                                                     | 保留，而且在用 | 嵌在「在办」的「交出去的活 / 按流程办」，不是设置页残骸。                                                      |
| 案件页签类型里的 `"meeting"`                                                                   | 保留           | `MatterWorkbenchTabs` 不渲染这一项。从联合类型里拿掉要动卷宗页签的类型，留到单独的清理，不在这一轮改界面文件。 |

## 本机 git stash 存档说明（勿直接 pop 到 main）

下列两条 stash **只存在于部分开发机本地**，不在 GitHub 上，也**不是**当前 `main` 缺的功能备份。记录在此，避免后人把它们当成「量子内核前的旧 agent」或误 `stash pop` 冲掉工作区。

| stash       | 大约日期   | 当时分支 / 信息                                                                    | 实际内容                                                                                   | 与现行 main 的关系                                                                                           | 建议                                                                                                                                                            |
| ----------- | ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stash@{0}` | 2026-09-18 | `matter-replica-collab`：`wip-matter-replica-before-chat-fill-on-main`             | 案件副本协作（relay / invites / 材料同步）+ 少量 chat send / orchestrator 接线，约 29 文件 | **matter-replica 产品线已在 main**（默认关）。stash 是切去改 chat-fill 前的未完成 WIP，不是另一套 agent 内核 | **不要** `pop` / `apply` 到共享 main。若要续做副本功能，从当前 `src/lawmind/matter-replica/` 开分支；需要对照时用 `git stash show -p stash@{0}` 或单独 worktree |
| `stash@{1}` | 2026-09-17 | `engineering-review-trust-gates`：`WIP trust-gates + mixed; isolate replica later` | 工程审查当时的大杂烩：信任门、工作台、聊天壳、设置文案等，约 135 文件                      | 审查结论与大量修复合并进 main 后，这包已过期；与 matter-replica / 因子态无关                                 | **不要**合并。只作考古：`git stash show --stat stash@{1}`                                                                                                       |

**易混点**：matter-replica（多律师案件副本同步）≠ `factor-state` / `LAWMIND-FORWARD-AGENT.md` §9 的量子启发因子态。后者是交件与证据跨度；前者是可选协作产品，默认关闭。

**并行规矩提醒**：共享工作区禁止无 pathspec 的 `git stash push`（见 `AGENTS.md`、手册第 18.8 节）。这两条是历史遗留；新工作用 `git worktree add`，不要再往共享 stash 栈堆。

## 已落地（2026-10-19 · Agent loop P0/P1/P2：策略表 · TurnProfile · 回合回放）

针对「主循环是补丁集合、领域启发式长在通用循环里、缺真实质量证据」三项，做了一轮**行为不变**的结构收敛。

### P0 · 策略表 + 结构化停因

- 新增 `src/lawmind/agent/turn-loop-policies.ts`：`TOOL_ROUND_POLICIES`（写前合成 / 诉状要件 / 追问清单 / 备忘录结构 / 计算参数 / 命令拒绝 / 重复调用）与 `COMPLETION_POLICIES`（prose / 澄清 / 同轮验收 / 上下文退让 / Word 导出 / 审核台推诿 / 缺件 / steer），**顺序显式、首个命中生效**。
- 新增 `src/lawmind/agent/turn-loop-state.ts`：`LoopFlags` 收拢原先十几个并列 `let`；`TurnStopReason` 成为持久化字段（`AgentTurn.stopReason`），并由 `stopReasonBucket()` 归入交付 / 待律师 / 预算 / 模型错误 / 中止。
- `runModelToolLoop` 的两条 if 链改成「构造 facts → 跑策略 → 执行 action（`resample` / `stop`）」。`compactMidTurn(..., true)` 通过 `forceCompact` 保留原退让行为。
- 新增 `AgentTurn.roundCount` / `profileId`；收口时 `upsertSessionTurn` 与 `appendTurn` 一并写入。
- 单测：`turn-loop-policies.test.ts`（14 条，含策略顺序、重复/读毕/命令拒绝、澄清与验收封顶、退让交接、steer）。

### P1 · TurnProfile 外置交付形态

- 新增 `src/lawmind/agent/turn-profile.ts`：`resolveTurnProfile()` 一次性给出 `id`（word_revision / mail_contract / pleading / memo / consult / contract_review / general）、可用 coach 集合、`requiresTrackedDraft`。
- 主循环不再直接调用 `instructionFramesPleading / MemoDeliverable / ConsultQuestions`；只问 `profile.coaches.has(...)`。这把三个 frame 谓词收敛成每回合一次解析；**尚未**做到「新增交付形态只改 profile」——仍要动 `deliverable-shape.ts` / profile / 策略表三处（见文末深度复评）。

### P2 · 真实回合回放（质量证据）

- 新增 `src/lawmind/evaluation/turn-loop-replay.ts`：读 `sessions/*.turns.jsonl`，输出完成率、停因分布、均值/p50/p95 轮数与工具数、反弹收敛率、按 profile 分组。
- 新增 `scripts/lawmind/lawmind-turn-replay.ts` + `pnpm lawmind:turn-replay`；无真实回合时打印 SKIP，`--strict --min-turns` 才非零退出。
- `src/lawmind/evaluation/README.md` 增补第 5 层，明确「cassette 管准入，回放管质量」。

### 验证

- `turn-orchestrator-cassettes.test.ts` 135 条全绿（假模型、真 `runTurn`、真工具表）；连同 model-loop / policy / replay / same-turn-verify / tool-pipeline 共 **289 条通过**。
- `tsc --noEmit`：本次新增/改动文件零错误（仓库 HEAD 既有的 `projectDir`、`tabStops`、`build-agent-fleet` 等 10 处仍为历史红，见前文 §1.1）。
- `oxlint`：新增模块零告警。

### 剩余风险

- 模型调用层的重试/溢出/空 choice 分支仍在循环内联（每个只跑一次、状态简单，收益低于风险，留给下一轮）。
- P2 的 50 条真实回合需要律师实际使用后才有；在拿到之前，回放只能打印 SKIP，**不得用 cassette 或夹具冒充完成率**。

### 续做（同日第二段 · 预算硬停 · 真实回放 · 基准复跑）

**代码**

- `resolveToolBudgetStop()` 把步数硬顶的四条分支（验收红 / 带占位澄清 / Word 改稿 / 普通交付）从循环内联搬到策略模块，单测覆盖；`consumedClarificationQuestions` 保留原先「只有澄清分支清空 pending」的语义。
- 收尾段的 SSE 顺序用 `beforeBounce` 接缝保持原样（先吐正文段，再执行反弹副作用）；steer 反弹仍按原行为给 assistant 行补机械注记。
- `ctx.capabilityId` 只作诊断写进 `turn.profileId`；短路交付、用户中止、暂停也写 `stopReason`，避免「字段有了但一半路径没有」。
- `lawmind:turn-replay --scan` 自动发现一次评测下的 per-task workspace；历史行标 `legacyRows` 并在报告里注明「不等于真实停因分布」。

**验证（本机，2026-10-19 夜）**

- `src/lawmind/agent` 全量：**187 文件 / 2216 测试通过**。
- PLawBench 9 题切片（同一 judge、同一模型）复跑：**9/9 完成、0 失败**，mean **0.7388**；同日较早基线（`slice-report-full.json` 同 9 题）mean **0.6674**。逐题 6 升 3 降（-0.19 ~ +0.42），单裁判噪声范围内。
- 新回合落盘字段实测：`stopReason=delivered`、`roundCount=5`、`profileId=general` 均可从 `*.turns.jsonl` 直接读到；`turn-replay --scan` 在该次评测上给出 `general 4 / pleading 3 / consult 2`，与题目形态一致。

### 深度复评（同日 · 独立审查 + 修正）

对上一段改动做了一次独立对抗性审查（`git show HEAD:` 旧循环逐行对照），确认并修正 4 个**真实行为差异**与若干观测口径问题：

| #   | 级别  | 问题                                                                                                                                                     | 修正                                                                                                                                                                             |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | BLOCK | 旧循环五段教练是**顺序执行、可同时命中**；策略表首个命中即返回，丢掉同轮第二条 nudge（`追问清单-8.md` 会先发追问、再补备忘录结构，可能把清单改成备忘录） | 拆成 `TOOL_ROUND_COACH_POLICIES`（全执行、消息合并为一次 resample）+ `TOOL_ROUND_GUARD_POLICIES`（首个命中）；cassette 断言 request(1) 同时含两个 marker，且 memo nudge 只推一次 |
| 2   | WARN  | Word 改稿 + 「只列追问」丢了 `frameConsult` 检索锁                                                                                                       | `word-revision` profile 的 `locksSearchAfterSynthesis = framesConsult`；新增 cassette 断言 request(0) 不广告法条检索                                                             |
| 3   | WARN  | 轮次上限退出且无 break 时被记为 `delivered`                                                                                                              | 新增 `round_ceiling` 停因                                                                                                                                                        |
| 4   | WARN  | 短路交付把调用方已设的 `awaiting_approval` 记成 `delivered`；iCloud 快停没有停因                                                                         | 短路收口按前置 status 记停因；iCloud 路径写 `awaiting_clarification`                                                                                                             |
| 5   | WARN  | 回放头条「干净交付率」把【待核实】草稿、短路回复算成干净                                                                                                 | 干净交付只数**有记录**且 `stopReason === "delivered"`；另列 `recordedRows` / `legacyRows` / `legacyRoundRows`                                                                    |
| 6/7 | WARN  | `--since YYYY-MM-DD` 按 UTC 解释；`--since --json` 会静默禁用过滤                                                                                        | 日期按本地零点；缺值 exit 2 并打印用法                                                                                                                                           |
| 8   | WARN  | `--scan` 遇到根目录自带 `sessions/` 就停止下潜，漏掉 per-task workspace                                                                                  | 继续下潜并去重；补根 + 嵌套测试                                                                                                                                                  |
| 9   | WARN  | `final` 事件的 `stopReason/roundCount` 没进 SSE                                                                                                          | 服务端转发两个字段                                                                                                                                                               |
| 12  | INFO  | 「预算」桶混了步数上限与模型打转                                                                                                                         | 新增 `loop_guard` 桶（重复 / 读毕再读 / 命令拒绝）                                                                                                                               |
| 13  | INFO  | 抽取留下死字段/死教练                                                                                                                                    | 删除 `ToolRoundFacts.emit/roundIndex`、`hideAssistantMessage` action、`TurnProfile.capabilityId/pins`、`word_revision_export` coach                                              |
| 14  | INFO  | 跨 workspace 去重键只用 `(sessionId, turnId)`                                                                                                            | 键加入 workspace 根路径                                                                                                                                                          |
| 15  | INFO  | 退让事件早于历史写入                                                                                                                                     | `afterMessagePush` 恢复 push → emit → record 顺序                                                                                                                                |

审查同时指出：`TurnProfile` 目前只是**部分**收益（三个 frame 谓词收敛为一次解析），并没有做到「新增交付形态只改 profile」——仍要动 `deliverable-shape.ts` / profile / 策略表三处。这一点保留原样，不再宣称更强的解耦。

修正后验证：`src/lawmind/agent` 全量 **188 文件 / 2229 测试通过**；cassettes **139 条**（+4 条针对上述差异的准入断言）。

### 基准复跑结论（9 题 · 同日三次）

同一 judge（deepseek-flash 单裁判）、同一模型、同一 9 题切片，三个时点：

| id          | 旧基线    | 首跑（策略表首命中） | 终版（修正 co-fire） | 极差      |
| ----------- | --------- | -------------------- | -------------------- | --------- |
| case-8      | 0.853     | 1.000                | 1.000                | 0.147     |
| case-9      | 0.833     | 0.889                | 0.778                | 0.111     |
| case-112    | 1.000     | 0.933                | 0.933                | 0.067     |
| case-32     | 0.438     | 0.562                | 0.438                | 0.125     |
| complaint-4 | 0.263     | 0.495                | 0.463                | 0.232     |
| complaint-6 | 0.720     | 0.790                | 0.810                | 0.090     |
| defense-5   | 0.284     | 0.705                | 0.526                | **0.421** |
| consult-1   | 1.000     | 0.812                | 0.875                | 0.188     |
| consult-5   | 0.615     | 0.462                | 0.385                | 0.231     |
| **均值**    | **0.667** | **0.739**            | **0.690**            | —         |

结论要写清楚：**逐题极差最大 0.42，均值差 0.05–0.07 落在噪声里**。这证明的是「改动没有引入可见质量回归、9/9 都完成、轮数/工具数正常」，**不能**证明「分数提升」。要检测质量变化，至少需要 50 题以上或同一题多跑取均值；单裁判 9 题只能当烟雾报警器。

### 审查遗留项关闭（同日 · 补测试）

审查里「测试缺口」一节逐条补上，避免同一类回归再静默通过：

- **同轮双教练**：`turn-loop-policies.test.ts` 新增 consult + memo 同轮断言（拒绝把追问清单改成备忘录）；cassette 同时断言 request(1) 含两个 marker，且 memo nudge 全轮只推一次。
- **Word 改稿 + 只列追问**：新增 cassette，断言 request(0) 不广告 `search_statute` / `search_case_law`。
- **教练覆盖**：新增写前合成（含 `synthesisSearchLocked` 迁移）、计算参数连续失败、缺件 nudge、审核台推诿反弹各一条。
- **短路收口**：`finishShortCircuitTurn` 三态（running / awaiting_approval / awaiting_clarification）的 `stopReason` 与 `roundCount=0`。
- **SSE 消费者**：route-chat 测试断言 `final` 事件带 `stopReason` / `roundCount`（此前新字段只在 JSONL，运行时窗口拿不到）。
- **回放**：跨 workspace 相同 `(sessionId, turnId)` 不再合并；`maxDirs` 截断有测试；日期型 `--since` 按本地零点。
- **仍未覆盖**（如实记录）：`prose_syndrome` 不可达（`applyProseSyndrome` 恒返回 `none`，保留策略位以免将来启用时改语义）；CLI 参数解析本身没有单测（只在 `tmp/` 冒烟）。

修正后：`src/lawmind/agent` + `runtime` + 回放 + chat route **207 文件 / 2434 测试通过**。

## 已落地（2026-10-21 · 内测发布收口）

目标：把工程抬到「可以打包给内测客户」的水平。以门禁能否自己变绿为准，不以叙述为准。

### 全量验证（本机 macOS arm64）

| 门禁                                                                               | 结果                                                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:coverage`                                                               | **1095 文件 / 7902 测试通过**（4 skipped，2 文件 skipped），168s                                                                 |
| `pnpm typecheck` / `--filter lawmind-desktop typecheck` / `typecheck:desktop-node` | 三份全绿                                                                                                                         |
| `pnpm lawmind:desktop:e2e:pr`                                                      | **52 通过 / 2 skipped**（原先 8 失败）                                                                                           |
| `pnpm lawmind:verify`                                                              | 全链绿（覆盖率、棘轮、技能 golden、三份 typecheck、bundle、CSS、node 导入、文案、fetch stub、平台契约、HTTP 冒烟、发布就绪报告） |
| `pnpm lawmind:desktop:dist`                                                        | 产出 `release/LawMind-0.2.2-mac-arm64.dmg`（另有 zip）                                                                           |

### 真实缺陷（不是测试问题）

1. **BLOCK · 设置 → 协作 整块静默消失**。`LawmindSettingsPage` 收下了 `delegations / collabEvents / gateHistory / formatRelativeTime / onRefreshCollaboration`，但组 `renderSettingsSection` 的 args 时**没有转发**；`SettingsCollaborationDeskHost` 的守卫直接 `return null`。结果：设置里只剩一行「状态与入口」，交出去的活 / 按流程办在设置中打不开，且没有任何报错、没有测试守着。
   - 修复：补齐转发；把静默 `return null` 换成律师能看懂的状态行（`lm-collab-desk-missing`，带 `data-missing` 便于断言）。
2. **WARN · 打包被第三方二进制下载打断**。`vendor-officecli` 只比对 `VERSION` 哨兵，本机二进制实际是 v1.0.152、哨兵写 1.0.149，于是每次打包都重新下载；下载超时就让 `dist:electron` 整条失败。
   - 修复：下载失败但本机已有**可运行**副本时复用它，并把哨兵对齐实际版本；再次运行直接跳过。校验和与版本不一致的硬失败保持不变。

### e2e 腐烂（8 条失败，4 类根因）

| 根因                                                                                                                                                                | 处理                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `openReviewDraft` 被改成只点一级 tab，但仍有 6 条用例靠它打开审核台 → 用例在「工作台出现了」就变绿，审核台断言根本没跑                                              | helper 真的派发 `lawmind:open-draft-desk` 产品事件并等 `lm-middle-draft-desk`；另加 `openDeskTab` 给「不该打开改稿台」的用例 |
| 审核台住在中栏，而中栏要 `canUseFilesystemBridge` 才显示；stub 没有 `fsList`                                                                                        | `installE2eBrowserPrefs(page, { filesystemBridge: true })` 显式开关                                                          |
| 断言陈旧：侧栏早已平铺含「协作」；`lm-agent-fleet-page` 不是审核台；签批条折叠在「高级 · 签批」；回合进行中的第二句已改为进会话收件箱（`/followup`）而不是 `/steer` | 逐条改到当前合同；补 `ensureReviewMetaPaneVisible`；mock 补 `/followup` 与 `/followup/claim`                                 |
| 用例自己的定位器不稳：`getByPlaceholder` 在回合进行中会失配（占位符换成「这一轮还在办…」），导致 `fill` 一直等回合结束                                              | 改用 `getByLabel("消息输入")`，并在注释里写清为什么                                                                          |

### 文案与门禁口径（按「一动作一词」收敛）

- `syn.pizhun`（批准作动词）：**32 → 6**。外发、工具确认、审批条、待发列表统一为「签批 / 签批发送 / 签批并继续」；引擎侧的自动化结果文案同步（`文书台` 一并去掉）。
- `syn.xiuding`：正则收窄为**动词框**（`改修订 / 要修订 / 按修订确认 / 修订草稿 / 修订完成 / 后台修订 / 修订中`）。Word 痕迹是领域名词（看修订、接受此修订、修订栏/线/卡/提案/署名、他人修订、无修订），不再当同义词抓。
- 棘轮地板合计 94 → **59**（`批准 6 / 修订 13 / 待办 13 / 审批 27`），术语表补记保留用法。
- 覆盖率地板原本比实测低 6–7 个点（永远先绿、后期可无声跌回），按脚本自身要求收紧到实测值：statements 62.77→**69.46**、branches 53.27→**59.95**、functions 61.99→**70.14**、lines 62.88→**69.53**。
- 删除遗留调试 spec `e2e/_debug-review.spec.ts`（被 testIgnore 隔离、含 console.log、断言的是已撤的界面）。

### 仍然挡在「对外发布」前面的（本机无法自行消除）

1. **签名与公证**：`electron-builder` 报 `cannot find valid "Developer ID Application" identity`，当前是 adhoc 未签名包。浏览器下载后 Gatekeeper 会拦，内测分发前必须提供 Apple Developer ID 证书并公证。
2. **80% 基准只能由真实模型跑分证明**：`lawmind:benchmark --mode scripted` 的分数是影子回放的**文本重叠率**（本次 19.4%），按仓库自己的口径不能当质量证据；`lawmind:verify:release` 因此必然红，直到在有授权的真实材料上跑 `--mode real`。
3. **`officecli` 视觉用例 1/7904 并发抖动**：单独跑 3/3 稳定，全量并行下偶发失败；`renderPptxSlideScreenshot` 已有落盘大小校验，属环境争用，未改产品逻辑。
4. 引擎侧仍有「批准发送」出现在工具描述/工具结果里（不在 renderer 文案门禁扫描面内）。渲染层与引擎现在口径不一致，下一轮按同一术语表收敛。
