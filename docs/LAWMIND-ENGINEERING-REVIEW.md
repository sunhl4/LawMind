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

## AI 原生工作流 P0：统一收件与判案归档（2026-10-26）

这轮把“邮件/投递文件先进入统一收件，再决定归入哪个案件”的第一段真链路落地。它不是普通的按案邮箱同步，也不是让模型直接读取一个全局收件箱：未归档原文默认标记为不可信，并被 `lawmind/` 与 `收件投递/` 读写边界挡住；只有归档后才进入案件目录，进入现有办件、检索和交付链路。

### 已落地的路径

- `src/lawmind/intake/types.ts`：来件、候选案件、判案结果、归档流水和内容寻址附件的契约。
- `src/lawmind/intake/store.ts`：`<workspace>/lawmind/intake/` 下的幂等入库、原件哈希、超长正文 blob、线程索引、事件日志和状态水位。
- `src/lawmind/intake/resolve.ts` / `matter-index.ts`：案号、案件标识、已核验联系人、邮件线程等强键；分数只用于候选排序，不单独放行自动归档。
- `src/lawmind/intake/filing.ts`：把邮件物化到 `cases/<matterId>/mail/inbox`，把文件物化到 `cases/<matterId>/materials`；律师撤回时只删除未被改动的物化文件。
- `src/lawmind/intake/dropzone.ts`：`<workspace>/收件投递/` 投递口。`收件投递/<案件 ID>/` 是明确案件提示；已处理原件移入 `收件投递/已入库/`。
- `src/lawmind/intake/mail-intake.ts` / `tick.ts`：收案邮箱的 IMAP UID / Graph 时间水位、首次同步最近 7 天窗口、每批上限、重复入库保护和守护进程 tick。
- `apps/lawmind-desktop/server/lawmind-server-route-mail.ts`：收件列表、单条查看、事件、同步、归案、忽略、恢复、撤回接口；普通案件邮箱接口保持兼容。

### 自动归案边界

1. 恰好一个未结案件命中强键（已归档线程、案号、明确案件目录、唯一已核验联系人），且邮件 DMARC 没有失败，才允许系统自动归档。
2. 名称、主题相似度和未核验联系方式只能形成候选，不能因为分数高就自动归案。
3. 发件域认证失败的邮件必须进入律师候选队列，即使发件地址曾登记过。
4. 收案邮箱设置为 `intakeInbox: true` 后，不得绑定为某一案件的默认邮箱；旧的按案邮箱只有明确绑定案件时才继续按案同步，避免一封全局收件箱被每个案件重复拉取。
5. 收件正文、附件和投递口文件都属于外部数据，不是 Agent 指令。任何对外发送仍走现有交付绑定和律师审批，不由收件 tick 直接发送。

### 桌面使用方式

在设置的邮箱区域，新增邮箱时可勾选“作为收案邮箱，统一收件后由 LawMind 自动判归案件”。收件同步由桌面服务和 `lawmindd` tick 触发；律师通过 `/api/intake/items` 对低置信条目选择归案、忽略或恢复。归案后材料才出现在对应案件的邮件/材料区域。

这轮暂不接个人微信逆向读取、企微会话存档解密或电话录音转写。个人微信继续采用律师转发/投递口路径；企微和录音属于后续通道适配器，不能绕过本收件契约。

### 后续接续顺序

- P1：收案闸门（利益冲突、委托确认、AI 使用告知、案件从 `intake` 到 `active` 的人工确认）。
- P2：企业微信官方会话存档和本机录音转写适配器，均只产生 `IntakeItem`，不另建第二套案件真相源。
- P3：按案种与阶段生成办案剧本，并把每个交付物接入可重启的耐久工作流。
- P4：交付包审阅舱、收件人核验、版本绑定和基于首过率的渐进自治。

验收命令：`pnpm exec tsc --noEmit -p tsconfig.json`、`pnpm exec tsc --noEmit -p apps/lawmind-desktop/tsconfig.json`；本轮相关测试共 111 条通过、1 条跳过，覆盖统一收件、邮件、联系方式、归案/撤回、主机访问边界、自动办件 runner 和桌面收件路由。不要把这组 P0 当成完整的 AI 原生律所交付闭环；它只建立了“通道 → 统一收件 → 判案 → 进入案件”的安全底座。

### P0.1 水位与重试硬化（2026-10-26 续）

- **空邮箱不再重复首次同步**：首次同步无论拉没拉到信都会写入 `initializedAt`；IMAP 空箱落 `lastUid: 0`，Graph 空箱落时间水位。第二轮起不再套用「最近 7 天」窗口。
- **首次窗口下界只用于查询**：`IntakeMailCursor.bootstrapSince` 只在首轮拼进查询，成功写状态时清掉；不会变成长期水位把旧信永久挡在外面。
- **失败不推进水位**：异常分支只写 `attemptedAt` + `error`，保留原 `uidValidity` / `lastUid` / `receivedSince`；下一轮从原水位重试。
- **Graph 分页**：`fetchGraphMessagesPage` 返回 `@odata.nextLink` 并落进 `graphNextLink`，一批拉不完时下一轮接着翻页；`nextLink` 只接受 `https://graph.microsoft.com/` 前缀。
- **边界与幂等**：首轮 7 天窗口按 `>=` 比较（同一时间边界不丢），重复拉取靠 `externalKey` + `Message-ID` 去重。
- 回归：`src/lawmind/intake/mail-intake.test.ts`（空箱首轮 / 空箱二轮 / 失败不推进 / 恢复重试 / 边界时间 / 同刻多封 / 重复入库）。

### P0.2 桌面待归案（2026-10-26 续）

**界面落点（复评后修正）**：交办册「在办」主体在 2026-09-30 的 `f79fe4e95` 里已并入工作台，`AgentFleetView` 自那以后没有任何挂载点，⌘K 的「在办」只会渲染工作台。因此待归案不再挂到交办册，而是**并入工作台**（今日提醒上方的一块「待归案」），不新增一级页面：

- `apps/lawmind-desktop/src/renderer/LawmindIntakeInbox.tsx`：工作台里的待归案收件箱——左侧列表（主题、发件人、判案结论），右侧详情；空的时候整块不渲染，不占版面。
- 详情面板 `LawmindIntakeDetail.tsx`：主题、渠道、发件人、收到时间、DMARC 结论；候选案件按强/弱线索分列（案号、案件编号、已核验邮箱、登记邮箱、当事人姓名、往来线程）；附件按名称与大小列出，被跳过的附件标出原因；原文预览 2,000 字。
- 可归入案件取自 `/api/matters/overviews`（全工作区），不取工作台列表：后者会按门类筛选，不能当作全集。
- **归案与忽略**：「归入案件」（未选案件时禁用）与「忽略」都走已有 `/api/intake/items/*`，不经工具签批路径。
- **记住发件人**：勾选后 `attach` 带 `rememberSender: true`，服务端把发件地址写成本案**委托人**名下的已核验邮箱（`source: intake_confirmed`）；本案没有委托人时不写，也不假装成功。
- **API 侧保留队列 seam**：`platform/build-agent-fleet.ts` 仍把待归案映射成 `queue_item`（`intakeItemId`），`/api/agent-fleet` 可读；交办册 UI 被重新挂载时不需要再改服务端。**当前没有任何 UI 挂载 `AgentFleetView`**，这是既有状态，不在本轮改动范围内。
- 回归：`src/lawmind/intake/store.test.ts`（记住/跳过发件人）、`apps/lawmind-desktop/server/lawmind-server-route-mail.test.ts`（路由透传）、`LawmindIntakeDetail.test.tsx`、`LawmindIntakeInbox.test.tsx`、`LawmindAgentFleetDetail.test.tsx`（收件行不出现签批）。

来件详情里已能直接看附件原件（P2.20：PDF / 图片 / 文本内联，其它类型下载）；多候选案件的对照表见 P2.21。

### P0.3 新案线索（2026-10-26 续）

没有可靠案件候选的来件，不再只有「归案 / 忽略」两条路：律师可以把它明确记成新案线索。

- 模型：`IntakeItem.lead = { stage, at, by, matterId?, note? }`，阶段为 `new / needs_info / conflict_pending / declined / accepted`；事件流新增 `lead` 事件，记录每次推进。
- 状态机（`src/lawmind/intake/lead.ts`）：
  - `needs_info`（待补资料）、`conflict_pending`（待冲突检查）不改来件状态，仍在待归案队列；行文案变成「新案线索 · 待补资料 / 待冲突检查」。
  - `declined`（婉拒）同时把来件标成 `ignored`，从队列离开；重新打开需要先回到 `new`。
  - `accepted`（进入收案）只能由律师用**自己填的案件名称**触发，创建的是 `status: "intake"` 的案件，并把这封来件物化进去。系统不会因为「像新案」自己接受委托。
- 同名案件已存在时直接拒绝（`matter_exists`）：把一封新来件并进已有案件等于绕过收案与冲突检查。
- 名称同时作为 `matterId`（沿用「文件夹名 = 案件名」），非法名称返回 `invalid_matter_title`，不落任何案件目录。
- 接口：`POST /api/intake/items/:id/lead`，`action` 为上述阶段或 `accept`，`accept` 必带 `matterTitle`。
- 回归：`src/lawmind/intake/lead.test.ts`（阶段推进 / 婉拒清队列 / 收案只建 intake / 同名拒绝 / 非法名称 / 已归档不可再开线索）、`apps/lawmind-desktop/server/lawmind-server-route-mail.test.ts`、`LawmindIntakeDetail.test.tsx`（无名称时「进入收案」禁用）。

`intake → active` 仍不在这一层：那是 P1 收案闸门（利益冲突、委托确认、AI 使用告知）的职责。

### P0.4 验收门（2026-10-26 续）

| 验收项                             | 证据                                                                                                                                                                                 | 状态 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| 自动归案只使用强键                 | `resolve.ts` 只在唯一强键且 `dmarc !== "fail"` 时给 `auto_attach`；`acceptance.test.ts` 覆盖「两案案号同时出现」「DMARC 失败」「无任何线索」三种必须停在律师手里的情况               | ✅   |
| 合成数据自动归案精确率 100%        | `intake/acceptance.test.ts`：7 条合成来件，4 条应自动归案，逐条核对落点，`correct / autoFiled === 1`；甲案里不存在乙案来件                                                           | ✅   |
| 跨客户错归为 0                     | 同上：`matter-a` 下的每条已归档来件都必须含甲案案号                                                                                                                                  | ✅   |
| 重复邮件只产生一条记录             | `store.test.ts` + `acceptance.test.ts`（`externalKey` / `Message-ID` 归一化后去重）                                                                                                  | ✅   |
| 失败重试不丢邮件                   | `mail-intake.test.ts`：失败只写 `attemptedAt`，恢复后从原水位重试                                                                                                                    | ✅   |
| 撤回不删律师修改                   | `store.test.ts`：律师改过材料后撤回，文件保留                                                                                                                                        | ✅   |
| 外部收件内容不能获得发送工具       | `acceptance.test.ts` 静态边界：`src/lawmind/intake/*.ts` 不得出现 `sendMailViaAccount` / `sendSmtpMail` / `sendGraphMail` / `send_email` / `mail/index.js` / `agent/tools`           | ✅   |
| 律师能完成待归案操作（桌面端到端） | `apps/lawmind-desktop/e2e/intake-filing.spec.ts`：工作台 → 待归案 → 核对原文/附件/认证 → 归入案件（带 `matterId` 与「记住发件人」）／填名称进入收案；已并入 `lawmind:desktop:e2e:pr` | ✅   |

