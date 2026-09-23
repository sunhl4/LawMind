# 附录 C 文件布局、审计事件与门禁全表

这个附录是「出问题时去哪儿看」的索引。三部分：工作区里有什么文件、审计记了哪些事件、有哪些门禁。

## C.1 工作区目录布局

工作区默认在 `<用户数据目录>/LawMind/workspace`，可在设置里改。

### 顶层

```text
workspace/
  MEMORY.md                    通用长期记忆
  LAWYER_PROFILE.md            律师个人偏好
  FIRM_PROFILE.md              律所级规则
  CLIENT_PROFILE.md            根级客户档案
  clients/<clientId>/CLIENT_PROFILE.md
  playbooks/
    CLAUSE_PLAYBOOK.md
    COURT_AND_OPPONENT_PROFILE.md
    word-revision/<family>.md  律师自订的清单一族（覆盖内置）
  memory/
    YYYY-MM-DD.md              每日日志
    topics/historical-scan.md  历史扫描采纳的知识
    lawyer-profile-archive.md  §八 轮转归档
  cases/<matterId>/            见 C.2
  matters/<matterId>/          见 C.3
  drafts/                      草稿与侧车
  sessions/                    会话
  tasks/                       任务
  audit/                       审计
  delegations/                 委派
  collaboration/               协作产物
  collaboration-audit/         协作事件（按天）
  quality/                     质量记录与指标
  golden/                      黄金样本
  edits/edit-examples.jsonl    改稿样例
  learning/                    学习队列与合同积累
  memory-adoption/suggestions.jsonl
  lawmind/                     引擎自己的状态（见 C.4）
  artifacts/                   兜底产物目录
  notes/                       笔记类写入
  uploads/                     未归入案件的上传
  meetings/adhoc/              临时会议室
```

### `lawmind/` 下（引擎状态）

```text
lawmind/
  policy.json?                 其实叫 lawmind.policy.json，在**工作区根**
  skills/<skillId>/SKILL.md + SKILL.sig
  skills/enabled.json
  skills/.signing-secret       派生/文件密钥（生产不该用它）
  bundles/<name>.json          包清单
  packs/cn-legal-pack.json
  workflows/<id>.json          工作流模板
  fleet-playbooks/*.json       专案组模板
  jobs/<jobId>.json            后台任务
  automations/<id>.json
  automations/<id>/runs/*.json
  automation-inbox/<id>.json
  daily-plans/<YYYY-MM-DD>.json
  routing/defaults.json
  stance/items.json            立场库
  stance/items.json.lock
  historical-scan/jobs/*.json
  historical-scan/roots.json
  historical-scan/cursor.json
  lawyer-preferences.json      可执行偏好
  lawyer-identity.json         副本身份
  lawyer-keys.json             副本密钥对
  replica/inbox/               邀请收件箱
  decision/decision-samples.jsonl
  decision/guardian-item-outcomes.jsonl
  metrics/true-manuscript-report.json
  word-addin/reviews.json
  search-index.sqlite          索引（派生）
  daemon.json / daemon.pid / daemon.lock
  search-index 的 schema 版本现在是 3
```

注意 `lawmind.policy.json` 在**工作区根**，不在 `lawmind/` 里。

## C.2 `cases/<matterId>/`

```text
CASE.md                    案件档案（人读，JSON 的投影）
MATTER_STRATEGY.md         案件策略
RULES.md                   本案强制规则（**会进系统提示词**）
materials/                 案件材料
artifacts/                 交付产物
session-summary.md         会话摘要累积
progress-archive.md        轮转出的工作进展
team-meeting.jsonl         会议室记录
meeting-summary.md         会议纪要
ethics-wall.json           伦理墙状态
replica/
  membership.json          成员名册
  invites.jsonl            邀请
  ops.jsonl                操作日志
  locks.json               签出锁
  materials-index.json
  matter-key.json          **案件密钥（永不外传）**
  case-md-live.json        实时合并状态
mail/ inbox/ sent/ outbox/
```

## C.3 `matters/<matterId>/`

JSON / JSONL 真相源：

```text
matter.json                案件主体（机器真相源）
deliverables/<id>.json     交付物
approvals.jsonl            审批
queue.jsonl                待办队列
deadlines.jsonl            期限
intake-brief.json          谈话摘要
desk-writes.jsonl          工作台写入日志（撤销用）
ops/
  scope.json
  plan.json
  raid.jsonl
  theory-lite.json
campaigns/<id>.json        审查专案组（也可在 lawmind/campaigns/）
```

锁文件：`matter.json.lock`、`deliverables/<id>.json.lock`、`approvals.jsonl.lock`、`queue.jsonl.lock`、`deadlines.jsonl.lock`。

