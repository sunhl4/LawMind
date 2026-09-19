# LawMind「未来问题」总册

> **用途**：集中登记**已识别、暂未做完或需长期回看**的工程/产品风险，避免散落在聊天与多个 backlog 里丢失。  
> **怎么用**：新发现的「以后会痛」的问题写进对应章节；落地后勾选并链到 PR/审查文。  
> **不是**：当前 sprint 清单（那是具体 PR）；也不是愿景文档（见 VISION / OPTIMIZATION-BACKLOG）。

**交叉引用**

| 文档                                                                                         | 关系                                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [LAWMIND-PERSISTENCE-SCALE-REVIEW.md](./archive/LAWMIND-PERSISTENCE-SCALE-REVIEW.md)（归档） | 持久化膨胀 / token / 扫盘审查与 P0–P2 已实施细节                                                                |
| [LAWMIND-OPTIMIZATION-BACKLOG.md](./archive/LAWMIND-OPTIMIZATION-BACKLOG.md)（归档）         | 产品远景与能力 backlog                                                                                          |
| [LAWMIND-ENGINEERING-REVIEW.md](./archive/LAWMIND-ENGINEERING-REVIEW.md)（归档）             | 工程评审与已落地附录                                                                                            |
| [LAWMIND-AGENT-PARITY-REVIEW.md](./LAWMIND-AGENT-PARITY-REVIEW.md)                           | 上手/智能/稳态/律师专用对标 Cursor·Codex·Claude Code（2026-09-15，P0–P2 已落地；2026-09-18 市面对标切片已落地） |
| [LAWMIND-CODEX-WORKER-PARITY.md](./LAWMIND-CODEX-WORKER-PARITY.md)                           | 子工/并行循环对标 Codex subagent（P5–P8；P0–P4 已落地）                                                         |

---

## 1. 持久化与扩展性（长期使用 / 多案件）

> 背景审查：2026-07-18 → [PERSISTENCE-SCALE-REVIEW](./archive/LAWMIND-PERSISTENCE-SCALE-REVIEW.md)（归档）

### 已缓解（勿重复开坑）

- [x] Prompt 注入窗口（CASE / 画像 / 日日志等）
- [x] CASE §8 进展轮转 + `progress-archive.md`
- [x] 案件列表 lite（不扫全量 audit）
- [x] `readRecentAuditLogs` 限窗
- [x] 相似案读入上限；检索适配器截断
- [x] 协作 audit 按天分文件
- [x] CASE.md per-matter 写锁（`case-md-lock.ts`）

### 仍待做

- [ ] **真正的 matter 级 audit 索引**（taskId/matterId → 日期文件偏移），彻底告别「按天窗口近似」
- [ ] **会话磁盘 compact**：`sessions/*.json` 与 `.turns.jsonl` / transcript 归档或 gzip 旧段；热路径只保留摘要
- [ ] **queue / approvals / adoption JSONL**：行数大时改为 append-only + 软删，或 SQLite
- [x] **atomic `rewriteJsonl`**（短中期）：temp+rename 已落地（ENGINEERING-REVIEW **R-P1-9 ✅**）；长期 JSONL→SQLite 仍见上条
- [ ] **LAWYER_PROFILE §八写侧轮转**（prompt 已截断；档案本体仍可能无限 append）
- [ ] **`model-usage/ledger.jsonl` 保留策略**（按月滚动）
- [ ] **FTS 重建增量索引**（避免全量扫 audit + turns）
- [ ] **详情 API 按章节懒加载 CASE**（UI 不必一次拉 120k）
- [x] **工具 `read_case_file` 默认窗口**（禁止默认返回全文）
- [x] **案件副本 last-writer**（2026-09-17）：材料按 `updatedAt` LWW，败方落到 `（冲突）` 旁路；签出中的路径不拉覆盖。CASE.md **永不被快照覆盖**（摘录截断），分歧写入 `CASE（冲突摘录）.md`。Yjs/Loro 活层仍见 MATTER-REPLICA M3。

---

## 2. Agent / 上下文与成本