E2E 的 mock 侧按作用域隔离且缺省为空（`POST /__e2e__/intake { seed: true }`），所以新套件不会改变其它二十个套件的首屏。

### P1.1 收案记录（2026-10-26 续）

`intake → active` 现在有了持久化闸门：来件只证明「有人找过来」，不证明律所已经接案。

- **状态机**（`src/lawmind/intake/admission.ts`）：`prospective → conflict_pending → lawyer_review → accepted | declined`。记录包括候选当事人（发件人 + 正文「原告：」「被告：」标签，保留原文标签）、来源来件、负责人、冲突扫描结果（每条命中带他案编号/当事人/来源）、风险告知、AI 使用告知、律师决定和完整时间线。
- **接受条件**：冲突扫描完成（`clear` 或 `hit`）、负责人已指定、两项告知都确认；有命中时必须给出书面 override 理由。`accept` 才把 `MatterRecord.status` 改成 `active`，并关闭旧的「完成利益冲突检查」待办；`decline` 不改案件状态。
- **落盘位置**：`lawmind/intake/admissions/<matterId>.json`，**不写进** `matters/<id>/`。冲突命中会带其他客户的案件编号和当事人名称，而 `lawmind/` 在 agent 工作区黑名单内；放进案件目录等于让本案对话读到别案信息。测试用 `isDeniedHostPath` 固定这条边界。
- **建案即建记录**：`acceptIntakeLead` 在创建 `intake` 案件时同步写入收案记录，案件仍停在 `intake`，等律师完成扫描/告知/决定；重复调用幂等。
- **外发闸门** `checkAdmissionGate`：只有 `accepted` 放行；未扫描、律师审核中、已婉拒都拒绝，并给出中文原因。admission 上线前已在办（非 `intake`）的案件没有记录，按祖父条款放行，避免锁死存量工作区。
- **接线**：`send_email`、`prepare_outbound_mail` 在入队前检查；`POST /api/automations/inbox/:id` 的 `approve_send` 在真正发送前再检查一次（队列里的旧信也不能绕过）。
- **API**：`GET /api/intake/admissions`、`GET /api/intake/admissions/:matterId`（带 gate）、`POST /api/intake/admissions/:matterId`，`action` 为 `assign / add_candidates / scan_start / scan / scan_run / acknowledge / accept / decline`。
- **审计**：新增 `matter.admission` 事件（action、status、admissionId、命中数），记录自身也保留 timeline。
- **回归**：`src/lawmind/intake/admission.test.ts`（状态机、命中 override、婉拒不改状态、重扫清旧命中、记录不被 agent 读到、幂等接受、lead 建案自动建记录）、`apps/lawmind-desktop/server/lawmind-server-route-admission.test.ts`（路由推进与命中拒绝）、`src/lawmind/agent/tools/legal/mail-tools.test.ts`（待发与发送工具在未收案时被拦）。
- **尚未接**：委托包、电子签占位和桌面收案单在 P1.3；冲突扫描已在 P1.2 服务化。桌面挂载已由 P1.5 补上。

### P1.2 冲突扫描服务化（2026-10-26 续）

冲突扫描从「工具里的一段循环」变成可复用的收案服务，扫描结果直接写进收案记录。

- **`src/lawmind/intake/conflict-scan.ts`**：`scanConflictOfInterest()` 对全部案件做确定性匹配（当事人身份 + 卷宗索引），覆盖在办、已结/前客户和工作区记忆；每个命中带 `matterId / partyName / reason / source`，来源区分为 `matter_record`、`matter_index`、`workspace_memory`。已挂载的本机文件夹仍由 `check_conflict_of_interest` 在它自己的会话上下文里补扫，服务层不猜。
- **一轮扫描一个动作**：`scanAdmissionConflicts()` 先 `beginConflictScan`（清掉上一轮命中），再扫描，再 `recordConflictScan`；异常时停在 `conflict_pending`，不会留下「部分命中却显示完成」的记录。
- **空扫描不是无冲突**：没有候选当事人时返回 `no_candidates`，状态保持 `prospective`；`accepted` / `declined` 的记录不能重扫。
- **律师补登候选**：`addAdmissionCandidates()` + API `add_candidates`，用于投递口来件没有发件人、或正文没有标签的情况。
- **命中不自动拒绝**：记录进入 `lawyer_review`，接受委托仍必须给出书面 override 理由；`GET /api/intake/admissions?status=lawyer_review` 就是当前可用的待拍板队列 seam。
- **回归**：`src/lawmind/intake/conflict-scan.test.ts`（当事人命中 / 索引命中 / 排除本案 / 已结标记 / 工作区记忆 / 空候选拒绝 / 补登后扫描 / 已决定不重扫）、`lawmind-server-route-admission.test.ts`（`scan_run` 命中来源、`add_candidates`）。
- **尚未接**：桌面工作台还没有收案单页面；命中目前通过 API 读取，P1.3 再接到案件页与委托包。桌面挂载已由 P1.5 补上。

### P1.3 桌面收案单（2026-10-26 续 · 第一阶段）

案件页的「档案」上方新增「收案」卡（`apps/lawmind-desktop/src/renderer/matter/MatterAdmissionCard.tsx`）：

- **开始收案**：`POST /api/intake/admissions` 为已存在的 `intake` 案件建记录；已存在时幂等返回。
- **候选当事人**：显示来源来件的发件人与「原告：」「被告：」标签；律师可补登委托人/对方/关联方。
- **冲突扫描**：一键 `scan_run`；命中逐条显示他案编号、当事人、原因和来源（`matter_record` / `matter_index` / `workspace_memory`）。
- **告知**：风险告知与 AI 使用告知两个确认；勾选即写回收案记录。
- **负责人**：缺失时可指定；接受委托前必须有负责人。
- **接受/婉拒**：有命中时必须填写书面 override 理由；接受后本地档案状态切到「办理中」并刷新案件页。婉拒保持 `intake`。
- **旧勾选框已移除**：`MatterProfileCard` 不再发送 `conflictCheckConfirmed` / `engagementAccepted`，避免只改 `matter.status` 就绕过扫描、告知与负责人。`/api/matters/profile` 与 `/api/matters/create` 仍保留这两个字段给旧客户端和 E2E 夹具，属于受信任的本地 API seam，不是产品入口；后续要收掉时需同步改 E2E helper。
- **样式**：复用 `lm-matter-*` 卡片与 `lm-input`/`lm-field` 控件令牌；新增样式在 `styles/matter-review-workbench.css`，已同步进 `styles.css`。
- **回归**：`MatterAdmissionCard.test.tsx`（开始收案 → 指定负责人 → 扫描 → 两项告知 → 接受；未完成时接受按钮禁用）、`apps/lawmind-desktop/server/lawmind-server-route-admission.test.ts`（建记录 + 扫描 + 婉拒）、`MatterOverviewBody.test.tsx` 等 11 个 matter 渲染测试。
- **委托包（第二阶段）**：`src/lawmind/intake/engagement-package.ts` 生成五份 Markdown 草案——委托代理合同、授权委托书、风险告知书、AI 使用告知与同意、报价单。每份顶部有「草案 · 由 LawMind 生成，须律师核对后使用」横幅；未填字段写成 `【待填：…】`，不替律师编条款。落盘在 `matters/<id>/收案/`，`manifest.json` 记录文件哈希与 `esign: { status: "placeholder", provider: null }`。默认不覆盖已有文件（律师可能已经改过），只有 `overwrite: true` 才重写。接口是 `GET/POST /api/intake/admissions/:matterId/engagement`；收案卡里有「委托人 / 律师费」两个输入和「生成委托包」，生成后列出五份文件与电子签占位。
- **回归（委托包）**：`engagement-package.test.ts`（五份文件 + 横幅 + 占位字段 + 已存在不覆盖 + 覆盖开关）、`MatterAdmissionCard.test.tsx`（生成后显示五份文件与电子签占位）、`lawmind-server-route-admission.test.ts`（生成 / 读取 / 409 已存在 / 覆盖）。
- **委托包 DOCX 导出（第三阶段）**：`src/lawmind/intake/engagement-package-docx.ts` 从 `收案/*.md` 的**当前内容**渲染五份 `.docx`；律师改过 Markdown 后再导出，Word 里就是新稿。版式走新增的 `formalDocument`：只有标题和正文，不写「致 / 自 / 日期 / 事由 / 保密」备忘录抬头、不写「一、结论」摘要、不追加「本备忘录…不构成正式法律意见」，也不写入审阅备注；正文里的 Markdown 管道表格由 `src/lawmind/artifacts/docx-tables.ts` 渲染成原生 Word 表格（细网格、表头加粗浅灰底、整行不跨页、跨页重复表头，列宽按内容分配），报价单不再拍平成文字行。默认不覆盖已有 DOCX，`overwrite: true` 才重写；导出记录写进 `manifest.json` 的 `docx` 字段，Markdown 的哈希不变。接口 `POST /api/intake/admissions/:matterId/engagement/docx`；收案卡有「导出 DOCX / 重新导出 DOCX / 覆盖并重新导出」。
- **回归（DOCX 导出）**：`engagement-package-docx.test.ts`（五份 + 无免责声明与备忘录抬头 + 原生表格 + 从当前 Markdown 重读 + 不覆盖 + manifest 记录 + 缺包）、`docx-tables.test.ts`（表格/正文顺序、无分隔行不误判、短横线拒绝、空正文）、`render-docx.test.ts`（`formalDocument` 版式与 `skipDisclaimer`）、`lawmind-server-route-admission.test.ts`（导出 / 409 / 覆盖 / 404）、`MatterAdmissionCard.test.tsx`（导出按钮与结果行）。
- **收案卡拆分**：委托包区块拆到 `MatterEngagementPanel.tsx`（自带加载、覆盖确认与导出状态），操作时间线拆到 `MatterAdmissionTimeline.tsx`，错误文案统一在 `matter-admission-error.ts`；`MatterAdmissionCard.tsx` 从 1071 行降到 799 行，已从 `scripts/pre-commit/file-size-baseline.json` 删除豁免。决定接受/婉拒后卡片仍显示委托包份数，由一次只读 manifest 请求补上。
- **尚未接**：律所自有模板变量、电子签服务对接；Markdown 仍是委托包的真相源。

### P1.4 字段出处（2026-10-27 续）

自动填入的案件字段现在必须能回指来件和原文片段，卷宗已有不同值时不再静默覆盖。