## C.4 桌面端应用根

`<用户数据目录>/LawMind/`（工作区之外）：

```text
.env.lawmind               环境变量（明文密钥保存后被抹掉）
desktop-config.json        持久化端口、凭据代次、吊销名单
lawmind-secrets.json       safeStorage 加密的密钥
mail-secrets.json          邮箱密钥（AES-256-GCM）
assistants.json            助手档案
assistant-stats.json       助手统计
assistants/<id>/PROFILE.md 助手偏好档案
host-access.json           本机文件夹挂载
local-api-clients.json     CLI 只读凭据（0600）
keyfile 目录之外的密钥：~/.lawmind/keys/*.key（0600）
许可：~/.lawmind/license.json（0600）
```

## C.5 审计事件全表

审计写在 `<工作区>/audit/YYYY-MM-DD.jsonl`（按天分文件），开了完整性链时每行带 `previousHash` / `eventHash` / `hashAlg`。

**全表共 74 个事件**，即 `src/lawmind/types.ts` 的 `AuditEventKind` 联合成员数——**这份表是照那个联合一个成员一个成员抄的**，不是按名字猜的。判断某个字符串算不算审计事件，最快的办法就是去那个联合里搜。

### 核心事件

| 事件            | 什么时候                                        |
| --------------- | ----------------------------------------------- |
| `tool_call`     | 每次工具调用（执行**之前**记，失败也留痕）      |
| `agent_turn`    | 回合收尾                                        |
| `safe_command`  | 桌面壳的 shell 动作（**单独文件**，不进哈希链） |
| `outbound_http` | 每次出站 HTTP（不记 body、不记 query）          |

### 任务、检索与草稿

| 事件                                                                                     | 什么时候        |
| ---------------------------------------------------------------------------------------- | --------------- |
| `task.created`                                                                           | 建任务          |
| `task.confirmed` / `task.rejected`                                                       | 任务被确认/驳回 |
| `research.started` / `research.completed`                                                | 深度研究起止    |
| `triage.created` / `triage.confirmed`                                                    | 分诊创建与确认  |
| `draft.created`                                                                          | 建草稿          |
| `draft.content_edited`                                                                   | 正文被编辑      |
| `draft.reviewed`                                                                         | 审核签批        |
| `draft.review_labeled`                                                                   | 打审核标签      |
| `draft.review_reopened`                                                                  | 重开审核        |
| `draft.citation_integrity`                                                               | 引用完整性检查  |
| `draft.reasoning_graph_missing`                                                          | 推理图缺失      |
| `draft.auto_delivered`                                                                   | 自动交付        |
| `draft.peer_review_required` / `draft.peer_review_skipped`                               | 强制互审        |
| `draft.revision_dispatched` / `draft.revision_completed` / `draft.revision_agent_failed` | 后台修订三步    |

**注意 `draft.saved` 与 `draft.scaffold_density` 不是审计事件。** 前者只在索引测试里当文档 kind 用，后者是验收检查 key（本附录 C.6 也把它当检查项用）。同理 `agent.instruction` 是 E2E 测试路由里的任务 kind。**这三处是本表以前最容易误判的地方**——照名字看着都像审计事件。

### 交付

| 事件                      | 什么时候                       |
| ------------------------- | ------------------------------ |
| `artifact.rendered`       | 渲染成功                       |
| `artifact.render_blocked` | 渲染被门禁拦下（详情记哪个门） |
| `artifact.render_failed`  | 渲染失败                       |
| `artifact.sent`           | 外发                           |

### 案件

| 事件                       | 什么时候                 |
| -------------------------- | ------------------------ |
| `matter.write_failed`      | 案件写入失败             |
| `matter.projection_failed` | 投影（JSON→CASE.md）失败 |
| `matter.spec.invalid`      | schema 校验失败          |
| `deliverable.spec.invalid` | 交付物规格不合法         |

**`matter.field_set` 不是审计事件**——它是案件副本的操作 kind（`matter-replica/types.ts`）。名字像，但归属不同。

### 记忆与学习

| 事件                                                     | 什么时候                     |
| -------------------------------------------------------- | ---------------------------- |
| `memory.adoption_suggested`                              | 建议入队                     |
| `memory.adoption_auto_adopted`                           | 自动采纳（只用于明确低风险） |
| `memory.adoption_adopted`                                | 律师采纳                     |
| `memory.adoption_dismissed`                              | 忽略                         |
| `memory.adoption_recorded_noop`                          | 采纳了但没落盘面（如实记录） |
| `memory.profile_updated`                                 | 档案被写                     |
| `memory.playbook_updated`                                | playbook 被写                |
| `learning.suggestion_queued` / `_adopted` / `_dismissed` | 学习队列                     |
| `golden.example_promoted`                                | 提升黄金样本                 |
| `contract_revision_accumulation_failed`                  | 合同修订积累失败             |