- [x] **隐式意图编译（2026-09-13）**：办件选择沉入引擎 `compileIntent`；律师主路径只交办文字/文件。见 `src/lawmind/intent/`、GOALS 第十七期。
- [x] **真循环 cassette 准入**（2026-09-13）：`TestLawMind.builder()` 假模型 + 真 `runTurn` / 真工具名 / 真门禁；编排改动断言下一轮请求体。影子回放仍只管交件召回。见 `src/lawmind/agent/testkit/` 与 `AGENTS.md`。
- [x] **探查工 sidecar 不抢父循环 cassette 槽**（2026-09-17）：默认 spy 表跑真 `explore_folder` walker，但 `inReadonlyWorkerLoop` 关掉嵌套 HTTP；`withLegalTools()` 仍会与父循环共用同一 cassette 端口（脚本多一轮 sidecar 响应，或继续用 spy）。见 `gate-spy-registry.ts`。
- [x] System prompt 工具列表随 registry 膨胀 → 默认 compact + 核心 12 + `list_more_tools` 本会话披露（2026-08-16 W1-C；registry 仍保留全部 execute）
- [x] **上下文当类型系统**（2026-09-13）：`prompt-fragments.ts` 每种注入有 kind / cap / overflow 指针；world-state 真正包裹 `deliverable`；权限改短 XML；相关记忆只进 gist；工具结果默认 ~1k **token**（2026-09-15 起按 CJK 估算，不再把 4k 汉字当成 1k token）；采样时 `deriveModelMessagesForSampling` 追加 `<turn_context>`（CASE/画像/craft/skills）与剩余 token 注记（不写进 history）。人格成长仍写磁盘，prompt 只留指纹。
- [x] 相关记忆召回与 system 注入的统一 budget 账本（单一计数器）
- [x] 检索链路（research）与对话链路共享同一套窗口常量（避免两套漂移）
- [x] **Codex 子工差距收敛 P5–P7**（2026-09-17）：共用只读 sidecar、explorer 真循环、draft 加深（预算 5 / 轻验收 / read_project_file）、律师卡进度。P8 角色包仍可选。硬约束：不嵌套 `runTurn`、不静默改写、`routeAsync` 不进 `runTurn`。见 [LAWMIND-CODEX-WORKER-PARITY.md](./LAWMIND-CODEX-WORKER-PARITY.md)。
- [ ] 多 agent 并行时的上下文隔离配额（避免会议室 + 多委派同时灌满）
- [x] **同 session 并行 turn**：进程内按 `workspaceDir+sessionId` 串行（`session-turn-gate.ts`，2026-08-14）；跨进程双开本地 server 仍可能竞态（桌面默认单进程）
- [x] **本轮可见短清单（update_plan）**（2026-09-13）：Codex 级 2–8 步 checklist 写入 world-state `plan`，律师在对话卡片勾进度；不往 system prompt 再塞一份「自主工作流程」。与 `plan_task` / `execute_workflow` / planHandoff 分离。
- [x] **计划模式（2026-09-15）**：`readonly` 回合写工具关闭，清单可取消步骤，点「开始执行」再放写工具。见 [LAWMIND-AGENT-PARITY-REVIEW.md](./LAWMIND-AGENT-PARITY-REVIEW.md)。
- [x] **发挥模型（2026-09-17）**：提到文件夹 / 钉选目录时 WRITE_HEAVY 须先 `explore_folder`（Word 改稿、邮件短路径、「继续」除外）；探查/写稿子工内步骤推到律师进度；compact 对已披露的 `explore_folder` / `list_dir` / `read_skill` / `draft_worker` 给完整参数；中途指示立刻显示「已带入本轮」；计划卡片与交接条可点「开始执行」。
- [x] **独立审稿员（法律 Guardian）**：交卷前另开短调用，只喂 hunk/锚句/章节/争点树/引用/清单/硬门禁事实；fail 缺口打回工具结果；审稿全文不进主会话。`render_tracked_draft` 与意见类 `render_document`（memo.opinion / memo.research / contract.review / 函件 / 诉讼）均已接入。内部备忘、PPT、律师点导出仍不跑审稿员。证据包 hash 相同则跳过审稿 LLM。见 `src/lawmind/guardian/`。
- [x] **同一回合验收 bounce 不进长期历史**（2026-09-15）：全文只服务下一轮采样；绿则删除，暂停收成 `【验收缺口】` 码。见 `src/lawmind/runtime/same-turn-verify.ts`。
- [x] **律师可见工具卡 / Stop 打到工具 / 轮中补材料 / 结构事件日志 / prompt 段表**（2026-08-14 DeepSeek 三刀；`session.json` 仍为权威，events.jsonl 并行）
- [x] **纠正本轮 / 检索邮件 spill / 溢出先剪再试 / 停止与超时正交**（2026-08-16 DeepSeek 第二遍；见 ENGINEERING-REVIEW 附录）
- [ ] **事件日志升格为会话权威**：今日 `events.jsonl` 只投影 live-turn；完整替换可变 `session.json` + 流式 delta 回放仍待做