- **存储**：`src/lawmind/intake/field-provenance.ts`，记录在 `lawmind/intake/provenance/<matterId>.json`（agent 工作区黑名单内）。每条包含 `field / value / itemId / quote / confidence / capturedAt / source / status`，`status` 为 `applied / same / conflict`。
- **写入规则**：空字段写入并记 `applied`；同值只记 `same`，不重复写；不同值不覆盖，记 `conflict` 并开一条 `need_client_input`（标题如「核对案号」「核对对方当事人」，detail 带来件值、卷宗值、来源条目和原文）。`caseNo` 等 docket 字段写入时保留其它 docket 字段。
- **确定性抽取**：`extractIntakeMatterFields()` 只抽能一眼核对的东西——案号（正则，confidence 0.9）和带「被告 / 被申请人 / 对方」标签的当事人（confidence 0.5）；`quote` 取原文所在行。置信度是抽取规则的把握程度，不是模型概率。法院、案由、日期还没有确定性抽取器，留给后续 NER/文书解析。
- **接入收案**：`POST /api/intake/items/:id/lead` 的 `accept` 在收案成功后调用 `applyIntakeFieldsFromItem()`，把案号和对方写进卷宗并记出处；响应多一个 `provenance` 字段。收案邮箱自动归案、投递口/企微自动归案与 `POST /api/intake/items/attach` 手工归案也走同一出处规则：只补空字段，已有不同值只记冲突并开待办。法院和「案由：」会一并写入，并在在办留核对卡。带明确日期的期限写入提醒，同样留核对卡。抽取失败不回滚收案/归档，律师仍可在档案里手填。
- **API**：`GET /api/intake/admissions/:matterId/provenance` 返回 entries 与 coverage；`POST` 带 `itemId`（自动抽取）或 `itemId + fields`（显式写入）。
- **桌面**：收案卡新增只读「字段出处」区块：显示已填入字段的值、来源条目和原文；冲突字段标为「待核实（未覆盖卷宗）」；没有出处的律师手填字段标为「无出处（律师手填）」。
- **期限链**：`GET /api/intake/items/:id/legal-events` 用现有 `extractLegalEvents()` 从来源来信抽取开庭、答辩、举证、上诉、保全等日期；`POST /api/intake/admissions/:matterId/legal-events` 走 `applyLegalEvents()`：开庭先写，其他期限挂到开庭之后，来源标 `document_extract`，带默认提醒小时数，并同步更新 `docket.hearingAt`。收案卡新增「期限」区块：抽取 → 勾选 → 写入，显示已写入的期限。
- **日期正则修正**：`legal-event-extract.ts` 的中文日期原来只在「09:30分」时保留分钟，「09:30」会退化成 09:00；现在分钟可省略「分」字，传票上的开庭时间不再被抹平。
- **回归**：`src/lawmind/intake/field-provenance.test.ts`（抽取 / 空字段写入 / 同值 / 冲突不覆盖 + 待办 / docket 合并 / 无出处报告 / 记录不被 agent 读到 / 无可抽取字段）、`legal-event-extract.test.ts`（09:30 保留分钟）、`lawmind-server-route-mail.test.ts`（lead accept 后自动写入案号与对方）、`lawmind-server-route-admission.test.ts`（provenance GET/POST、传票抽取与期限写入）、`MatterAdmissionCard.test.tsx`（字段出处区块、期限抽取与写入）。
- **尚未接**：法院名称、案由的确定性抽取；判决书上诉期/送达日的计算链（目前只写入传票或送达文书里明确写出的日期）。

**验证（2026-10-27 晨）**：`tsc --noEmit`（引擎、桌面服务端、桌面渲染层）通过；`lawmind:check:renderer-css-sync` 通过；引擎 `intake / desk / agent / runtime / platform / policy` 共 299 个测试文件、3143 条测试通过；桌面服务端 + matter 渲染层共 88 个测试文件、613 条测试通过；Oxlint 对本次改动文件零告警。

### P1.5 收案卡接进案件页（2026-10-28 续）

P1.3 把「扫描冲突 → 确认告知 → 接受/婉拒」的卡片和单测都做了，但 `MatterAdmissionCard` **从未被任何页面挂载**：单测直接渲染组件所以一直是绿的，律师在实际应用里看不到「收案」，P1.3 承诺的「接受后刷新案件页」也没有接线。这轮补上挂载与刷新：

- **挂载位置**：`MatterOverviewBody` 的「更多洞察」折叠区**之外**，在「邀请同事」之后、「档案」折叠区之前。收案是「要不要接这一案」的闸门，不能要求律师先点开「更多」才看到。
- **刷新链路**：接受或婉拒后，`MatterWorkbenchImpl` 通过 `loadDetail(matterId)` 重读整页，状态行、队列、profile 与收案卡一起更新；不只手改本地 state。
- **避免无谓请求**：只有拿到 `profile`（才有 `status`）时才挂载；非 `intake` 且没有收案记录的案件，卡片自身返回 `null`，不占概览版面。
- **审计时间线**：收案记录的 `timeline`（建立、指定负责人、补登候选、扫描、告知、接受、婉拒）折叠显示在卡片底部，倒序、最新在前，逐条给时间、动作、系统/律师与 detail；接受或婉拒后仍保留，不因卡片切成摘要而消失。服务端 GET 本来就返回完整记录，这轮只补展示。
- **回归**：`MatterOverviewBody.test.tsx` 新增一条：`intake` + profile 时「收案」卡出现、含「开始收案」，且排在「更多」折叠按钮之前；`MatterAdmissionCard.test.tsx` 新增时间线倒序与决定后保留两条；matter 渲染层 11 文件 32 条通过；桌面 `tsc --noEmit`、`oxlint`、`check:renderer-css(-sync)` 通过。

**仍未接**：① 时间线是只读记录，不能按时间回放到某一步（没有逐步撤销）；② 委托包的电子签对接与律所自有模板变量仍按 P1.3 的遗留（DOCX 导出已补）。

### P2.1 录音收件通道与转写（2026-10-27 续）

P2 第一块落地：本机录音进统一收件层；转写按配置出站，且由律师点按触发。

- **入库即录音**：投递口里的音频文件（`.mp3 / .m4a / .wav / .aac / .amr / .flac / .opus / .wma / .webm / .ogg`）按 `channel: "recording"` 记成 `IntakeItem`（`dropzone.ts` 分类，`isIntakeAudioFile` 判别）；externalKey 仍是内容哈希，重复投递只记一次。邮件附件的音频仍按原规则跳过——有意进来的录音走投递口，不收敛到隐蔽路径。
- **转写是律师主动外发**：`src/lawmind/intake/recording.ts` 的 `transcribeIntakeRecording()` 只在待归案详情点「转写录音」（`POST /api/intake/items/:id/transcribe`）时执行；没有 `LAWMIND_ASR_ENDPOINT` 时不配置不操作客户语音。请求经 outbound-proxy（multipart，Bearer 可选，`LAWMIND_ASR_MODEL` 可选），超时 120s，单文件 50MB 上限。「配置端点并点按」= 律师同意把这段音频送出去；`egressMode: "offline"` 时非本机端点直接拒绝（`offline`），本机 127.0.0.1/localhost 端点放行。
- **结果落盘**：转写全文进内容寻址 blob 并写 `bodySha256`，`item.text` 存截断预览；音频原件仍是附件（sha256 不变），随时可回听。事件流新增 `transcribed`（by lawyer，detail 带 via 域名与字符数）。端点失败、返回空文字、超过上限、重复点按都不会静默改写条目——原因原样返回（`no_config / offline / too_large / endpoint_failed / empty_transcript / has_text / not_eligible`），UI 给出对应中文提示。
- **防泄漏口径**：转写函数不 import `agent/tools`、`mail`；事件不带任何转写正文；测试用注入 `fetchImpl` 的本地 cassette（不用 `vi.stubGlobal("fetch")`，守 `check-no-global-fetch-stub` 规则）。
- **尚未接**：企业微信**实时**会话存档需要企业资质、存档密钥与腾讯官方 SDK（C++/原生），没有企业配置时不做实时拉取；官方导出文件的适配见 P2.2。批量转写按钮（`转写全部录音`）暂未上 UI——单独点按已够用，批量化之前先定「一次点按=同意这批材料外发」的产品口径。

**验证（P2.1 本机）**：`pnpm exec tsc --noEmit -p tsconfig.json && tsconfig.desktop-node.json && desktop typecheck` 通过；`oxlint` 全部改动文件零告警；引擎 `intake` 10 文件 54 测试通过（含录音 8 条：投递口分类 / no_config / 出站转写 / offline 拦截 / 空文字 / 失败原样 / 重复点按拦截）；桌面全量 vitest 335 文件 1692 条通过（新增 `lawmind-server-route-transcribe.test.ts` 路由状态码与透传、`LawmindIntakeInbox.transcribe.test.tsx` 转写按钮与理由提示）。`check-no-global-fetch-stub` 口径遵守：引擎测试用 `fetchImpl` 注入，不 stub 全局 fetch。

### P2.2 企业微信存档导出适配（2026-10-27 续）

实时存档拿不到企业资质时，先把官方导出的**已解密**消息文件接进统一收件层。

- **入口**：`src/lawmind/intake/wecom-archive.ts`，扫描 `<workspace>/收件投递/企业微信/` 下的 `.json` / `.jsonl`。支持三种形态：消息数组、`{ users, messages }`、单条消息对象；`users` 映射把 userid 换成姓名。
- **一条消息一个 IntakeItem**：`channel: "wecom"`、`externalKey: wecom:<msgid>`（无 msgid 时用消息 JSON 的 sha256）、`roomid` → `thread.conversationId: room:<id>`、1:1 会话用参与者排序后的稳定 id、`msgtime` 兼容毫秒/秒/ISO。
- **非文本不假装有原件**：图片/语音/视频/文件只登记附件元数据并标 `skippedReason: "type_not_persisted"`；文本用 `[图片] / [语音 12″] / [文件] xxx.pdf` 占位。撤回消息保留为 `[消息已撤回]`，不让审计断链。
- **目录收口**：处理完移到 `收件投递/已入库/<day>/企业微信/`；解析失败或单文件超过 50MB 移到 `已入库/失败/<day>/企业微信/` 并上报 `errors`，不会每个 tick 重试同一个坏文件。`dropzone.ts` 的普通投递扫描跳过 `企业微信/`，避免把导出 JSON 当成一个普通附件重复入库。
- **判案**：每条消息入库后走同一个 `triageIntakeItem`，`roomid` 只作为会话线程线索；不会因为“同一个群”自动归案。
- **边界**：不做实时拉取、不逆向个人微信、不破解企微加密包；实时同步仍是需要 native bridge 的独立工作，解锁后也只产生 `IntakeItem`。
- **回归**：`src/lawmind/intake/wecom-archive.test.ts`（对象/JSONL/单条解析、userid→姓名、群与 1:1 会话 id、文件/语音/撤回、msgid 去重、坏文件移失败目录、普通投递不吞导出 JSON、事件流只有 recorded/resolved）。

**验证（P2.2 本机）**：`tsc --noEmit`（引擎、桌面服务端）通过；`oxlint` 改动文件零告警；`intake` 11 个测试文件、63 条测试通过（新增 WeCom 9 条）；桌面全量 vitest 335 文件 1692 条通过。

### P2.3 产品边界：加载项退出新增范围（2026-10-27）

产品目标改为「所有工作在 LawMind 内完成」，因此：

- Word/WPS 加载项、任务窗格、侧载清单、端口登记**不再新增能力**；既有代码（`src/lawmind/integrations/word-addin/`、`apps/lawmind-desktop/resources/word-addin/`）保留维护态，不删、不扩展、不新增验收。
- `open-with-wps` / 「用本机应用打开」降级为异常格式的逃生口，不作为工作流步骤或验收项。
- 文件审阅、比对、PDF 标注、表格审阅、签批的主工作面是 `apps/lawmind-desktop/src/renderer/file/` 与工作台；导出 docx/pdf/zip 是交付格式，不是编辑回路。
- 目标地图与路线已同步到 `docs/LAWMIND-REA-TARGET-MAP.md` 的 §0.1、§6 和 `docs/LAWMIND-OSS-WORKFLOW-REA.md` 的 §0.2。

### P2.4 渠道身份最小扩展（2026-10-27）

`MatterPartyContact` 原来只有 `kind/value/verified`：同一个邮箱挂在不同收案账户下会被当成同一条身份，企微 external userid 和录音/存档同意也无处安放。这轮只补字段和判定，不动界面。

