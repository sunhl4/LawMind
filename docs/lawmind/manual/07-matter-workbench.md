# 第 7 章 案件、卷宗与工作台

前两章讲的是「系统怎么干活」，这一章讲「活干在谁身上」。案件的模型、磁盘布局、以及律师每天打开工作台看到的那一屏，都在这里。

## 7.1 先把四个概念分清

LawMind 里最容易混的是四个词。它们不是同义词，混了就会看不懂代码。

| 概念                | 代码          | 一句话                                   |
| ------------------- | ------------- | ---------------------------------------- |
| **案件**            | `matter`      | 一件委托事项。所有东西最后都挂在它身上   |
| **交办事项 / 任务** | `task`        | 律师交代的一件具体活，比如「审这份合同」 |
| **草稿**            | `draft`       | 任务产出的文稿                           |
| **交付物**          | `deliverable` | 草稿通过审核后，要对外交出去的那份东西   |

关系是这样的：一个案件下面可以有多个任务；一个任务产出一份草稿；一份草稿对应一个交付物。交付物有自己的一条生命周期（下面 7.5 讲）。

另外还有三个辅助对象：**审批**（`approval`）、**待办队列项**（`queueItem`）、**期限**（`deadline`）。它们也都挂在案件上。

谁负责改这些对象？答案很明确：**五个写服务**，在 `src/lawmind/application/services/`。每个服务只管一个对象，其他代码不许直接动文件。这条在 `matter-storage/index.ts` 的头部注释里写死了：

> 设计目标：service 层完全不直接 touch fs；所有 fs 调用集中在 storage adapter。

这个「不许绕过去」的约定有个例外，7.21 会讲。

## 7.2 律师侧：案件怎么建

建案件有三个入口：侧栏的「新建案件」对话框、对话里说「这个案子叫…」、工作台里建。底层都走同一个函数（`createMatterIfAbsent`），它是**幂等**的：同一个 id 建两次，第二次返回 `created: false`，不覆盖。

案件 id 的规则（`MATTER_ID_PATTERN`）：

```text
^[\p{L}\p{N}][\p{L}\p{N}._\- ]{1,127}$
```

说人话：字母、数字、下划线、点、短横、空格都行，中文字也行（`\p{L}` 包含汉字），首字符不能是符号，总长 2–128。明确拒绝 `..`、`/`、`\` 和空字节——这是防路径穿越。

**创建时会自动开一条待办**：`need_conflict_check`（完成利益冲突检查）。

状态上有条硬规则：只有同时传了 `conflictCheckConfirmed` 和 `engagementAccepted` 两个确认，案件状态才是 `active`；否则是 `intake`（收案）。也就是说，**利益冲突检查和委托确认没做完，案件不进入进行中状态**。

## 7.3 案件真相源：`matters/<id>/` 里到底有什么

这是全书最该记住的一张目录表。案件的一切都在这个目录下（`src/lawmind/adapters/matter-storage/`）：

```text
workspace/matters/<matterId>/
  matter.json                 # 案件主体：标题、状态、当事人、案号、法院…
  deliverables/<id>.json      # 每个交付物一个文件
  approvals.jsonl             # 审批记录（追加）
  queue.jsonl                 # 待办队列（追加 + 重写）
  deadlines.jsonl             # 期限（追加 + 重写）
  intake-brief.json           # 谈话/材料整理出的结构化摘要
  desk-writes.jsonl           # 工作台写入日志（给「撤销」用）
  ops/                        # Matter Ops 四件套
    scope.json
    plan.json
    raid.jsonl
    theory-lite.json
```

同时还有一套**人可读的投影**，在另一个目录树下：

```text
workspace/cases/<matterId>/
  CASE.md                     # 案件档案（Markdown，人看）
  MATTER_STRATEGY.md          # 案件策略
  materials/                  # 案件材料
  session-summary.md          # 会话摘要累积
  progress-archive.md         # 轮转出去的工作进展
  mail/inbox/  mail/sent/     # 邮件
  team-meeting.jsonl          # 会议室记录
  artifacts/                  # 产物