---

## 3. 产品与治理（从评审迁移）

- [ ] **文档站自动发布到托管**（Pages / Cloudflare）
- [ ] **智能体层级强制策略**（仅可向汇报线委派等）写进 `validateDelegation` / `lawmind.policy.json`
- [ ] **互审多轮与版本时间线**（`request_review` 现为单轮）
- [x] Firm 伦理墙可拦截外发：冲突扫描命中则 hold `prepare_outbound_mail` / `send_email`；披露只走 `acknowledgeEthicsWall`（桌面 `POST /api/ethics-wall` 或律师 `__approved` 恢复），模型自填 `ethics_wall_acknowledged` 会被剥除。`ethics-wall.json` 进写保护 + host deny-list。独立客户披露治理流程仍薄。
- [ ] 权威外库 API 与本机启发式拒答的长期校准

---

## 4. 桌面 UX / IA 债

- [x] Action Hub 模态 vs「在办」主视图的最终收敛：侧栏/顶栏/对话「待我拍板」直接进「在办」（不再开模态）
- [x] 一级顶栏为 **对话 / 工作台 / 在办**（`LawmindMainView`）；会议室与改稿为次级深链，不占一级对等 Tab
- [x] 意图状态条与 `runTurn` 同源 compile（`POST /api/intent/compile` + peek）；拖文件不再自动弹合同审查卡；unbound/纠正清 `lastBound`
- [x] `cases/*/RULES.md` 纳入写保护（与 `matters/*/RULES.md` 同口径）
- [x] 旧 Matter cockpit 页并入工作台本案卷宗（顶栏案件名 / 侧栏选案 → `desk` + dossier）
- [x] 会议室：工作区级临时讨论存储（`meetings/adhoc/`，不再 `POST /api/matters/create` 造假案件；遗留 `cases/临时讨论` 自动迁移并在事项列表隐藏）
- [x] 会议室：对话「引用到对话」材料注入 `meetingAgenda`（每轮模型上下文；议题旁可见材料列表）
- [x] 会议室：议题材料选择器（复用 `LawmindComposeContextPicker` + 搜索框；与对话 pins 同一真相源）
- [x] 无文件系统桥接时的建案/材料树降级体验（侧栏「新建」CTA + 对话空态不再依赖 FS 桥，2026-07-20；材料树本身仍需桥接）
- [ ] 超大工作区（数千案件）下的侧栏虚拟化与搜索索引
- [ ] **对话写穿工作台档案**（传票/谈话/卷宗）：施工合同 [LAWMIND-CHAT-MATTER-FILL.md](./LAWMIND-CHAT-MATTER-FILL.md)，进度在 `GOALS.md` 第十八期。不是再加办件菜单。
- [x] 文书台预览窗与主窗状态同步：`sync-request` + 未保存 live 不被 8s 磁盘轮询覆盖
- [x] **接着昨天**（2026-09-17）：未勾完的律师手写计划在 14 天回看内以视图挂到「要我处理」，带原日期；勾完写回原日 JSON，不复制出第二份待办。邮件/期限/拍板本来就按活数据跨天，不参与搬运。
- [x] **本案只读时间线**（2026-09-17）：工作台卷宗概览聚合期限 / 来信 / 出稿 / 待拍板 / 谈话，最多 24 条；不扫 audit / session 当时间线。
- [x] **材料升回卷宗**（2026-09-17）：本案「材料」Tab 列 `cases/<id>/materials`（mtime/size，不扫 SHA）；生成产物从文书页挪走；Firm 协作副本挂在材料页而不是卷宗表单。
- [x] **本案当事人卡片**（2026-09-17）：`matter.json.parties` 记角色与送达（最多 8 人）；`clientId`/`counterparty` 由委托人/对方派生。伦理墙 `readMatterParties` 与冲突扫描读同一名称。不是律所 CRM。
- [x] **期限链 + 来源徽章**（2026-09-17）：`dependsOnDeadlineId` 单前置；读时计算释放；今日/提醒跳过未释放（开庭除外）；确认写入时上诉期可挂开庭；期限页徽章与「等…完成」；律师可改前置或直接完成。不做日历写入、不做 DAG。
- **不做**：对话消息区改 `role="tabpanel"`。会话 Tab 已有 `aria-controls`，面板保持 `region` + `aria-busy` + `#lawmind-chat-messages-panel`。改 tabpanel 会拆多份 e2e `getByRole("region", { name: "对话消息" })`，律师可感知收益接近零。