- **身份键**：`contactIdentityKey()` = `kind + account +（externalId 优先于展示值）`。同一个值挂在不同账户下是两条身份；同一账户下的同一 externalId 才合并。
- **新字段**：`account`、`externalId`、`recordingConsent`、`archiveConsent`；同意状态为 `granted / denied / unknown`，带 `at`、`source`，缺省按 `unknown`——不把「没记录」当同意。同一条身份重复登记时，拒绝优先于同意。
- **判案**：`buildIntakeMatterIndex` 把 `account / externalId` 带进索引；`resolveIntakeItem` 只在「联系人和来件两侧都有账户且不同」时排除该联系人。历史无账户的数据、投递进来的 `.eml`（没有账户）照旧匹配。
- **删除**：`removePartyContact` / `removeMatterPartyContact` 增加可选 `account`；归档时记住发件人、撤回归档时忘掉发件人都带上收件账户，避免把同值另一个账户的联系人一起删掉。
- **冲突提示**：`duplicateContactIdentities()` 报出同一身份在**案内**登记在多个当事人名下，供编辑器提示，不静默合并当事人。
- **持久化**：`MatterPartyContactSchema` 接受新字段，写侧统一经 `normalizeMatterPartyContacts` 清洗。

**验收（P2.4 本机）**：同一 externalId 同账户去重、跨账户保留两条；同值跨账户判案不误合并；拒绝同意不被后续同意覆盖；删除按账户收窄；schema 往返保留身份与同意。测试：`desk/matter-parties.test.ts`、`intake/resolve.test.ts`、`intake/store.test.ts`（集成：索引携带账户 + 跨账户判案）、`matter-storage/schema.test.ts`；`desk` + `intake` + `matter-storage` + 写侧共 39 文件 212 测试通过；`tsc --noEmit` 与 `oxlint` 改动文件通过。边界：全部在 LawMind 内完成，不涉及加载项或外部编辑器。

### P2.5 录音转写审阅（2026-10-27）

P2.1 只做到「律师点转写 → 文字回填」；录音仍只能看一整段文字，不能回听，也不能按说话人读。这轮补审阅所需的三个最小面，仍不新建第二套真相源：

- **分段**：`asrSegmentsFromResponse()` 读常见 ASR 响应的 `segments`（OpenAI 风格 `start/end` 秒）或 `startMs/endMs`，统一成毫秒；`speaker / spk / channel` 归一成说话人键；端点只给整段文字时返回空数组，不编时间轴。转写成功后写 `IntakeItem.transcript.segments`。
- **说话人映射**：`setIntakeTranscriptSpeakerLabel()` 保存「说话人键 → 律师可读名字」到 `speakerLabels`；空名字清掉映射；分段里不存在的键拒绝写入。名字可写当事人姓名，为后续归案映射留位。
- **回听**：`GET /api/intake/items/:id/audio` 从内容哈希 blob 读音频，按扩展名给 `content-type`，支持 `Range`（206/416）与 `HEAD`。渲染层用带鉴权的 `fetch` 取回 blob 再交给 `<audio>`——媒体元素不能自带 `Authorization`，直接写接口地址会 401。
- **界面**：`LawmindIntakeDetail` 在录音条目上渲染播放器、分段列表和说话人输入框（失焦/回车保存）；`LawmindIntakeInbox` 负责取音频 blob URL 与保存回调。样式只用现有 token（`.lm-intake-audio` / `.lm-intake-segments` / `.lm-intake-speaker-field`）。
- **预览上限**：`intakePreview` 只回前 500 段，完整转写仍在条目里，避免列表/详情接口被超长分段撑爆。

**边界**：播放与转写都在 LawMind 内；音频原件不出工作区，只有律师点「转写」才出站（沿用 P2.1 的 egress 规则）。

**验收（P2.5 本机）**：分段解析（秒/毫秒/嵌套 `data`、空行丢弃）、转写后分段落盘、说话人映射保存与清空、未知说话人 400、无转写 409、无音频 404、完整音频 200、`Range` 206。测试：`intake/recording.test.ts`、`server/lawmind-server-route-mail.test.ts`、`renderer/LawmindIntakeDetail.test.tsx`；`intake` 12 文件 73 测试与收件箱 4 文件 19 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node` 通过。

### P2.6 说话人映射到当事人（2026-10-27）

P2.5 只能给说话人写自由名字；名字和当事人档案没有关系，同名或换案时会误导。这轮把映射做实：

- **存储**：`IntakeTranscript.speakerParties` 以「说话人键 → `{ matterId, partyId }`」保存。案件上下文一起存，换到另一个案时不会拿同名的 `p-client` 误认。
- **校验**：`setIntakeTranscriptSpeakerParty()` 写之前用 `loadMatter` + `hydrateMatterParties` 核对当事人确实在该案；不存在返回 `unknown_party`，不靠名字猜。传 `null` 清映射。
- **接口**：`GET /api/intake/matter-parties?matterId=` 返回该案当事人（`partyId / name / role / standing`）；`POST /api/intake/items/:id/speaker-parties` 保存或清除映射。案件 id 先过 `isValidMatterId`，路径穿越返回 404。
- **界面**：详情页选中案件后拉当事人；有当事人时说话人显示下拉（「不映射当事人」+ 当事人名），没有时回退到自由文本名字。分段里的说话人优先显示当事人名，其次名字，最后原始键。
- **互不覆盖**：保存名字与保存当事人映射都保留对方字段，清掉一种不影响另一种。

**验收（P2.6 本机）**：映射写入/清除、未知当事人拒绝、案件不存在拒绝、名字与映射共存、接口 200/400/404、下拉选中后分段显示当事人名。测试：`intake/recording.test.ts`、`server/lawmind-server-route-mail.test.ts`、`renderer/LawmindIntakeDetail.test.tsx`（3 文件 26 测试）；`intake` 全量 12 文件 74 测试；收件箱 2 文件 6 测试；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.7 重新转写口径（2026-10-27）

按钮一直写「重新转写」，引擎却在条目已有文字时直接返回 `has_text`，等于按钮不可用。这轮把口径补齐：

- `transcribeIntakeRecording(..., { force })`：不传 `force` 仍然拒绝，保留 P2.1「重复点按不重复出站」的防线；传了才覆盖。
- 路由认 `?force=1`（或 `?force=true`）；收件箱在条目已有文字时自动带上，按钮文案与行为一致。
- 失败仍不动条目；成功覆盖 `text` / `bodySha256`，分段重新落盘；说话人名字与当事人映射按说话人键保留，端点不再给分段时清掉旧 `transcript`，避免留过期分段。
- 出站规则没变：ASR 配置与 `offline` 检查仍在请求之前，拒绝原因照旧。

**验收（P2.7 本机）**：无 `force` 时返回 `has_text`，有 `force` 时真正重转并覆盖；录音、路由、收件箱三处都有覆盖。测试：`intake/recording.test.ts`、`server/lawmind-server-route-transcribe.test.ts`、`renderer/LawmindIntakeInbox.transcribe.test.tsx`；`intake` 与收件相关共 18 文件 103 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.8 判案评测（2026-10-27）

判案规则改一次就可能多一条误归案，但没有可回放的分数。这轮补最小评测层，不改规则：

- `evaluateIntakeMatching(index, cases)` 跑真实 `resolveIntakeItem`，按律师标注的期望案件输出：自动归案数、`falseAttach`（归错或本不该归）、自动归案正确率、`recall@1`、`proposalRecall`，并保留逐条明细与 false attach 名单。
- 硬线是 `falseAttach = 0`；正确率不把错误平均掉，错一条就单独列出来。
- 没有标注数据时指标返回 `null`，不伪造 0 分或满分。
- 目前只有合成集（线程回复、已核验联系人、DMARC 失败、案号、无线索），真实回件与律师改判数据到位后直接喂同一函数。

**验收（P2.8 本机）**：合成集 `falseAttach = 0`、`recall@1 = 1`、`proposalRecall = 1`；故意把期望案件改错时能报出 `falseAttach = 1` 与对应条目；空集返回 null 指标。测试：`intake/matching-eval.test.ts`（3 条）。

### P2.9 草稿卡片的默认出口改回应用内（2026-10-27）

草稿状态条此前只有「用 WPS 打开」，等于每份交付件的默认下一步都是离场，和 §0.1 的边界相反。这轮把默认动作换成应用内：

- **路径解析**：绝对路径先按 `resolveRelForAbs(workspaceDir, projectDir, outputPath)` 判定落在工作区还是项目夹；解析不了再退回工作区相对路径，仍解析不了才隐藏应用内按钮。
- **主按钮「在中栏打开」**：走 `requestOpenWorkspaceFile(rel, root)`，和对话里的文件芯片同一条通道；「用 WPS 打开」降为 ghost 次按钮，只在格式打不开时用。
- **上下文**：消息行把 `projectDir` 传给状态条，交付件落在项目夹时也能正确定位。
- **测试**：工作区路径点击后派发 `lawmind:open-workspace-file`（rel/root 正确），WPS 逃生口仍在；原有「不提供签批台」断言不变。

**验收（P2.9 本机）**：`LawmindChatDraftStatusBar.test.tsx` 2 条通过；桌面与引擎 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.10 分段回跳播放（2026-10-27）

转写分段此前只是列表，听到可疑处还要自己拖进度条。现在点分段时间戳就跳过去：

- 详情页给 `<audio>` 一个 ref；分段的时间戳改成按钮，点击把 `currentTime` 设到 `startMs / 1000` 并播放。
- 没有音频或分段没有时间戳时按钮禁用，不假装能跳。
- 时间戳仍显示 `mm:ss`，样式只加 `.lm-intake-seek`，沿用现有颜色 token。

**验收（P2.10 本机）**：点击第二段触发媒体播放；无音频时按钮禁用。测试：`renderer/LawmindIntakeDetail.test.tsx`（10 条）；桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.11 律师归案记录直接当评测标签（2026-10-27）

P2.8 的评测只能喂手工合成集，真实改判数据其实就在工作区里。这轮把律师亲手归案变成标签：

- `collectLawyerMatchingCases(workspaceDir)`：只收 `status=attached && filing.by="lawyer"` 的来件，`expectedMatterId = filing.matterId`。系统自动归案跳过——拿自己的结论考自己；忽略与待处理跳过——没归案不等于不属于任何案件；案件已结案跳过——索引里没有它，算进去只会制造假阴性。
- 返回 `source`：标注数、四类跳过数、扫描上限与 `scanMayBeTruncated`（`listIntakeItems` 单次最多 500 条，达到上限时分数只代表最近这批来件）。
- `evaluateWorkspaceMatching(workspaceDir)`：直接对真实标签跑 P2.8 的 `evaluateIntakeMatching`，返回同结构报告加 `source`；没有标签时指标为 `null`。
- 只读评测：不改归案规则，也不写案件数据。

**验收（P2.11 本机）**：律师归案进入标签；系统归案、待处理、已结案分别计数并跳过；有标签时 `falseAttach = 0`、`recall@1 = 1`；无标签返回 null 指标。测试：`intake/matching-labels.test.ts`（2 条）；`intake` 全量 14 文件 80 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.12 判案评测接进 doctor（2026-10-27）

P2.11 的评测只有函数，没有出口。现在 `pnpm lawmind:doctor` 直接跑：

- `evaluateWorkspaceMatching` 的结果放进 `--json` 的 `matchingEval`（含逐条明细与 `source`）；人读输出加一行「律师归案 N 条 · 误归 X · 第一名命中 Y% · 候选召回 Z%」，被 500 条上限截断时标注「只看最近 500 条」。
- 没有律师归案标签时只说明原因，不显示 `0/0` 的假成绩。
- 只读：跑 doctor 不改工作区，也不改归案规则。

**验收（P2.12 本机）**：空工作区跑 doctor 输出「判案评测：还没有律师归案的标注（系统自动归案不算标签）」且退出码不变；`--json` 带 `matchingEval`。验证：`LAWMIND_WORKSPACE_DIR=<tmp> node --import tsx scripts/lawmind/lawmind-doctor.ts`；引擎 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.13 待归案里的判案评测提示（2026-10-27）

评测有 doctor 出口，但律师不会主动跑 CLI。这轮把同一行放到真正发生归案的地方，并加数据门槛：

- `GET /api/intake/matching-eval` 按需返回 P2.11 的报告；不塞进 `/api/health`，避免每次健康轮询都扫描 500 条来件。
- 收件箱拉取一次，归案/忽略后刷新；展示逻辑抽成 `matchingEvalLine()`，只在 `source.labeled > 0` 时返回一句话：「判案评测：最近 N 条律师归案，误归 X，第一名命中 Y%。」。没有标注就完全不渲染，不出现 `0/0` 的假成绩；扫描被 500 条上限截断时注明「只看最近 500 条」。
- 只读：不改归案规则，也不写案件数据。本机工作区当前 `labeled = 0`（用 doctor 实测），所以界面上不会出现这句话，直到真的有律师归案记录。

**验收（P2.13 本机）**：有律师标注时显示该句；无标注时 `matchingEvalLine` 返回 null、组件不渲染；路由返回 `labeled / falseAttach / recallAt1`。测试：`renderer/lawmind-intake-eval-copy.test.ts`、`renderer/LawmindIntakeInbox.test.tsx`、`server/lawmind-server-route-mail.test.ts`（3 文件 14 条）；桌面与引擎 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.14 归档时把录音转写落进案件材料（2026-10-27）

先看现状：`filing.ts` 的 `materializeFiles` 只物化附件；录音的文字在 `IntakeItem.text` 里，归档后待归案列表不再显示该条目，案件材料里只剩音频——转写在律师侧等于消失。这轮补上：

- 归档 `channel="recording"` 且有条目文字时，额外写一份 `<录音名> 转写.txt`：头部有来源、收到时间、「自动转写未校对」说明；有分段时逐段 `[mm:ss] 说话人：文字`（名字用条目里的 `speakerLabels`，没有就原始说话人键），没有分段时写全文。
- 文件路径进 `filing.materialized`，撤回归档时一起清理；只有内容与条目里的转写完全一致才删——律师改过的转写稿保留。
- 文件名走同一套 `safeFileName` / `placeMaterial`，同名不同内容自动加序号。
- 故意不查案件当事人名字：撤回时要用同一份内容判断「有没有改过」，依赖案卷名字会漂。

**验收（P2.14 本机）**：归档后 `cases/<matter>/materials/通话录音 转写.txt` 存在且含时间戳与说话人；撤回删除未改动稿；律师改过的稿撤回后保留。测试：`intake/store.test.ts`（12 条）；`intake` 全量 14 文件 82 测试通过；引擎 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.15 分段文字可改正（2026-10-27）

证据：ASR 的人名、同音字错误是常态；此前只能回听，不能改字，P2.14 的归档稿还会把错字带进案件材料。这轮补最小改正闭环：

- `setIntakeTranscriptSegmentText()`：按分段下标替换文字，空文字拒绝；`text` 变成分段按行拼接，全文 blob 重写、`bodySha256` 指向新内容；`transcript.editedAt` 记时间，说话人名字与当事人映射保留。
- `POST /api/intake/items/:id/transcript-segments`（`{ index, text }`）：404 / 409 / 400 分别对应条目不存在、没有分段、下标越界或空文字。
- 详情页每段有「改」按钮，切换成 textarea + 保存/取消；保存后关闭编辑态并刷新详情，接口失败由收件箱提示、条目保持原样。
- 归档稿头在 `editedAt` 存在时加「校对：律师已修改分段文字。」；撤回仍用同一份内容判断是否改过，律师改过的稿不会被删。

**验收（P2.15 本机）**：改第二段后 `text` 同步、`editedAt` 写入、说话人名字保留；越界、空文字、缺少分段分别拒绝；路由成功 200、越界 400；详情保存回调带 index 与 text；归档稿带校对标记。测试：`intake/recording.test.ts`、`intake/store.test.ts`、`server/lawmind-server-route-mail.test.ts`、`renderer/LawmindIntakeDetail.test.tsx`（4 文件 44 条）；`intake` 全量 14 文件 84 测试；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node` 通过。