```

两套并存这件事很关键，7.4 专门讲为什么。

### 一张表看懂每个文件谁写

| 文件                     | 写入者                                     | 格式                       |
| ------------------------ | ------------------------------------------ | -------------------------- |
| `matter.json`            | `matter-write-service.ts`                  | 单个 JSON，原子替换        |
| `deliverables/<id>.json` | `deliverable-service.ts`                   | 单文件，原子替换           |
| `approvals.jsonl`        | `approval-service.ts`                      | 追加 + 条件重写            |
| `queue.jsonl`            | `queue-write-service.ts`                   | 追加 + 条件重写            |
| `deadlines.jsonl`        | `deadline-service.ts`                      | 追加 + 条件重写            |
| `CASE.md`                | `case-writes.ts`（经 `case-md-lock` 串行） | Markdown 段落追加          |
| `ops/*`                  | `matter-ops/storage.ts`                    | **裸 fs，无锁**（见 7.21） |

### 原子写与锁

`io.ts` 提供两样东西：

- `writeJsonAtomic` / `writeFileAtomicAsync`：写临时文件再 rename。这样进程崩了读者也不会看到半截 JSON。
- `withExclusiveFileLock(lockPath, fn, {timeoutMs=5000, pollMs=5, staleMs=60000})`：排他文件锁，锁文件里写 `{ pid, acquiredAt }`。超过 `staleMs`（60 秒）的锁会被接管，接管失败错误串是 `file_lock_timeout:<文件名>`。

锁文件名就是目标文件名加 `.lock`，比如 `matter.json.lock`、`queue.jsonl.lock`。

### JSONL 的容错

`readJsonl` 会**跳过坏行**。这点很实用：如果断电导致最后一行写了一半，读取不会整个崩掉，只是少那一条。

但要注意注释里的诚实说明：

> **没有 fsync**。rename 保证「进程崩溃后读者看不到半截 JSON」，但掉电不保证。
> **锁是协商性的**。绕过 `withExclusiveFileLock` 的写者不受约束。

「协商性」的意思是：锁只对愿意加锁的代码有效。仓库里恰好有一个写者不加锁，见 7.21。

## 7.4 双真相源：JSON 是对的，CASE.md 是给人看的

这里有个必须理解的设计。

**`matter.json` 是机器真相源**，字段全、结构严、有 zod 校验（`matterSchema`）。**`CASE.md` 是人读投影**，只镜像第 1 节的结构化字段。

为什么要两套？因为律师需要能直接打开看的档案，而机器需要严格的结构。硬把它们合成一个，律师看到的会是一堆校验字段，机器读 Markdown 又要写一堆正则。

投影是单向的：`matter.json` → `CASE.md`。入口是 `src/lawmind/application/matter-dual-write.ts` 的 `ensureMatterWithProjection(ws, input)`：先建 JSON，再把结构化字段写进 CASE.md。

写进去的是什么？看 `matter-projection.ts` 的标签表：

| 字段               | 中文标签（写进 CASE.md §1）                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`           | 当前阶段（`intake: 接案 / intake`、`active: 进行中`、`waiting_on_client: 等待客户`、`waiting_on_firm: 等待律所内部`、`under_review: 审核中`、`delivered: 已交付`、`closed: 已结案`） |
| `sensitivity`      | 密级（`normal: 普通保密`、`high: 高度敏感`、`restricted: 严格隔离`）                                                                                                                 |
| `clientId`         | clientId                                                                                                                                                                             |
| `causeOfAction`    | 案由                                                                                                                                                                                 |
| `counterparty`     | 对方当事人                                                                                                                                                                           |
| `matterKind`       | 工作门类                                                                                                                                                                             |
| `docket.caseNo`    | 案号                                                                                                                                                                                 |
| `docket.court`     | 法院                                                                                                                                                                                 |
| `docket.instance`  | 审级                                                                                                                                                                                 |
| `docket.standing`  | 诉讼地位                                                                                                                                                                             |
| `docket.hearingAt` | 开庭日                                                                                                                                                                               |

空的字段写占位符 `_（待补）_`。

**注意**：CASE.md 里那些叙事性的段落——核心争点、风险、工作进展——**不镜像回 JSON**。它们只存在于 Markdown。这是刻意的，一致性检查也据此不做要求。

### 漂移检查与修复

两套数据迟早会不一致。`matter-consistency.ts` 负责查，返回的问题码有 9 种：

`missing_case_md`、`missing_matter_json`、`both_missing`、`title_drift`、`status_drift`、`sensitivity_drift`、`client_drift`、`cause_drift`、`counterparty_drift`。

修复入口是 `repairMatterProjections`，它把所有有 `matter.json` 的案件重新投影一遍，返回修复数量。HTTP 上是：

```text
POST /api/matters/repair-projections
```

CLI 上也有：`pnpm lawmind:ops matter-repair-projection`。

什么时候会漂？最典型的是有人手改了 CASE.md（改标题、改案号），或者写入过程崩在了中间。有了这个检查，至少能查出来。

## 7.5 四个域对象的状态机

### 交付物的八态

`src/lawmind/core/deliverable-lifecycle.ts` 定义了交付物的生命周期：

```text
planned → drafting → pending_review → approved → rendered → delivered → learned
                                    ↘ blocked ↙
```

中文标签：已规划、起草中、待审核、已批准、已渲染、已交付、已沉淀、已阻塞。

允许的转移写死在 `DELIVERABLE_LIFECYCLE_TRANSITIONS` 里，每条还带一句英文说明，比如：

- `planned → drafting`：Start drafting
- `drafting → pending_review`：Submit for lawyer review
- `pending_review → approved`：Approve draft
- `approved → rendered`：Render deliverable
- `rendered → delivered`：Mark delivered to audience
- `delivered → learned`：Capture post-review learning
- `drafting → blocked`：Block draft
- `pending_review → blocked`：Request changes
- `blocked → drafting`：Resume drafting
- `approved → pending_review`：Reopen review
- `blocked → pending_review`：Reopen review
- `rendered → pending_review`：Reopen review

非法转移会被拒，报错格式是：

```text
invalid deliverable transition: A -> B
```

注意最后三条「重开审核」。**已经批准甚至已经渲染的东西，可以退回重审。** 现实里这很常见：客户临时改需求，签过的稿子得重新过一遍。

### 审批的四态

`pending → approved | rejected | needs_changes`。

递交是 CAS（compare-and-swap）：只有从 `pending` 才能转终态。并发时输的那一方拿到 `already_resolved`，不会重复处理。

审批记录里有个字段 `targetRole`，是从第八期开始加的，注释写着「明确委派的目标角色」。也就是说审批可以指定**由谁批**，不只是「谁来批都行」。

### 队列项的九种原因

待办队列（`queue.jsonl`）里的一条，`kind` 只能是这九个：

`need_client_input`（要客户给东西）、`need_evidence`（要证据）、`need_conflict_check`（要查冲突）、`need_lawyer_review`（要律师审）、`need_partner_approval`（要合伙人批）、`ready_to_draft`（可以开始写）、`ready_to_render`（可以出稿）、`blocked_by_deadline`（卡在期限）、`blocked_by_missing_strategy`（卡在没策略）。

优先级四档：`low`、`normal`、`high`、`critical`。优先级怎么定？看风险（`queuePriorityFromRisk`）：高风险 → `critical`，中风险 → `high`，其余 → `normal`。

队列项还有依赖：`dependsOn` 和 `blockedBy`。被挡时显示的文案是「等待前置待办：`<ids>`」。

### 期限的字段

期限（`deadlines.jsonl`）字段比较多，值得列出来：

| 字段                  | 含义                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `severity`            | `soft` / `hard` / `critical`。注意：`eventKind === "hearing"` 时默认是 `hard`                                                                    |
| `source`              | 来源：`manual`（律师手记）、`case_memory`（本案档案）、`project_file`（卷宗文件）、`calendar_import`（日历导入）、`document_extract`（传票抽取） |
| `status`              | `open` / `snoozed` / `completed` / `missed`                                                                                                      |
| `eventKind`           | `hearing`（开庭）、`filing`（提交/立案）、`limitation`（时效/期限）、`reply`（答辩/回复）、`preservation`（保全）、`custom`                      |
| `remindBeforeHours`   | 提前多少小时提醒，范围 0–720                                                                                                                     |
| `dependsOnDeadlineId` | 前置期限，只能有一个                                                                                                                             |

来源字段会翻译成律师看得懂的中文（`DEADLINE_SOURCE_LABELS`），界面上显示「律师手记」「本案档案」这类，而不是 `manual` 这种枚举。

## 7.6 工作台「今日」：一屏怎么算出来

打开工作台，首页是「今日」。它由 `src/lawmind/desk/today-work.ts` 的 `buildTodayWorkSnapshot` 算出来，四块拼在一起：

1. **律师自己写的计划**（见 7.7）
2. **待回复的邮件**（只留 `needs_reply` 和 `court` 两类）
3. **期限**（今天到期、已过期，或者开庭在 3 天内的）
4. **待我拍板的审批**

注意它的取舍：不是把所有东西堆上来，而是**只留今天该看的**。邮件里 `fyi` 和 `contract` 类的不会出现在今日，因为那两类不是「今天必须回」。

这一层是纯读，不写文件、不扫审计日志。原因是打开工作台要快。

## 7.7 每日计划：手写的，能结转

`src/lawmind/desk/daily-plan.ts` 管理律师自己写的每日计划。存 `lawmind/daily-plans/<YYYY-MM-DD>.json`，一天一个文件。

限制：一个计划最多 80 条，单条文字最多 500 字。

几个实用特性：

- **结转**：昨天没做完的会带过来。往回看 14 天（`CARRY_LOOKBACK_DAYS = 14`），最多带 8 条（`CARRY_SNAPSHOT_CAP = 8`）。
- **从来源标记完成**：`markDailyPlanSourceDone("deadline", id)` 表示「这条期限办完了，把计划里对应的那条也勾掉」。支持的来源有三种：`mail`、`deadline`、`approval`。
- **勾完成**：PATCH 一条计划项，把 `done` 置真。

HTTP 上：

```text
POST  /api/desk/plan               # 加计划（texts 1..20 条）
PATCH /api/desk/plan/items/:itemId # 勾完成
POST  /api/desk/plan/source-done   # 由来源反向勾完成
```

## 7.8 期限：链、提醒、日历

### 链

期限可以串成链：一条期限可以有一个前置（`dependsOnDeadlineId`）。这不是流程引擎，就是「A 过了才有 B」的简单关系。

有两条硬规则：

- **开庭永远不等人**。源码注释原话：`Hearings are never gated.` 开庭就是开庭，不会因为前置没完成而不显示、不提醒。
- **不许成环**。`wouldCreateDeadlineCycle` 会检查，试图把 A 的前置设成 B、B 的前置设成 A 时会被拒。

### 什么时候「释放」

一条有前置的期限，在前置完成之前是**未释放**的（`released: false`）。未释放的期限不会催你，界面上会显示「等待：<前置标题>」。

判断「这条是不是上诉/再审类不可变期间」的逻辑在 `isAppealLimitation`，正则匹配「上诉|再审|不变期间|法定期间」。

### 提醒

`src/lawmind/desk/deadline-remind.ts` 的 `processDueDeadlineReminders` 是个定时任务：在 `dueAt` 之前，往「待我拍板」风格的收件箱里放一条提醒。

提醒落到 `lawmind/automation-inbox/<id>.json`，`automationId` 是 `"deadline-remind"`。放完之后给期限打上 `remindedAt` 时间戳，避免重复提醒。

### 导出日历

`deadline-ics.ts` 生成标准的 ICS 文件。细节：

- `PRODID` 是 `-//LawMind//Desk//ZH`
- 默认日历名「LawMind 期限」
- 行折叠按 75 字符
- UID 默认是 `<deadlineId>@lawmind.local`

HTTP 上直接下载：

```text
GET /api/matters/:matterId/deadlines.ics
```

响应头带 `content-disposition: attachment; filename="<matterId>-deadlines.ics"`。

**注意它不写飞书也不写 Graph 日历**，只生成文件让你自己导入。头部注释写得很清楚。

## 7.9 从传票里读期限

这是很实用的一个功能：把传票拍张照丢进来，或者把法院短信粘进来，系统抽出开庭时间和待办。

`src/lawmind/desk/legal-event-extract.ts` 是抽取器，**纯启发式**。头部注释有一句很重要的话：

> Heuristic only — lawyer confirms before writing deadlines.

也就是说，它只提出**候选**，写进工作台之前必须律师确认。

抽取结果的置信度分三档（`high` / `medium` / `low`），每种事件的默认提前提醒时间是写死的（`defaultRemindBeforeHours`）：

| 事件类型 | 默认提前提醒 |
| -------- | ------------ |
| 开庭     | 72 小时      |
| 保全     | 168 小时     |
| 其他     | 24 小时      |

开庭和保全提前得更多，因为这两类事准备成本高。

### 三个端点

```text
POST /api/desk/events/extract       # 从文本抽（text 最多 20000 字）
POST /api/desk/events/extract-file  # 从文件抽（relPath，返回 text + events）
POST /api/desk/events/confirm       # 确认写入（一次最多 12 条）
```

`extract-file` 支持 PDF、图片、txt、docx。图片走 OCR，OCR 出不来就走视觉兜底——律师不需要配环境变量。

### 确认写入时的顺序讲究

`recordConfirmedExtractEvents` 有个细节：**先记开庭，再记其他**，而且**绝不自动把「举证期限」串到「开庭」后面**。注释原话「hearings first; never auto-chains 举证 to 开庭」。

这个「不自动串」很重要。举证期限和开庭的关系各地法院不一样，系统猜错了反而害人，所以它只登记，不猜依赖。

## 7.10 谈话与「收进本案」

场景是这样的：你跟客户谈完，把谈话记录丢给系统，希望它整理出需求、事实、案由、证据缺口，并且**把这些写进案件档案**。

### 为什么中间要有一层

直接写进档案的问题在于：谈话记录是口语的、有歧义的，抽出来的东西可能是错的。错了还写进档案，后面就都错了。

所以流程是两段：

1. **整理** → `matters/<id>/intake-brief.json`（结构化摘要，律师确认前不算档案）
2. **确认** → 写穿到 `matter.json` 与 CASE.md

摘要（`IntakeBrief`）包含：客户需求、核心事实、争点、候选案由、证据缺口、下一步、以及当事人候选。

确认动作是 `confirmIntakeBrief`，它会打上 `confirmedAt`。

### 「写穿」这件事踩过一次坑

`intake-promote.ts` 的头部注释直接引用了一次真实故障：

> 为什么需要：`apply_intake_brief` 原本只打 `confirmedAt`，谈话里读到的案由、当事人留在 `intake-brief.json` 里，而工作台卷宗看的是 `matter.json`——律师在工作台看不到自己刚刚说过的事实。Claude Code 的同类故障（issue #55750：「已落盘但模型/界面看不到」）说明这类「写了等于没写」最伤信任。

说白了：文件写了，但律师在界面上看不到，等于没写。这个坑很值钱，工程上叫「写了等于没写」。

### 写穿的三个原则

注释里列了三条，都很实在：

1. 只提升**抽取器真正读到**的值，绝不编造。
2. 只提升卷宗里**还没有**的字段，不覆盖律师手输的内容。
3. 立场不明时（原告/被告谁是委托人）只登记当事人与其诉讼地位，**不猜我方立场**。

第三条尤其重要。谈话里说「张三告了李四」，系统不知道你是张三的律师还是李四的律师，这时候它不会瞎猜，只登记双方和诉讼地位。

### 当事人抽取

`extractPartyCandidates` 靠一组标签词：

- 委托人侧：委托人、我方、客户（`CLIENT_LABELS`）
- 对方侧：对方、相对方（`COUNTERPARTY_LABELS`）
- 诉讼地位：原告、被告、上诉人、被上诉人、申请人、被申请人、甲方、乙方、用人单位、劳动者等

匹配形式是「标签：名字」，名字最长 16 字。

## 7.11 材料

案件材料放在 `cases/<matterId>/materials/`。

### 列材料

`listMatterMaterialFiles` 只做轻量列举，返回 `{relPath, fileName, size, updatedAt}`。

头部注释解释了一个刻意的取舍：

> No SHA hashing — pulse/open-dossier must stay cheap; replica publish still hashes.

也就是说，日常打开案件时不计算哈希（慢），只有案件副本同步时才计算。上限：最多列 80 个文件（`MATTER_MATERIALS_LIST_CAP`），遍历上限 4000 个（`MATTER_MATERIALS_WALK_CEILING`），单文件 50MB 以上略过（`MATTER_MATERIALS_MAX_FILE_BYTES`）。

### 在材料里搜

```text
GET /api/matters/:matterId/materials/search?q=...
```

底层是 `materials_fts`（trigram 全文索引），返回的命中带 `{relPath, page}`——**能定位到页码**。这是第五期「材料 Vault 搜索」做的能力。

### 整理三件套

材料乱了怎么办？三步：

1. `propose_organize_plan` — 起草整理计划，**先确认，不动文件**
2. `execute_organize_plan` — 执行**已确认**的计划
3. `revert_desk_write` — 不满意就撤销

整理的范围限制在 materials 围栏内，不许动别的目录。

### 跨案件搬材料

还有 `relocate_matter_materials`，专门修「材料放错案」这种错。它也可以撤销。

### 文件操作

`apply_file_ops` 能在工作区内搬移、改名、复制文件或文件夹，但**不改内容、不删除**。这是一条清晰的边界：系统只做可逆的结构调整。

## 7.12 当事人

案件当事人（`MatterParty`）的字段：`partyId`、`name`、`role`、`standing?`（诉讼地位）、`serviceAddress?`（送达地址）、`serviceMethod?`（送达方式）。

角色五种（`MATTER_PARTY_ROLE_ZH` 是中文）：`client`（委托人）、`counterparty`（对方）、`agent`（代收人）、`counsel`（对方代理）、`other`（其他）。

送达方式四种：`mail`（邮寄）、`electronic`（电子送达）、`in_person`（当面）、`unknown`（未标明）。

### 上限那个数字改过

```ts
export const MATTER_PARTIES_CAP = 32;
```

注释解释了为什么从 8 改成 32：

> 当事人上限。共同诉讼（多被告/多第三人）常超 8 人，旧值 8 会把第 9 人起静默丢弃。上限只防病态输入，不应当成为「填不全当事人」的原因。

典型的静默丢数据 bug：共同诉讼有 10 个被告，第 9、10 个被悄悄扔掉，还没人知道为什么。

## 7.13 案件门类与案由

### 门类

只有三种（`MATTER_KINDS`）：`contract`（合同）、`litigation`（诉讼）、`general`（其他）。

规则：**旧案件没有这个字段就当 `general`，绝不因此挡住建档**。判定靠正则（`LITIGATION_RE` / `CONTRACT_RE`）猜，猜不出来就是 general。

门类有什么用？它会作为意图编译的**平局裁定**参与判定（第 4 章），而且**只做平局裁定，不覆盖文件形态判定**。

### 案由词表

`src/lawmind/desk/cause-lexicon.ts` 存一份**律师自己维护的**案由词表，位置 `lawmind/cause-lexicon.json`。默认有 10 条（买卖合同纠纷、知识产权权属或侵权纠纷等）。

头部注释写得很清楚：

> Lawyer-maintained 案由词表. Not a national classifier — candidates only.

它不是全国案由分类器，只给候选。之所以让律师自己维护，是因为案由的写法各地法院有差异，硬编码的标准案由表经常对不上。

`/api/workspace/cause-lexicon` 可以读写，一次最多 80 条。

## 7.14 案件总览与驾舱

打开一个案件，看到的是「驾舱」。它的数据来自 `buildMatterPulse`（`src/lawmind/desk/matter-pulse.ts`）。

注意这个函数的设计约束：**同步、不扫审计日志**。它读任务、草稿、邮件、期限、CASE 身份，拼出一份快照。

`MatterPulse` 里比较有用的几个字段：

- `counts`：文件、任务、材料、期限、邮件、审批的各类计数
- `daysUntilHearing`：距开庭还有几天
- `timeline`：一条时间线（最多 24 条 `MATTER_TIMELINE_CAP`），事件类型有 `deadline`、`hearing`、`mail`、`document`、`task`、`approval`、`intake`
- `nextActions`：下一步做什么

开庭倒计时的文案是写死的（`hearingCountdownLabel`），四种：「未排开庭」「今天开庭」「还有 N 天开庭」「开庭已过 N 天」。

### 案件健康卡

`LawmindMatterHealthCard.tsx` 展示的是真实可解释的指标。组件注释就一句：

> 案件级健康卡片：用律师语言展示真实可解释指标，无「安全分」。

「无安全分」是有意的。第 1 章讲过，LawMind 不把某个自造的分数包装成质量证明。指标必须是能追溯到事件的。

### 会话时间线

```text
GET /api/matters/session-timeline?matterId=...&limit=40
```

`limit` 默认 40，夹在 5–100 之间。它把案件相关的会话事件按时间排出来。

## 7.15 相似案件：只做对照，不许混入

`src/lawmind/desk/similar-cases.ts` 用一个案件的案由和证据类型去旧案里找相似的。

搜索结果带着一句**强制警告**：

```text
旧案事实不得写入本案。只作案由与证据整理对照。
```

这个字段叫 `displayWarning`，界面上必须显示。为什么这么强调？因为把旧案事实混进本案是灾难性的——当事人不同、金额不同、时间不同，混了就是错案。

相似度算法在 `memory/similar-case-recall.ts`，各节权重不同：争点 2.6、风险 2.2、策略 1.6、基本信息 1.2、进度 0.9。默认取 3 条，最低分 0.15（工作台用 0.12 放宽一点，取 5 条）。

## 7.16 审查矩阵

案件里还有一张**表格审查矩阵**：行是文件、列是尽调问题。

默认七个问题（`DEFAULT_REVIEW_MATRIX_QUESTIONS`）：

| id            | 问题           | 提示                   |
| ------------- | -------------- | ---------------------- |
| `q-parties`   | 当事人与主体   | 签约方、保证人、关联方 |
| `q-term`      | 核心商业条款   | 标的、价格、期限       |
| `q-risk`      | 风险与责任     | 违约、赔偿、免责       |
| `q-ip`        | 知识产权       | 归属、许可、侵权       |
| `q-terminate` | 解除与终止     | 触发条件、后果         |
| `q-governing` | 争议解决       | 管辖、法律适用         |
| `q-misc`      | 其他需律师确认 | 未覆盖事项，请直接批注 |

每个格子可以是 `empty`、`suggested`、`verified` 三种状态。

导出 CSV 的表头是固定的：

```text
documentId,documentTitle,questionId,question,excerpt,status,citation
```

矩阵还有个对比功能（`compareMatrixExcerpts`），专门找**危险变更**，正则盯着这些词：`无限责任|全部损失|放弃|不可撤销|单方解除|自动续期`。命中就提示「危险变更：出现高风险表述」，没有命中但内容变了就提示「条款内容有变化，请人工核对」。

审查表的完整能力（包括批量抽取、编辑、导出）在第 9 章。

## 7.17 Matter Ops：范围、计划、风险台账

`src/lawmind/matter-ops/` 是项目管理那套东西，存在 `matters/<id>/ops/`：

- **范围**（`scope.json`）：基线 + 变更记录（保留最近 20 条）。变更时会自动记一条「基线更新：<旧内容前 80 字>」。
- **计划**（`plan.json`）：阶段、里程碑。
- **RAID 台账**（`raid.jsonl`）：Risk、Assumption、Issue、Decision 四类条目。读的时候取最近 40 条再倒序取 12 条展示，`openRiskCount` 数的是未关闭的风险。
- **理论**（`theory-lite.json`）：争点、依据、待决问题，还有一个 `anchored` 标记。

`matterTheoryBlocksStrictExport` 这个函数名说明了一件事：**理论没锚定，严格模式下不许导出**。这是「有理论依据才能出稿」的一条硬线。

## 7.18 团队与会议室

案件里可以配一个参与名单（`team-roster`）：

```text
GET /api/matters/team-roster?matterId=...
PUT /api/matters/team-roster   # { matterId, participantAssistantIds[], synthesizerAssistantId? }
```

会议记录在 `cases/<matterId>/team-meeting.jsonl`。没绑案件时临时会议记在 `meetings/adhoc/team-meeting.jsonl`。

上限：单条正文 48000 字（`TEAM_MEETING_MAX_LINE_TEXT`）、默认取尾部 120 条（`TEAM_MEETING_TAIL_LIMIT_DEFAULT`）、最多 240 条（`TEAM_MEETING_TAIL_LIMIT_CAP`）、单次读入 4MB 上限。

会议室纪要的开头有一句固定说明：

```text
## 案件团队会议室纪要（内部协作用，非对外法律意见）
```

「非对外法律意见」是必须的——会议室里的讨论不是给客户看的。

完整的协作能力在第 16 章。

## 7.19 HTTP 端点大表

### 案件相关

| 端点                                          | 方法      | 说明                                                       |
| --------------------------------------------- | --------- | ---------------------------------------------------------- |
| `/api/matters`                                | GET       | 列案件 id                                                  |
| `/api/matters/create`                         | POST      | 建案件                                                     |
| `/api/matters/detail`                         | GET       | 案件详情（大包，含任务、草稿、审批、队列、审计最近 80 条） |
| `/api/matters/overviews`                      | GET       | 全部案件总览                                               |
| `/api/matters/search`                         | GET       | 案件内搜索（最多 60 条命中）                               |
| `/api/matters/profile`                        | POST      | 改卷宗字段                                                 |
| `/api/matters/display-name`                   | POST      | 改展示名（≤200 字）                                        |
| `/api/matters/role`                           | GET/POST  | 案件/文件夹角色                                            |
| `/api/matters/delete`                         | POST      | 删案件目录                                                 |
| `/api/matters/case-note`                      | POST      | 写给 CASE.md 某个小节                                      |
| `/api/matters/interaction`                    | POST      | 记律师动作（进审计）                                       |
| `/api/matters/interaction-rollup`             | GET       | 跨案件动作汇总                                             |
| `/api/matters/repair-projections`             | POST      | 修投影漂移                                                 |
| `/api/matters/review-matrix`                  | GET       | 审查矩阵                                                   |
| `/api/matters/review-matrix/export`           | GET       | 导出 CSV                                                   |
| `/api/matters/session-timeline`               | GET       | 会话时间线                                                 |
| `/api/matters/team-roster`                    | GET/PUT   | 团队名单                                                   |
| `/api/matters/team-meeting`                   | GET       | 会议记录（`limit` / `skipFromEnd`）                        |
| `/api/matters/:matterId/ops`                  | GET/PATCH | Ops 四件套                                                 |
| `/api/matters/:matterId/theory`               | GET/PUT   | 理论                                                       |
| `/api/matters/:matterId/pulse`                | GET       | 案件快照                                                   |
| `/api/matters/:matterId/materials/search`     | GET       | 材料检索                                                   |
| `/api/matters/:matterId/precedents`           | GET       | 先例库                                                     |
| `/api/matters/:matterId/similar-cases`        | GET       | 相似案件                                                   |
| `/api/matters/:matterId/cause`                | POST      | 写案由                                                     |
| `/api/matters/:matterId/intake-brief`         | GET/POST  | 谈话摘要（POST 用于整理）                                  |
| `/api/matters/:matterId/intake-brief/confirm` | POST      | 确认摘要并写穿                                             |

### 工作台相关

| 端点                                           | 方法     | 说明                  |
| ---------------------------------------------- | -------- | --------------------- |
| `/api/desk/today`                              | GET      | 今日一屏              |
| `/api/desk/matters`                            | GET      | 按门类列案件          |
| `/api/desk/plan`                               | POST     | 加计划                |
| `/api/desk/plan/items/:itemId`                 | PATCH    | 勾完成                |
| `/api/desk/plan/source-done`                   | POST     | 由来源勾完成          |
| `/api/desk/events/extract`                     | POST     | 抽事件                |
| `/api/desk/events/extract-file`                | POST     | 从文件抽              |
| `/api/desk/events/confirm`                     | POST     | 确认写入期限          |
| `/api/desk/standards/match`                    | POST     | 匹配办案标准          |
| `/api/desk/replica-feed`                       | GET      | 副本动态（Firm 门控） |
| `/api/matters/:matterId/deadlines`             | GET/POST | 期限                  |
| `/api/matters/:matterId/deadlines.ics`         | GET      | 导出日历              |
| `/api/matters/:matterId/deadlines/:deadlineId` | PATCH    | 改期限（完成/稍后）   |
| `/api/workspace/standards`                     | GET/POST | 办案标准              |
| `/api/workspace/cause-lexicon`                 | GET/POST | 案由词表              |

## 7.20 关键文件

| 关注点                     | 文件                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 案件存储（schema/IO/路径） | `src/lawmind/adapters/matter-storage/`（`schema.ts`、`schemas.ts`、`io.ts`、`paths.ts`、`index.ts`）                                                                                                                                                                                                                                                                   |
| 五个写服务                 | `src/lawmind/application/services/matter-write-service.ts`、`deliverable-service.ts`、`approval-service.ts`、`deadline-service.ts`、`queue-write-service.ts`                                                                                                                                                                                                           |
| 读服务                     | `src/lawmind/application/services/matter-service.ts`、`queue-service.ts`                                                                                                                                                                                                                                                                                               |
| 投影与一致性               | `src/lawmind/application/matter-projection.ts`、`matter-dual-write.ts`、`matter-consistency.ts`、`task-draft-consistency.ts`                                                                                                                                                                                                                                           |
| 域对象定义                 | `src/lawmind/core/contracts.ts`、`deliverable-lifecycle.ts`、`role.ts`、`derive.ts`                                                                                                                                                                                                                                                                                    |
| 案件索引                   | `src/lawmind/cases/index.ts`、`matter-create.ts`、`matter-id.ts`、`team-meeting.ts`                                                                                                                                                                                                                                                                                    |
| 工作台                     | `src/lawmind/desk/today-work.ts`、`daily-plan.ts`、`deadline-chain.ts`、`deadline-remind.ts`、`deadline-ics.ts`、`matter-pulse.ts`、`matter-materials.ts`、`matter-parties.ts`、`matter-kind.ts`、`similar-cases.ts`、`legal-event-extract.ts`、`mail-triage.ts`、`intake-brief.ts`、`intake-promote.ts`、`desk-apply.ts`、`desk-write-journal.ts`、`cause-lexicon.ts` |
| 审查矩阵                   | `src/lawmind/matter/review-matrix.ts`、`review-matrix-compare.ts`                                                                                                                                                                                                                                                                                                      |
| Ops                        | `src/lawmind/matter-ops/types.ts`、`storage.ts`                                                                                                                                                                                                                                                                                                                        |
| HTTP                       | `apps/lawmind-desktop/server/lawmind-server-route-matters.ts`、`-lawyer-desk.ts`                                                                                                                                                                                                                                                                                       |
| 桌面 UI                    | `apps/lawmind-desktop/src/renderer/matter/`（共 58 个文件）、`stores/matter-overview-view-store.ts`                                                                                                                                                                                                                                                                    |
| 演示数据                   | `src/lawmind/desk/seed-sample-desk.ts`（两个示例案件：`xinghui-sale-876`、`xinghui-nda-2026`，加一个已结案的 `lianhua-sale-2022`）                                                                                                                                                                                                                                     |

## 7.21 已知坑

- **`matter-ops/storage.ts` 绕过写协议。** 它用裸的 `fs.writeFileSync` / `appendFileSync`，没有排他锁、没有 tmp+rename、没有 zod。这是 `matters/<id>/` 下唯一不遵守 `adapters/matter-storage` 协议的写者。工程研究笔记里把它列为「目前最明显的一处双标准」。
- **锁是协商性的。** 上面那个写者就是活例子：它不受锁约束，别人加锁也管不住它。
- **交付物的终态审核印记不许被覆盖。** 代码里有一段注释：一旦交付物上有 `approved` 或 `rejected` 印记，后续生命周期转移不能因为草稿里 `reviewStatus` 漂了就把印记冲掉。
- **批准之后又改了正文，审核要重开。** 否则界面会出现「已批准但正文是未审文字」这种自相矛盾的状态。
- **CASE.md 的叙事小节不回写 JSON。** 所以不要指望「改了 CASE.md 的争点，JSON 里也有」——一致性检查也不查这些。
- **材料列表不算哈希。** 想校验材料是否被改过，得走案件副本那条路。
- **当事人上限 32，不是无限。** 超过会被截。真需要更多，改 `MATTER_PARTIES_CAP` 而不是绕过校验。
- **开庭期限不参与释放判断。** 有前置未完成的期限不催办，但开庭照常提醒，这条别改。