---

## 5. 安全与运维

- [x] **邮件密钥进 OS 钥匙串**（2026-09-17 核验）：`mail-secrets.json` schemaVersion 2 已是 AES-256-GCM；Electron main 经 keyVault（safeStorage）注入 `LAWMIND_MAIL_SECRETS_KEY`。Headless / CLI / 守护进程仍降级 `~/.lawmind/keys/mail-secrets.key`（0600）。不要再包一层 JSON 加密。残留：守护进程无 Electron 时走文件密钥，不是第二套产品。
- [ ] 工作区备份 / 迁移工具（含 progress-archive、day-split audit）
- [ ] 审计完整性链在「按天窗口读取」下的校验策略说明
- [ ] Doctor：检测 CASE/audit/session 体积异常并建议轮转
- [ ] 私有化部署下的磁盘配额告警
- [x] **本机能力（对齐 Cursor 找/读/收进本案/受控命令）**：多根、本机查找、`hit_id` 授权、一次/会话/始终、案件围栏、受控命令、伦理墙与访问日志。见 [LAWMIND-HOST-ACCESS.md](./lawmind/LAWMIND-HOST-ACCESS.md)。残留：MAS security-scoped bookmark 原生层；Windows Search 目前走已授权根遍历。
- [x] **工作区相对读的 realpath 围栏**（2026-09-17）：`fenceAgentFilePath` 覆盖 `read_project_file` / `write_document` / 律师本机解析 / 邮件附件；打包态忽略 `LAWMIND_HOST_ACCESS_MODE`。
- [x] **IPC 项目目录须经系统选择器**（2026-09-17）：`set-project-dir` / `add-host-folder` 只接受本进程 `showOpenDialog` 记过的路径；`null` 仍可清除。
- [x] **loopback Host 钉死**（2026-09-17）：`Host` 必须是 `127.0.0.1` / `localhost` / `::1`（可带端口）。打包态缺 Host 拒绝；开发/测试允许缺 Host。

---

## 6. 工程卫生