### P2.16 改正标记可见（2026-10-27）

P2.15 只能改字，界面和归档稿里看不出哪一段被改过，复核时容易把人工更正当成 ASR 原文。这轮补可见标记：

- `IntakeTranscriptSegment` 新增 `editedAt`；`setIntakeTranscriptSegmentText()` 只给被改的那一段写时间，其余段落保持原样；条目级 `transcript.editedAt` 仍记最近一次。
- 详情页在改过的分段旁显示「已改正」小标记，样式沿用 `surface-2`。
- 归档稿逐段输出 `[mm:ss] 说话人：文字 〔律师改正〕`；头部仍保留整体「律师已修改分段文字」。
- 撤回判断不变：同一份内容才删，改过的稿保留；标记随条目数据重算，不依赖外部状态。

**验收（P2.16 本机）**：改第二段后只有第二段带 `editedAt`；归档稿对应行带「〔律师改正〕」；详情显示「已改正」。测试：`intake/recording.test.ts`、`intake/store.test.ts`、`renderer/LawmindIntakeDetail.test.tsx`（3 文件 37 条）；`intake` 全量 14 文件 84 测试；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.17 归档转写稿使用当事人名字（2026-10-27）

证据：P2.6 的「说话人 → 当事人」映射只在详情页生效；`renderTranscriptText()` 只读 `speakerLabels`，归档稿仍写 `S1/S2`，律师打开案卷看到的说话人和界面对不上。

- `renderTranscriptText(item, { matterId, partyNames })`：说话人名字优先取本案映射的当事人，其次 `speakerLabels`，最后原键；只有 `speakerParties[key].matterId` 等于本案才采用，避免同名 `p-client` 跨案误认。
- 归档时从 `loadMatter` + `hydrateMatterParties` 建当事人名字表；撤回时用同一张表现算转写文本，内容一致才删。
- 已知边界：归档后如果改了当事人名字，撤回时重算内容会不一致，转写稿会保留——宁可留一份文件，也不误删。这条不假装能自动跟随。

**验收（P2.17 本机）**：`S1` 映射到「甲公司」后归档稿写「甲公司：…」且不出现「S1：」；未改名的撤回仍删除转写稿。测试：`intake/store.test.ts`；`intake` 全量 14 文件 85 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

### P2.18 重复联系方式进入档案一致性（2026-10-27 续）

P2.4 加了 `duplicateContactIdentities()`，但只有它自己的单测在调用：律师在工作区设置里看不到，doctor 也不报。这轮把它接进既有的档案一致性检查，并把「能自动修」和「必须人工改」分开。

- **进一致性检查**：`checkMatterConsistency()` 对每个有 matter.json 的案件跑一次当事人身份比对，命中就报 `duplicate_party_contact`，消息里带当事人名字（`甲公司 / 乙公司`）。身份键仍按 P2.4 的 `kind + account +（externalId 优先）`：同一邮箱挂在不同收案账户下不报，同一企微 externalId 同账户才报。
- **不假装能修**：`repairMatterProjections()` 只重写 CASE.md 投影，改不了当事人数据。新增 `isRepairableMatterConsistencyIssue()`：`duplicate_party_contact` 与 `both_missing` 不算可修，其余投影漂移算可修。`formatMatterConsistencyReport()` 在有人工项时补一行「需律师自行处理（matter-repair-projection 不会改动）」。
- **健康摘要拆计数**：`/api/health` 的 `doctor.matterConsistency` 新增 `repairableCount` 与 `partyConflictCount`，`issueCount` 仍是全部。设置页「案件档案 → 重新整理」只按 `repairableCount` 出现，避免「点整理、计数不动」的假按钮。
- **设置页新增一行**：有联系方式冲突时显示「有 N 处同一邮箱、电话或企微登记在多个当事人名下」，列出前 5 条（案件 + 当事人），并写明整理档案投影不会改它；没有冲突时整块不渲染。
- **旧服务端兼容**：`repairableCount` 缺省时退回 `issueCount`，旧 payload 的按钮行为不变。

**验收（P2.18 本机）**：同一企微 externalId 同账户挂两个当事人 → 报 `duplicate_party_contact` 且带两人名字；同邮箱挂不同账户不报；报告尾部出现人工处理提示；健康摘要 `repairableCount=0 / partyConflictCount=1`，纯投影漂移则 `repairableCount=issueCount`；设置页只有冲突时不出现「重新整理」，显示冲突行。测试：`application/matter-consistency.test.ts`、`server/lawmind-health-payload.test.ts`、`renderer/LawmindSettingsWorkspaceCare.test.tsx`；`src/lawmind/application` + 健康路由 12 文件 78 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件通过。

**仍未接**：① `rememberSender` 归档时若该发件地址已挂在别的当事人名下，仍会再写一条，检查只能事后报——已由 P2.19 补上；② 当事人编辑器没有联系方式字段，律师看到冲突后只能去改 JSON 或等界面补齐——已由 P2.19 补上。

### P2.19 卷宗里直接改当事人联系方式（2026-10-28）

P2.18 让冲突可见，但律师看到后没有地方改：卷宗编辑器只编辑角色、名称和送达，联系方式只能来自归档或手改 JSON；就算界面想加，`/api/matters/profile` 的 zod 也会把 `contacts` 静默丢掉。

- **接口契约**：`matterProfilePostSchema` 的当事人增加 `contacts`，直接复用存储层的 `MatterPartyContactSchema`（每人上限 8 条）。此前写回请求会在解析时被条带化，现在原样进入 `updateMatterProfile`。
- **编辑器**：每个当事人一块「联系方式」：类型（邮箱 / 电话 / 企业微信）、值、所属账户、已核实、删除，可继续添加。新增行带 `source: "lawyer"` 与 `addedAt`；空值行保存时被正常化丢弃，不会落一条空记录。
- **冲突提示就在编辑处**：用 `duplicateContactIdentities()` 对正常化后的联系方式比对，同一身份挂在两个当事人名下时当场列出两个人的名字；同值不同账户不报，沿用 P2.4 的身份键口径。
- **不静默吞值**：格式不合法的非空行（邮箱缺域名、电话带字母等）提示「保存时会被忽略」——存储层确实会丢弃它们，不能等保存后才发现。
- **只读卡片也显示**：卷宗摘要里的当事人卡片补上联系方式与「已核实」，不打开编辑也能核对。
- **归档时不写第二条**：P2.18 的遗留项。勾选「记住发件人」时，先按同一身份键查本案其他当事人；已经被占用的地址不再写进委托人名下（`rememberedSender: false` 加 `rememberSkippedParties` 名单），收件箱归案后显示「已经登记在乙公司名下，没有重复登记」。不静默合并当事人，也不假装记住。