### 质量与平台

| 事件                     | 什么时候         |
| ------------------------ | ---------------- |
| `quality.benchmark_run`  | 基准跑完         |
| `quality.snapshot`       | 质量快照落盘     |
| `platform.gate_snapshot` | 门禁快照         |
| `mcp.servers_updated`    | MCP 服务器配置变 |

### 路由与门禁

| 事件                                           | 什么时候       |
| ---------------------------------------------- | -------------- |
| `routing.resolve_ok` / `_fallback` / `_failed` | 默认承办人解析 |
| `session.forked_with_carryover`                | 承前分叉       |

### 自动化

| 事件                    | 什么时候       |
| ----------------------- | -------------- |
| `automation.run_failed` | 自动化运行失败 |

**`automation_confirmations_missing` 与 `automation_from_work_failed` 是 API 错误码，`automation_send` 是渲染层队列 kind**——三个都不是审计事件。自动化真正落进审计链的只有 `automation.run_failed`。

### 协作

| 事件                                               | 什么时候         |
| -------------------------------------------------- | ---------------- |
| `collab.invite_created` / `_accepted` / `_revoked` | 邀请             |
| `collab.member_removed`                            | 移除成员         |
| `collab.key_distributed` / `_rotated`              | 密钥分发与轮换   |
| `collab.member_key_published`                      | 成员公钥发布     |
| `collab.material_filed` / `_removed`               | 材料增删         |
| `collab.document_checked_out` / `_released`        | 签出/归还        |
| `collab.integrity_rejected`                        | 材料哈希不符被拒 |
| `collab.conflict_parked`                           | 冲突旁车         |
| `collab.sync_activity`                             | 同步活动         |
| `collab.cloud_roster_applied`                      | 云端名册应用     |

### 界面与产品观察

| 事件                           | 什么时候               |
| ------------------------------ | ---------------------- |
| `ui.matter_action`             | 案件工作台里的律师动作 |
| `ux.matter_action`             | 同上（产品观察通道）   |
| `ui.firstrun_wizard_completed` | 首跑向导完成           |
| `ui.firstrun_acceptance_ready` | 首跑验收就绪           |

### 审稿与专案组

| 事件                         | 什么时候 |
| ---------------------------- | -------- |
| `review_campaign.created`    | 建专案组 |
| `review_campaign.role_rerun` | 重跑角色 |

独立审稿（Guardian）的事件不在审计里，它有自己的侧车：`drafts/<taskId>.guardian.json`。

## C.6 门禁全表

### 分类：硬墙 vs 软项

**安全硬墙（7 个，不许绕过）**：

| 门禁                      | 拦什么                 |
| ------------------------- | ---------------------- |
| `dangerous_tool_gate`     | 危险工具               |
| `approval_gate`           | 需要律师批准           |
| `acceptance_gate`         | 验收未过               |
| `redline_hunks_gate`      | 空修订不许导出         |
| `surgical_span_gate`      | 最短改动自查（经验值） |
| `outbound_privilege_gate` | 外发特权检查           |
| `outbound_recipient_gate` | 外发收件人检查         |

**判断软项**：可以「我不同意照样出」的，主要是独立审稿给出的判断项和澄清类门禁。

### 工具管线的 18 道（第 5 章）

按顺序：`unknownTool` → `budget` → `noTaskTurnGate` → `permissionMode` → `discoveryLoop` → `hostFileLoop` → `roleAllowlist` → `matterScope` → `clarificationGate` → `folderExploreGate` → `approval` → `argNormalize` → `argSchema` → `legalVerify` → `audit` → `timeout` → `subprocessSandbox` → `execute`。

### 验收检查（第 12 章）

| 检查 key                                   | 严重度               |
| ------------------------------------------ | -------------------- |
| `section.<序号>.<关键词>`                  | 按规格               |
| `placeholders.resolved`                    | 需要就 blocker       |
| `criteria.coverage`                        | warning              |
| `clarifications.closed`                    | warning              |
| `draft.body.placeholder_density_heuristic` | warning（阈值 0.38） |
| `contract.review.clause_anchor`            | blocker              |
| `contract.review.recommended_wording`      | warning              |
| `draft.scaffold_density`                   | 密集则 blocker       |

### 推理门检查

| 检查 key                       | 严重度           |
| ------------------------------ | ---------------- |
| `graph_present`                | 按是否 required  |
| `min_issues`                   | 按是否 required  |
| `facts_grounded`               | **永远 warning** |
| `authority_conflicts_resolved` | 按配置           |
| `issues_have_authority`        | warning          |
| `confidence_ok`                | warning          |