- [ ] **脏树按主题拆 PR（N-A0）**：组织/合并面，不是代码缺陷。要发 PR 时再切，勿在功能轮顺手拆。
- [ ] **`engine-pipeline-tools.ts` 按工具族拆文件**：现约 1300 行、7 个工具定义。下次改起草/渲染工具时顺手拆，不单独开重构轮。
- [x] `memory/index.ts` ↔ `case-writes.ts` 循环依赖拆干净（ensureCaseWorkspace 下沉 → `memory/case-workspace.ts`，2026-07-20）
- [ ] 桌面 server 路由与引擎查询层对「lite vs full index」API 命名统一
- [ ] CI：为 prompt-windows / overview-lite 增加回归门禁（已有单测则挂到 PR 集）
- [ ] `persistDraftPipeline` 仍为同步 API、CASE 进展 `void` 触发：长期可改为 async 管道，避免测试/热路径依赖「锁 + 最终一致」
- [ ] 将其它 Markdown 真相文件（日日志、LAWYER_PROFILE）也纳入同类写锁或统一 write-gateway
- [ ] **双真相写路径收敛**（检测已部分落地）：高风险字段单写口见 ENGINEERING-REVIEW **R-P2-7**（review stamp SSOT + `transitionDeliverable` 防 approved/rejected 回写，2026-07-28；**2026-09-17** 已签批后重新挂 pending/modified 稿体会 reopen 审核，避免桌面显示已通过而 JSON 仍是未审正文）；Doctor 巡检含 `client_drift`，以及 **2026-09-17** 起 `cause_drift` / `counterparty_drift`（仅在 JSON 与 CASE 两侧都有值且不一致时报警，避免旧案由仅在 CASE 的存量误报）。**案由 / 对方当事人** 已进 `matter.json`，CASE §1 投影，卷宗 pulse 优先读 JSON。叙事章节（争点/进展等）与 tasks↔drafts 其余写路径仍属本文件长期项。不做 Markdown↔JSON 合并编辑器。

---

## 变更记录

| 日期       | 说明                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-18 | 建册；并入持久化审查未尽项与 DEFERRED 类问题；链到 PERSISTENCE-SCALE-REVIEW                                                                             |
| 2026-07-18 | 标记 CASE.md 写锁已落地；补充日日志/画像写锁与 async draft pipeline 待做项                                                                              |
| 2026-07-25 | 链到工程 9.5 冲刺：R-P1-9 atomic rewriteJsonl、R-P2-7 写路径收敛（短中期）                                                                              |
| 2026-08-14 | DeepSeek 三刀落地（中文卡 / Stop+工具信号 / 轮中注入 / events.jsonl / prompt 段表）；session.json 仍为权威                                              |
| 2026-09-13 | 法律 Guardian：交卷独立审稿员（有界证据，不进主会话）；`craft_check` 只保留缓办声明；意见类 `render_document` 接入同一审稿员                            |
| 2026-09-13 | 本轮可见短清单：`update_plan` 写入 world-state，对话勾进度；不新增第三份自主工作流程作文                                                                |
| 2026-09-13 | 真循环 cassette 准入：编排改动断言下一轮请求体；影子回放仍只管交件召回                                                                                  |
| 2026-09-13 | 隐式意图编译：办件沉入引擎，金标集 + 文件形态 × 文本动词；对话不再暴露分类菜单                                                                          |
| 2026-09-14 | 意图状态条同源 peek；停拖文件自动审查卡；`cases/*/RULES.md` 写保护；诉讼 Word 改稿补 craft；cockpit 并入工作台卷宗；ARCHITECTURE 权限模式与一级导航对齐 |
| 2026-09-15 | Agent 对标残留：渐进披露、计划自动执行、Firm 伦理墙拦外发、NPC 开源权威优先于样本；见 AGENT-PARITY-REVIEW                                               |
| 2026-09-17 | 工程复评落地：伦理墙律师披露 SSOT、工作区 IO 围栏、澄清含 `draft_worker`、签批文案、意图条 session 同源、cassette 探查工隔离；见 canvas 2026-09-17      |
| 2026-09-17 | 续轮：IPC 选择器授权、loopback Host 钉死、副本材料 LWW+冲突旁路 / CASE 摘录不覆盖                                                                       |
| 2026-09-17 | 工作台：未结计划跨天视图（接着昨天）；邮件密钥 FUTURE 与 AES-GCM+keyVault 对齐；案由/对方进 matter.json SSOT                                            |
| 2026-09-17 | 工作台卷宗：只读本案进展时间线 + 材料一等 Tab（stat 列表，不扫 SHA）；协作副本从卷宗表单挪到材料页                                                      |
| 2026-09-17 | 工作台：本案当事人卡片（角色/送达）进 matter.json；伦理墙与冲突扫描共用名称；不是 CRM                                                                   |
| 2026-09-17 | 工作台：期限链（单前置释放）+ 来源徽章；确认写入上诉期挂开庭；今日/提醒跳过未释放                                                                       |