**验收（P2.19 本机）**：改值、勾选已核实会回传新状态；添加与删除行；同身份跨当事人报警、同值跨账户不报；非法值只提示不落库；`POST /api/matters/profile` 带 contacts 落盘可读回（此前会被 schema 丢掉）；发件地址已被别的当事人占用时不再重复登记，并给出占用人和提示。测试：`renderer/LawmindMatterPartiesEditor.test.tsx`（5 条）、`renderer/LawmindIntakeInbox.test.tsx`（+1 条）、`server/lawmind-server-route-matters.test.ts`（+1 条）、`platform/local-api-schemas.test.ts`（+1 条）、`intake/store.test.ts`（+1 条）；`intake` 与三个渲染测试共 17 文件 108 测试、`desk` + `platform` + 工作台共 65 文件 512 测试通过；引擎与桌面 `tsc --noEmit`、`oxlint`、`oxfmt`、`check:renderer-node`、`check:renderer-css` 通过。

**仍未接**：① 录音 / 会话存档同意（`recordingConsent` / `archiveConsent`）仍只从归档路径写入，编辑器不暴露——已由 P2.20 补上；② 企微 `externalId` 不在界面编辑，界面按展示值显示——已由 P2.20 补上。

### P2.20 附件原件预览与同意状态编辑（2026-10-28 续）

两件都是 P2.19 的尾巴，合在一轮收口：

- **附件原件可看**：`GET /api/intake/items/:id/attachments/:index` 只按条目里登记的下标取 blob，不接受路径。PDF、图片、纯文本内联预览（`inline`）；HTML / SVG 等可执行文档强制 `application/octet-stream` + `attachment`，并加 `x-content-type-options: nosniff`，不在应用里执行来件脚本。
- **鉴权取回**：渲染层仍用带鉴权的 `fetch` 取回 blob，再交给 `<img>` / `<iframe>`（媒体元素不能自带 Authorization）；切换来件或关闭时撤销 object URL，不把上一个附件留在内存里。
- **同意可编辑**：电话显示「录音同意」、企业微信显示「会话存档同意」，三态为未记录 / 已同意 / 已拒绝。选「未记录」清掉记录，其余记 `source: "lawyer"` 与时间；同意变化不动「已核实」——它只随身份（值 / 账户 / 类型 / externalId）变化失效。
- **企微 externalId**：企业微信联系方式可填 `externalId`（可留空）；改它会换身份键，来源归律师、旧核实失效。
- **只读卡片**：当事人卡片显示「录音：已同意」「存档：已拒绝」，不打开编辑也能核对。
- **预览边界**：文本超过 256 KB 只给下载，不整段塞进 DOM；被跳过的附件（类型不存档）和没有 `sha256` 的附件没有「查看」。

**验收（P2.20 本机）**：PDF 内联 200 且 `content-type: application/pdf`；SVG 以 octet-stream 下载且带 nosniff；越界下标 404；被跳过的附件无「查看」；文本预览与不可预览类型都不走 iframe/img；同意三态编辑与清空、externalId 编辑、只读卡片显示同意。测试：`server/lawmind-server-route-mail.test.ts`（8 条，+1）、`renderer/LawmindIntakeDetail.test.tsx`（13 条，+2）、`renderer/LawmindMatterPartiesEditor.test.tsx`（8 条，+3）；桌面 `tsc --noEmit`、`oxlint`、`check:renderer-node`、`check:renderer-css`、`check:renderer-css-sync` 通过。

**仍未接**：① 附件不能直接跳到「归案后的案件材料」位置（只能在预览里下载）；② 多候选案件的比较视图仍未做——已由 P2.21 补上；归案回执见 P2.22。

### P2.21 多候选案件对照表（2026-10-28 续）

来件同时命中多个案件时，原来的候选卡各列各的线索，律师要在卡片之间来回对照。这轮在候选卡下面补一张「线索 × 案件」表：

- **触发条件**：候选 ≥ 2 且至少有一条线索；单个候选不渲染表，避免重复占版面。
- **行**：所有候选出现过的线索类型，去重后强线索引出的行排在前面（往来线程 → 案号 → 案件编号 → 已核验邮箱），其余（登记邮箱、当事人姓名）按出现顺序。
- **单元格**：显示该候选这条线索的原文摘要；没有就是「—」，不留空——空格会被读成「也有」。
- **不改判定**：表只是把已有候选并排展示，不重算分数，不改变「必须由律师选择」的口径。

**验收（P2.21 本机）**：两候选各有案号、其中一案还有线程 → 表头是两个案件名，线程行在前、案号行在后，缺线索的格子是「—」；单候选不出现表。测试：`renderer/LawmindIntakeDetail.test.tsx`（15 条，+2）；桌面 `tsc --noEmit`、`oxlint`、`check:renderer-css`、`check:renderer-css-sync` 通过。

**仍未接**：① 表格不能直接点选案件（仍用上方候选卡或下拉）；② 多个候选的「为什么不算强线索」没有逐条解释。

### P2.22 归案回执：材料去哪了（2026-10-28 续）

归案成功后条目从「待归案」消失，律师看不到材料落在哪；`attach` 响应里的 `filing.materialized` 被界面直接丢弃。这轮把回执补上：

- **回执内容**：归案成功后显示「已归入「甲案」：N 个文件写入案件（合同.pdf、邮件.eml…）」；只列文件名，不展示工作区相对路径（那是工程师信息）。
- **打开案件**：工作台的待归案把 `onOpenMatter` 接到 `openMatter`，回执里出现「打开案件」，点一下切到该案卷宗。
- **生命周期**：回执是临时的——下一次归案、忽略或线索动作会清掉；不写进任何存储，也不改变归档结果。
- **不改归档**：仍由 `attachIntakeItem` 决定物化与去重；界面只读返回值。

**验收（P2.22 本机）**：归案响应带 `filing.matterId/materialized` 时回执出现、显示案件名与文件名；点「打开案件」回调收到正确 `matterId`；响应没有 `filing` 时不渲染回执。测试：`renderer/LawmindIntakeInbox.test.tsx`（6 条，+1）；工作台 2 文件 14 条通过；桌面 `tsc --noEmit`、`oxlint`、`ui-copy-lint`、`check:renderer-node` 通过。

**仍未接**：① 回执不能直接定位到具体材料行（只到案件）；② 忽略 / 进入收案后没有同类回执，仍靠列表刷新体现。

### A4 外发动作统一为「签批发送」（2026-10-28 续）

渲染层早已统一「签批 / 签批发送 / 签批并继续」，但引擎的工具描述、参数说明、执行结果和决策头提示仍写「批准发送」。模型会把这些词原样转述给律师，等于同一个动作在对话里又变回两个词。

- **工具文案**：`send_email`、`prepare_outbound_mail` 的描述、`packet_id` 参数说明、`needs_approval` 结果与阻断提示统一为「签批发送 / 签批前 / 签批后 / 重新签批」；`tool-name-sets.ts` 的影响面短句改为「写入待发信：签批发送前不会发出」。
- **交付包复核**：`packet-outbound.ts` 的律师可读问题清单改为「签批的交付包 ID 为空」「不能按原签批发送」「在签批后变了」等，判定逻辑与绑定字段不变。
- **模型提示**：`system-prompt.ts` 的安全硬红线同步改成「律师在待发列表点『签批发送』后才真正发出」，避免模型从提示词里学到旧词。
- **顺带修的一处回潮**：交付包面板写着「批准的是整个包」，把 `ui-copy-lint` 的 `syn.pizhun` 棘轮顶破（7 > 6）；改成「签批的是整个包」。
- **不动协议**：`approve_send` 动作名、`OutboundPacketBinding`、路由与审批队列字段全部保留——这是文案收敛，不是接口改名。
- **契约测试**：新增 `agent/tools/legal/mail-tools-copy.test.ts`，把两个工具的描述、参数说明、影响面短句和空包问题清单拼在一起，断言不再出现「批准发送 / 批准前 / 批准后 / 等待批准 / 重新批准 / 待批准」且包含「签批发送」。

**验收（A4 本机）**：`pnpm lawmind:ui-copy-lint` 通过（硬拦 0 处；棘轮 58 / 地板 59，`syn.pizhun` 回落）；定向测试 `agent/tools` + `delivery` + 绑定与管线共 71 文件 596 条通过；系统提示与五组 prompt 测试 55 条、orchestrator cassette 156 条通过；引擎 `tsc --noEmit`、`oxlint`、`oxfmt` 通过。

**仍未接**：① 若干历史测试注释仍写「批准发送」，不影响律师可见文案，未批量改写；② `ui-copy-lint` 建议把 `syn.daiban` 地板从 13 收紧到 12，本轮不动棘轮基线。

### P3.1 等待超时进入「待我拍板」（2026-10-27）

`MatterRun` 早就把超时的等待步骤标成 `escalatedAt`，但只有 `listEscalatedMatterRunWaits()` 一个读函数，没有任何界面消费——律师看不到，等于升级进了黑洞。这轮把「等待超时 → 律师决定」接成完整一条：

- **在办队列新增 `matter_run_wait` 行**：`build-agent-fleet.ts` 把已升级的等待步骤映射成在办行（`status: awaiting_approval`、`subtitle: 案件运行`、`priority: 2`），带上 `matterRunWait { runId, stepId, reason, stepTitle, dueAt, escalatedAt }`。来源标签直接显示等待原因（等客户补件 / 等对方回函 / 等法院文书 / 等律师决定 / 等外部事件），行状态标「等超时」。
- **不计入工具签批**：`isLawyerOutboundDecision()` 认这个 kind，所以侧栏「待我拍板」徽章与队列同源（`requiresDecisionTotal` 加上 `pendingMatterRunWaits`）；同时 `approvalAction` 对它一律为 `null`，不会回退到池里别的工具票或案件审批票。
- **两种处理**：`resolveEscalatedMatterRunWait()` 只接受**已升级**的等待步骤。`extend` 把 `dueAt` 推后（默认 3 天、上限 30 天）、清掉 `escalatedAt`，仍保持 `waiting`——事件提前到达照样唤醒；`skip` 走既有 `skipMatterRunStep()`，把这一步记为 `skipped` 并让 run 回到可继续状态。两种处理都写事件流（`wait_extended` / `step_skipped`）。
- **接口**：`POST /api/matter-runs/:matterId/:runId/steps/:stepId/wait`，body `{ action: "extend", days? }` 或 `{ action: "skip" }`。找不到 run/步骤 404，未到升级时间 409（`step_not_escalated`），body 非法 400，非 POST 405；matterId 走 `isValidMatterId`，runId/stepId 走安全字符集。
- **界面**：`LawmindMatterRunWaitDetail` 列出等待原因、原定到期与升级时间，并给「再等 3 天 / 不再等这一步」两个动作；底栏主按钮同文案、次按钮为「不再等」（跳过前要确认）。「稍后」只影响这次列表展示，不改 run。
- **为什么单独一个 `matter-run-wait.ts`**：原因文案与默认天数渲染进程也要用，而 `matter-run.ts` / `matter-run-store.ts` 带 node 内置模块；常量放纯模块，`import type` 擦除后不把 node 依赖拖进前端包。