五条结构检查（全 warning）：`issues_grounded`、`argument_supports_traced`、`authorities_cited_in_body`、`irac_levels_present`、`no_open_questions`。

### 机器验证器（12 个）

`forum.form_valid`、`citations.subset`、`citations.used`、`graph.authority_used`、`parties.consistent`、`amounts.case_consistent`、`dates.ordered`、`placeholders.closed`、`statute.lpr_multiple`、`statute.deposit_cap`、`guarantee.form_valid`、`disputeFormVerifier()`。

未知验证器或抛错 → 记 `unavailable`（fail-closed），不静默丢弃。

### 研究类门禁

| 门                           | 文案要点                         |
| ---------------------------- | -------------------------------- |
| `research_evidence_gate`     | 证据不足拒绝扩写正文             |
| `research-write-bypass-gate` | 不许用 `write_document` 旁路交付 |

### 最短改动的五个落槌边界（第 8 章）

| 边界         | 位置                                                  |
| ------------ | ----------------------------------------------------- |
| B1 模型输入  | `drafts/apply-surgical-edits.ts`                      |
| B2 hunk 生成 | `drafts/surgical-diff.ts`                             |
| B3 文件落盘  | `artifacts/render-docx-tracked.ts`                    |
| B4 Word 插件 | `integrations/word-addin/review-requests.ts`          |
| B5 成品复核  | `drafts/tracked-xml-qa.ts`（唯一看实际 .docx 的一道） |

### 其他硬约束

| 约束                                             | 位置                                           |
| ------------------------------------------------ | ---------------------------------------------- |
| 空修订不许导出（`MIN_TRACKED_RENDER_HUNKS = 1`） | `drafts/tracked-render-hunk-gate.ts`           |
| 跨文书整批预检（任一冲突则零写入）               | `drafts/cross-document-edits.ts`               |
| 必核清单没勾完不许签批                           | `deliverables/verification-checklist.ts`       |
| 治理路径不许改                                   | `runtime/protected-workspace-rels.ts`          |
| 可写根白名单                                     | `electron/fs-bridge.mjs` / `server` 侧对应实现 |
| 只读模式工具白名单（32 个）                      | `agent/permission-mode.ts`                     |
| 外发只有 `send_email` 机械暂停                   | `platform/lawyer-outbound-decision.ts`         |
| 伦理墙拦住外发                                   | `policy/ethics-wall.ts`                        |

## C.7 索引与派生数据

以下都是**可重建**的，真正的真相源是 Markdown / JSON：

| 派生数据 | 位置                                    | 怎么重建                                       |
| -------- | --------------------------------------- | ---------------------------------------------- |
| 全文索引 | `lawmind/search-index.sqlite`           | `POST /api/search/workspace/rebuild`（需开关） |
| 案件索引 | 内存派生自 CASE.md + 任务 + 草稿 + 审计 | 无需重建                                       |
| 案件总览 | 同上                                    | 无需重建                                       |
| 指标快照 | `quality/*.json`、`lawmind/decision/*`  | 从事件重算                                     |
| 项目投影 | `cases/<id>/CASE.md` 的结构化段         | `POST /api/matters/repair-projections`         |

索引的 schema 版本现在是 **3**（加材料表时升过）。索引超过 24 小时算陈旧。

## C.8 三类「单独文件」的审计

有三处审计刻意**不写进主审计链**：

| 审计              | 位置                                            | 为什么不进主链                   |
| ----------------- | ----------------------------------------------- | -------------------------------- |
| 桌面壳 shell 动作 | `<工作区>/audit/desktop-shell-YYYY-MM-DD.jsonl` | 避免「插入」事件打断引擎的哈希链 |
| 协作事件          | `<工作区>/collaboration-audit/YYYY-MM-DD.jsonl` | 量大且独立成体系                 |
| 独立审稿          | `drafts/<taskId>.guardian.json`（侧车）         | 是审稿的输入输出，不是全局事件   |

主链只有引擎自己的业务事件，这样链的语义干净。

## C.9 怎么核对这份附录

```bash
# 审计事件名
rg -o 'kind: *"[a-z_.:]+"' src/lawmind apps/lawmind-desktop/server | sed 's/.*kind: *//' | tr -d '"' | sort -u

# 工作区文件位置（看板）
ls workspace/ workspace/lawmind/ 2>/dev/null

# 一个具体案件里有什么
ls -R workspace/matters/<案件id>/ workspace/cases/<案件id>/ 2>/dev/null
```

注意：`workspace/` 下的运行数据不进版本控制（由 `.gitignore` 排除），真相源在 `src/lawmind/skills/builtin/*.md` 和 `src/lawmind/agent/collaboration/*-templates.ts`。