**验收（P3.1 本机）**：续等后 `wait.dueAt = +3 天`、`escalatedAt` 清空、run 仍 `waiting`，事件流有 `wait_extended`；跳过后续等步骤 `skipped`、单步 run 直接 `done`，事件流有 `step_skipped`；未升级的等待返回 `step_not_escalated` 且不落盘改动；缺 run 返回 `run_not_found`；`days` 超过上限按 30 天收口；队列按案件过滤、`byKind.matter_run_wait` 计数正确。测试：`platform/matter-run-store.test.ts`、`platform/build-agent-fleet.test.ts`、`server/lawmind-server-route-matter-runs.test.ts`、`renderer/LawmindMatterRunWaitDetail.test.tsx`、`renderer/lawmind-fleet-docket.test.ts`；`platform` 与两条路由测试共 43 文件 404 测试通过；引擎、桌面 node、桌面三份 `tsc --noEmit`，`oxlint` 改动文件，`check:renderer-node`、`check:renderer-css` 通过。

**仍未接**：把「草稿 / 渲染 / 外发」拆成独立可恢复步骤——那决定后续步骤能否在跳过之后自动接上；当前 `skip` 只保证 run 回到可继续状态，推进仍由下一轮 tick 与自动办件执行器完成。

### P3.2 剧本三色分流（2026-10-27）

路线图第 8 项。借的是 Anthropic legal plugin 的**判定结构**，不是它的 NDA 条款清单：

- **三色判定**：`src/lawmind/deliverables/playbook-triage.ts` 的 `triageAgainstPlaybook()`。所有条件 `PASS` 才 `GREEN`；任一 `red` 条件 `FAIL` 即 `RED`；其余 `YELLOW`。没给结论的条件按「未核对」`FLAG`，不按通过算。
- **证据是硬线**：`PASS` 必须同时有 `quote` 与 `locator`（`L12` / `P2` / `S1!A1`），缺一个就降级为 `FLAG` 并标 `missing_quote` / `missing_locator`；`FAIL` 没有原文引用同样降级——一条没有出处的「不符合」不足以把整份文书打成 `RED`。
- **没剧本就诚实降级**：不传 playbook 时返回 `verdict=YELLOW`、`basis=default`、`items=[]`；`describePlaybookTriage()` 写明「通用标准（未加载本所剧本，不代表本所立场）」，不出现任何正确率。
- **律师 override 要留理由**：`RED` 只有带 `by` + 非空 `reason` 的 `PlaybookOverride` 才能降为 `YELLOW`；缺理由仍按 `RED`，并标 `overrideRejected`。
- **机械可核对的那一部分**：`observationsFromClauseDoc()` 只处理 `check.kind="clause_present"` 的条件——用现有条款抽取找条款类型，给**逐字原文**（按 `sourceRange` 从原文本切）加行号位置；找不到给 `FLAG` 而不是 `FAIL`，因为「没找到」可能是抽取失败。其余条件必须由人或模型给结论。
- **交付档位**：`resolveDeliveryTier()` 新增可选 `playbook { verdict, basis }`。`basis=playbook` 时 `RED → full_review`，`GREEN/YELLOW → 最多 one_tap_signoff`（`GREEN` 也不自动交付）；`basis=default` 不改档位，只影响依据展示。`evaluateAutoDeliver()` 透传该参数。
- **决策头**：`DecisionHeader.playbook` 带结论、`basis`、计数与非 PASS 项的标题/位置/理由；`RED` 会把风险行改成「剧本判定 RED，须全面审阅」，非 `GREEN` 一律进 `needs_decision`。`resolveDecisionHeader()` 只在本次现算 triage 时覆盖持久化依据，不传就保留旧依据。

**验收（P3.2 本机）**：全过且有引用 → `GREEN`；缺 quote 或 locator 的 `PASS` 降级；缺口条件的 `FAIL` 降级为 `YELLOW` 而非 `RED`；`red` 条件带引用 `FAIL` → `RED`；空理由 override 仍 `RED` 并标 `overrideRejected`，有理由才降 `YELLOW`；无剧本 `basis=default`；`clause_present` 命中给人可回指的引用位置、缺失给 `FLAG`；`RED` 不进 `auto_deliver`、`GREEN` 封顶一键签发、`basis=default` 不改档位；决策头只列非 PASS 项。测试：`deliverables/playbook-triage.test.ts`（11 条）、`delivery/resolve-delivery-tier.test.ts`、`delivery/decision-header.test.ts`；引擎与桌面 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node` 通过。

**仍未接**：①观测产出只有「必含条款是否存在」这一种，可接受区间/升级触发仍要人或模型；②引用只校验「有 quote + 有位置」，还没回读工作区核对 quote 是否真的在原文里（模型给的观测仍可能编造）——已由 P3.3 补上；③没有本所剧本的编者入口与界面——已由 P3.6 补上；④交付流程还没有调用方把 triage 传进 `resolveDeliveryTier` / `buildDecisionHeader`——已由 P3.5 补上。剩余只有①。

### P3.3 剧本落盘与引用回读核对（2026-10-27）

P3.2 留了两条尾巴：剧本没有存放位置；引用只证明「写了 quote 和位置」，没证明那句原文真的在文件里。这一轮把两件都补上：

- **落盘**：`src/lawmind/deliverables/playbook-store.ts`，一份剧本一个文件：`<workspace>/lawmind/playbooks/<id>.json`。`schemaVersion=1` + zod 校验；id 只允许安全字符（会变文件名，拒绝 `..`/分隔符），条件 id 不得重复，条件必须非空；原子写。坏档在读列表时跳过，不让一份坏 JSON 挡住其它剧本。没有文件就是「没加载本所剧本」，不内置任何条款。
- **回读核对**：`src/lawmind/deliverables/playbook-triage-verify.ts` 的 `verifyPlaybookObservations()`。`PASS` / `FAIL` 必须带 `filePath`；核对时把 `filePath#locator` 交给现有的 `checkEvidenceSupportAsync`，能按行/页/单元格定位核到具体位置，不只是整份文件。原句找到 → 保留结论；找不到 / 文件没了 / 版本变了 / 格式读不了 → 一律降级 `FLAG` 并写明理由。`FLAG` 本身不是通过，不回读也不改。同一「文件 + 位置 + 引文」只读一次。
- **律师面计数**：`PlaybookTriage.evidenceVerification` 记 `checked / verified / failed / unverifiable / uncheckedEvidence`（最后一项是「给了引用但没文件路径」）。`describePlaybookTriage()` 追加一句「引用核对：N 条已核、M 条对不上原文…」；仍然不出现任何正确率。
- **接口**：`GET /api/playbooks` 列出工作区剧本；`POST /api/playbooks/triage` 收 `{ playbookId, observations, override? }`，先回读再分流，返回 `triage` 与 `summaryZh`。剧本不存在 404（`playbook_not_found`），body 非法 400；观测上限 100 条。
- **为什么拆两个文件**：`playbook-triage.ts` 被渲染进程共享，回读依赖 `node:fs`，必须留在引擎；`playbook-store.ts` 同理，不放进 `deliverables/index.ts` barrel。

**验收（P3.3 本机）**：引文确在指定行 → 保留 `PASS`；位置写错或句子被改 → 降级 `FLAG` 且计数 `failed`；文件不存在 → `failed`；没有 `filePath` → `uncheckedEvidence`；同一引文重复只回读一次；已核的 `FAIL` 仍能出 `RED`；未知条件不参与回读但仍在 `unknownCriterionIds`；剧本往返保真、坏档跳过、`../escape` 拒绝；接口 200/400/404 与 `GREEN→YELLOW` 降级。测试：`deliverables/playbook-store.test.ts`（6 条）、`deliverables/playbook-triage-verify.test.ts`（11 条）、`server/lawmind-server-route-playbooks.test.ts`（5 条）；本轮相关 75 文件 685 测试通过；引擎、桌面、桌面 node 三份 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node` 通过。

**仍未接**：①观测产出仍只有「必含条款是否存在」这一种；②剧本没有编者界面（已由 P3.6 补上）；③交付流程还没有调用方把 triage 传进档位解析与决策头（已由 P3.5 补上）。

### P3.4 三色分流接进办案工具（2026-10-27）

P3.3 之后能力只能从 HTTP 或代码调用；律师在对话里说「按本所剧本给这份合同分级」时，模型没有任何工具可用，只能自由发挥 GREEN/YELLOW/RED。这轮把它接成工具：

- **工具**：`src/lawmind/agent/tools/legal/playbook-triage-tool.ts` 的 `triage_against_playbook`。模型只提交「每条条件的结论 + `quote` / `locator` / `file_path`」，引擎加载工作区剧本、回读核对引用后出分级；工具不接收 override。
- **诚实降级**：工作区没有剧本时返回 `basis=default`、`YELLOW`，并明确提示「通用标准，不是本所立场，不得据此宣称 GREEN」；有剧本但没给 `playbook_id` 且不止一份时直接报错列出可用 id，不猜。
- **RED 不给模型后门**：`RED` 时附一句「只能由律师在界面降档（须留理由）」，工具不接受 `override_by` / `override_reason`，避免模型自己把红改黄。
- **披露与治理**：加入 `DISCLOSED_TOOL_HINTS`（否则模型只能靠猜名字）、`IDEMPOTENT_READ_TOOLS`（只读、可与同批读工具并发）；工具总数断言从 75（59 legal + 16 engine）更新到 76（60 + 16）。
- **办案模板**：内置 NDA 初审步骤的任务描述改成「有本所剧本时先用 `triage_against_playbook`，每条结论带 quote / locator / file_path；没有剧本按通用标准写明 basis=default」，不再只让模型自由分级。
- **顺带修的真缺陷**：收件详情把 `useRef` 放在 `if (!item) return` 之后。条目从「读来件…」切到详情时 hook 数量变化，React 报「Rendered more hooks than during the previous render」；已把 ref 移到早退之前，属于真实交互会踩到的路径，不只是测试问题。

**验收（P3.4 本机）**：回读通过才 `GREEN`；引文被改 → `YELLOW` 且逐项理由；已核 `FAIL` → `RED` 并带「只能由律师降档」提示；无剧本 `basis=default` + 通用标准提示；多份剧本必须指定 id 且错误里列 id；未知 id / 参数非法返回 `ok:false`。测试：`agent/tools/legal/playbook-triage-tool.test.ts`（6 条）；`agent/tools` 全量 54 文件 427 测试、prompt-budget 与 cassette 162 测试、collaboration 9 文件 38 测试通过；引擎 `tsc --noEmit`、`oxlint` 改动文件通过。

### P3.5 合同草稿落盘即出剧本结论（2026-10-27）

P3.4 之前，三色分流只有「模型主动调工具」一条路；律师不主动问，交付物上就不会出现剧本结论。这轮把它接进起草落盘：

- **自动跑一次**：`src/lawmind/delivery/draft-playbook-triage.ts` 的 `triageDraftAgainstPlaybook()`。只在 `deliverableType` 以 `contract.` 开头、且工作区**恰好一份**剧本时启用；0 份是没依据、多份是没有选择规则——都不猜，宁可不写结论。
- **证据来自草稿本身**：`extractClauses(草稿正文)` → `observationsFromClauseDoc()`，引文按 `sourceRange` 从正文逐字切出，再走纯 `triageAgainstPlaybook()`。这不是模型给的引用，所以不需要回读核对。
- **进决策头**：`engine/shared.ts` 在构建 `DecisionHeader` 时带上 `playbook` 块（结论、`basis`、计数、非 PASS 项位置与理由）。
- **进交付档位**：`evaluateAutoDeliver()` 收到 `{ verdict, basis }`——`RED → full_review`，`GREEN/YELLOW → 最多一键签发`；`YELLOW` 同时让 `ready=needs_decision`，即使自主交付已解锁也不会自动放行。
- **界面**：`LawmindDecisionHeader` 增加一行「剧本：…（依据：本所剧本「X」，N 项通过 / M 项待定 / K 项不符合）；待处理：…」，只列前三条非 PASS 项；律师 override 与「降档未生效」都显示。

**验收（P3.5 本机）**：合同草稿 + 单份剧本 → 决策头带 `GREEN` 且落盘可读回；剧本含人工条件 → `YELLOW`、`needs_decision`、即使自主交付解锁也不自动批准（`reviewStatus=pending`、无 `system:auto_deliver`）；非合同交付物不写剧本块；0 份 / 多份剧本都不出结论；条款缺失时给 `FLAG` 而不是 `PASS`。测试：`engine/shared.test.ts`（7 条，含 3 条新）、`delivery/draft-playbook-triage.test.ts`（5 条）、`renderer/LawmindDecisionHeader.test.tsx`（3 条）；全量 `pnpm test` 1165 文件 8523 测试通过；引擎、桌面、桌面 node 三份 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node` 通过。

**仍未接**：①观测产出仍只有「必含条款是否存在」，可接受区间/升级触发要人或模型；②剧本没有编者界面（已由 P3.6 补上）；③多份剧本时没有选择规则（已由 P3.6 补上）；④非条款类交付物（意见书、诉状）没有对应剧本体系。

### P3.6 剧本编者界面与适用范围（2026-10-28）

P3.5 之后剧本只能靠命令行/手写 JSON 维护；工作区有两份剧本时草稿直接不出结论。这轮补上设置页与选择规则：

- **读写接口**：`GET /api/playbooks/:id` 读单份完整剧本；`POST /api/playbooks` 新建/覆盖（请求体与落盘共用 `PlaybookInputSchema`）；`DELETE /api/playbooks/:id` 删除。字段校验与文件层同一份，不再在路由里抄一遍规则。
- **设置页**：`LawmindSettingsPlaybooks`（挂在「设置 → 工作区」执业口径下方）。列表显示名称、编号、条件数、适用范围；可新建、编辑、删除（删除走品牌确认弹窗）。编辑区含编号（编辑时不可改）、名称、版本、适用范围、标准立场、可接受区间、升级触发与逐条条件；条件可选 green/red、可声明「机械核对：必含条款」并勾选条款类型。保存前在客户端先挡明显错误（编号非法、重名条件、缺标题、机械核对没选条款类型）。
- **适用范围**：`Playbook.deliverableTypes`（前缀，如 `contract.review`、`contract.`）。起草落盘时先按交付物类型过滤；过滤后恰好一份才跑分流，0 份或多份都不猜。没写范围的剧本视为覆盖所有合同类，因此「一份全局 + 一份专项」重叠时会如实不出结论，而不是随便挑一份。
- **样式**：只加 `.lm-playbook-*` 布局类（软底、`--border`、`--r`），输入仍走 `lm-input`；`styles.css` 聚合文件已按源模块同步。

**验收（P3.6 本机）**：设置页列出、编辑回填、保存请求体正确、非法草稿不发请求、删除需确认且调用 DELETE；接口创建/读取/删除与非法 id 400、缺失 404；范围过滤下 `contract.general` 与 `contract.review` 各选对应剧本、无匹配不出结论、范围重叠不出结论。测试：`server/lawmind-server-route-playbooks.test.ts`（6 条）、`renderer/LawmindSettingsPlaybooks.test.tsx`（3 条）、`delivery/draft-playbook-triage.test.ts`（7 条）、`deliverables/playbook-store.test.ts`（6 条）；全量 `pnpm test` 1169 文件 8547 测试通过；引擎、桌面、桌面 node 三份 `tsc --noEmit`、`oxlint` 改动文件、`check:renderer-node`、`check:renderer-css` 与 CSS 同步检查通过。

**仍未接**：①观测产出仍只有「必含条款是否存在」；②非条款类交付物（意见书、诉状）没有对应剧本体系。这两项都需要新增分析能力或条款体系，不是界面能补的。

### P3.7 剧本观测扩展与非条款适用范围（2026-10-28）

P3.6 的两条尾巴这轮一起补：

- **检查类型扩展**：`PlaybookCriterion.check` 从只有 `clause_present` 扩成 `section_present` / `phrase_present` / `phrase_absent` / `citation_present`。合同仍走条款抽取；意见书、备忘、诉讼文书只走正文级检查，不跑条款抽取。
- **正文级观测**：`observationsFromDocument()` 逐条生成观测。`section_present` 引标题行；`phrase_present` 引命中句；`phrase_absent` 只在命中时 `FAIL`，未命中一律 `FLAG`；`citation_present` 只认带书名的法条、常见法典条号或案号。所有 `PASS`/`FAIL` 继续带逐字引用 + 行号，并走 `verifyPlaybookObservations()` 回读。
- **适用范围**：`draft-playbook-triage.ts` 从硬编码 `contract.` 改成 `contract.` / `memo.` / `litigation.` 三类前缀；非合同交付物的 `clause_present` 条件如实降 `FLAG`，不猜。
- **设置页**：`LawmindSettingsPlaybooks` 增加检查类型选择、章节标题、必含/禁止表述；客户端先挡空标题、空表述、必含条款没选类型。
- **手册**：新增 `docs/lawmind/LAWMIND-FIRM-PLAYBOOKS.md`，写清不内置法律条款、否定性检查不自动判 GREEN、无剧本 `basis=default`；`manual/22-capabilities-reference.md` 加指针。

**验收（P3.7 本机）**：意见书/诉状 + 本所剧本能出 GREEN/YELLOW/RED 并进决策头；无剧本 `basis=default`；禁止词命中出 RED；未命中只出 FLAG；回读失败不出 PASS；非合同交付物不被合同剧本误套。测试：`deliverables/playbook-triage.test.ts`、`playbook-store.test.ts`、`delivery/draft-playbook-triage.test.ts`、`server/lawmind-server-route-playbooks.test.ts`、`renderer/LawmindSettingsPlaybooks.test.tsx` 等定向套件全过；三份 `tsc --noEmit`、`check:renderer-css` 与 CSS 同步检查通过。

**仍未接**：①观测只做结构、措辞与引用在场性，不做法律实体判断；②剧本仍由律所自写，不内置条款清单；③意见书/诉状的实质验收仍要靠律师量规，不由机械检查替代。

### P3.8 MatterRun 真实交付步骤（2026-10-28）

MatterRun 的状态机、幂等键、租约、等待与唤醒已经存在，但自动办件只落一条 `automation_run`。这轮把交付动作拆成可恢复步骤：

- **步骤机**：新增 `src/lawmind/platform/matter-delivery-run.ts`，一个 job 一个 run：`delivery_wait_job` → `delivery_collect` → `delivery_render` → `delivery_outbound_prepare`；`runId` 由 jobId 决定，重放复用，不产生第二条。
- **等待**：`delivery_wait_job` 在 job 运行中返回 `waiting`，`eventKeys: ["job:<id>"]`、24 小时到期；job 终态由 `lawmind-server-jobs.ts` 调 `wakeMatterRunsForEvent()` 唤醒。job 失败时 run 失败，job 取消时跳过。
- **收集**：`delivery_collect` 只收 job 时间窗内、同一案件的草稿；没有草稿就跳过，不硬造交付物。
- **补渲染**：`delivery_render` 只对 `approved` 且没有输出文件的草稿调用既有 `engine.render()`；已渲染跳过，待审跳过，绝不重跑模型。
- **待发信**：`delivery_outbound_prepare` 只更新自动办件收件箱或写 `pendingSend`，不调用 `send_email`；周更模板只有真实收件人才写待发信，其它模板只写「交付物已就绪」。
- **接线**：`lawmind-local-server.ts` 只在 `mail-contract-redline` 模板创建 delivery run；其它模板保持旧路径；`LAWMIND_DELIVERY_RUN=0` 可回滚。`tickMatterRuns(..., { executors })` 注册四个执行器。
- **界面**：`build-agent-fleet.ts` 与 `LawmindMatterRunWaitDetail` 在等待卡片下列出步骤名、状态与尝试次数；等待超时仍进「待我拍板」。

**验收（P3.8 本机）**：等待中唤醒后按序走完四步；job 失败不产生「已就绪」；job 无草稿时收集/外发跳过；待审草稿不渲染；已批准无输出草稿只渲染一次；`kill -9` 后重启不重复已完成步骤。测试：`platform/matter-delivery-run.test.ts`、`server/lawmind-server-matter-delivery.test.ts`、`matter-run.test.ts`、`matter-run-store.test.ts`、`lawyer-automations-runner.test.ts`、`server/lawmind-server-route-matter-runs.test.ts`、`renderer/LawmindMatterRunWaitDetail.test.tsx` 等定向套件全过。

**仍未接**：①外发仍停在待发信/待拍板，自动发送不在本轮；②补渲染只覆盖已批准草稿，待审草稿仍要律师走审核台；③delivery run 已覆盖所有自动办件模板，但纯收件箱/自定义交办不建 run。

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

### 2026-10-28 收口补记

- **第 4 条（引擎侧术语）已收口**：`mail-tools.ts`、`tool-name-sets.ts`、`packet-outbound.ts`、自动办件与出站绑定文案里的「批准发送 / 批准前 / 批准后」统一为「签批发送 / 签批前 / 签批后」；新增 `mail-tools.test.ts` 契约断言律师可见工具描述不含「批准发送」。通用工具审批（非外发）仍用「批准」，不在这轮外发口径内。
- **第 3 条（officecli 视觉抖动）已按环境争用处理**：该用例单独重复跑 10 次全过；只对这一条加一次 `retry`，断言仍全部重跑，真实失败不会被吞掉。
- **第 1、2 条不变**：签名/公证仍缺 Apple Developer ID 证书与 secrets；80% 基准仍须真实模型跑分。两项的提供物、命令与通过标准已写进 `docs/lawmind/RELEASE-EXTERNAL-INPUTS.md`，工程侧保持诚实 SKIP/红。
- **真稿对照**：`pnpm lawmind:true-manuscript` 仍 SKIP（目录无真实二进制），`pnpm lawmind:release-readiness` 如实列在 Known Risks；不勾 P0-1。
- **工作区备份 / 迁移**：`pnpm lawmind:workspace:backup` / `restore`；默认排除密钥与派生/运行时目录，清单 `BACKUP-MANIFEST.json`，恢复默认拒绝非空目标与恶意路径。见 `docs/lawmind/LAWMIND-WORKSPACE-BACKUP.md`。
- **Doctor 存储巡检**：`pnpm lawmind:doctor` 增案件/审计/会话/草稿体积行；超阈值给轮转建议，先备份再清理。
- **私有化磁盘配额告警**：`lawmind.policy.json` 的 `storage.quotaGb` / `storage.warnRatio` 进 Doctor 工作区合计行；到比例或超额只告警、不拦写入；`--json` 的 `ops.storage.quota.usedRatio` 可接计划任务。见 `docs/lawmind/LAWMIND-WORKSPACE-BACKUP.md` §4。
- **全量验证（分项）**：A1–A7 收口时测试 1176 文件 / 8614 测试通过（4 skipped），覆盖率 statements 70.44% / branches 60.83% / functions 71.54% / lines 70.51%，均高于地板；三份 typecheck、CSS 同步、文案 lint、平台契约、HTTP smoke、release-readiness 均通过。`pnpm lawmind:desktop:e2e:pr` 55 通过 / 2 skipped。A8 追加 4 条存储体检测试；A7/A8 定向合计 24 条通过。
