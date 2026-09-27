# 第 69 章 实现精读：平台层（自动办件、守护进程、在办、改稿）

第 68 章讲了平台层的契约与门禁。这一章讲另一半 17 个文件，分四块：

```text
自动办件    6 个文件（定义、执行、路径、运行历史、派单台账、从办件转来）
守护进程    3 个文件（状态、监督决策、日志）
在办汇总    2 个文件（形状、装配）
Word 改稿   6 个文件（五个 `word-revision-*` + 出网判定）
```

## 69.1 自动办件：一条记录与六个确认

`lawyer-automations.ts` 是这一层最大的文件（1187 行）。

### 头注释两句话定位

```text
Lawyer Automations — recurring scheduled tasks (Cursor Automations analogue).
Persist under `lawmind/automations/`; results queue under `lawmind/automation-inbox/`.
```

**「Cursor Automations analogue」**——直说了对标什么。而两句话把「定义放哪、结果放哪」都给了。

### 那条记录有二十一个字段

```text
id  title  enabled  presetId  templateId?  matterId
instruction?  schedule  nextRunAt
lastRunAt?  lastJobId?  lastResultSummary?  lastErrorCode?  lastErrorMessage?
expectedResult?  approvalBoundary?  missingDataPolicy?  notifyPolicy?
allowSendEmailAfterApproval  notifyEmail?
createdAt  updatedAt
```

**「最后一次」有四个字段**（`lastRunAt` / `lastJobId` / `lastResultSummary` / `lastErrorCode` + `lastErrorMessage`）——**因为这是覆盖式的**：只留最近一次。

而第 69.4 节的运行历史就是为了补这个缺口。

### 六个确认项：四项持久化 + 两项已有字段

代码里有行注释：

```text
// ── 六确认里需要持久化的四项（标题是第五项、计划是第六项，各有既有字段）──
```

所以六个确认项的构成是：

| #   | 确认项           | 落在哪个字段        |
| --- | ---------------- | ------------------- |
| 1   | 期望结果         | `expectedResult`    |
| 2   | 审批边界         | `approvalBoundary`  |
| 3   | 资料缺失时怎么办 | `missingDataPolicy` |
| 4   | 什么时候通知     | `notifyPolicy`      |
| 5   | 标题             | `title`             |
| 6   | 计划             | `schedule`          |

另有 `lastQuietKey`：同一批来信或同一份已被门禁拦住的附件，不再每个周期重推收件箱。

**前四项各有一个专门字段，后两项复用了已有字段**——这就是那句注释的意思。

而四项的中文标签是代码原文：

```ts
const CONFIRMATION_LABELS = {
  expectedResult: "期望结果",
  approvalBoundary: "审批边界",
  missingDataPolicy: "资料缺失时怎么办",
  notifyPolicy: "什么时候通知",
};
```

**四个标签都是问句或短语，不是名词**：「资料缺失时怎么办」、「什么时候通知」——**这是问律师的原话**。

每个字段还有一行注释说明它到底问什么：

```text
/** 交付什么才算办完。 */
expectedResult
/** 哪些动作必须停下来问律师（外发、改原稿等）。 */
approvalBoundary
/** 源数据缺失时怎么办（缺字段时按 report_partial 读）。 */
missingDataPolicy
/** 什么时候才打扰律师（缺省 always，保持老行为）。 */
notifyPolicy
```

**`expectedResult` 那条注释特别值得看**：**「交付什么才算办完」**。这不是「期望结果」这个名词的解释，而是**它的判定标准**——所以律师填的内容会被当成完成判据用。

而 `notifyPolicy` 的「缺省 always，保持老行为」说明了默认值的方向：**新增策略默认保持旧行为**。

### 缺确认时的那句拒绝

```text
请先交代清楚：<缺的项用「、」连起来>。
```

**「请先交代清楚」**——像人说话，不像系统报错。

### 四种计划、五种策略枚举

**计划**：

```text
daily     { hour, minute }
weekly    { weekday, hour, minute }
once      { runAt }
interval  { everyMinutes }
```

`interval` 有注释：`/** Recurring poll: every N minutes (clamped 5…10080). */`

**上下限是 5 分钟到 10080 分钟**（正好一周）。而夹取函数的兜底是 30 分钟（非有限值时）。

**资料缺失策略**（`missingDataPolicy`）：

```text
report_failure   报失败
report_partial   报部分（默认）
skip_run         跳过不跑
```

**通知策略**（`notifyPolicy`）：

```text
always        总是（默认）
on_problem    只在出问题时
never         从不
```

而这三个值会经过一个映射变成处置动作（`MissingDataDisposition`）：

```text
proceed        照办
fail_run       判失败
skip_quietly   安静跳过
```

**「安静跳过」**——那三个词很准：`skip_run` → `skip_quietly`，**不吵律师**。

### 收件箱的六种状态

```text
open               待处理
acknowledged       已知悉
approved_send      已批准发送
sent_remote        远程发送成功
approved_local_only 已批准但只落了本地
dismissed          已忽略
```

**第三、四、五种是一条链上的三站**（批准 → 发出去了 / 没发出去）。第 65.4 节讲过 `approved_local_only` 这个专门状态为什么存在。

### 五个预设

| id                     | 标题             | 计划              | 模板                    | 需要邮件 | 允许外发 |
| ---------------------- | ---------------- | ----------------- | ----------------------- | -------- | -------- |
| `renewal-monitor`      | 合同续签盯梢     | weekly 周一 09:00 | `renewal-monitor`       | —        | 否       |
| `client-weekly-update` | 客户进展周报     | weekly 周一 10:00 | `client-update-memo`    | —        | **是**   |
| `mail-inbox-digest`    | 邮箱收件整理     | interval 30       | —                       | **是**   | 否       |
| `mail-contract-review` | 邮件合同审阅改稿 | interval 30       | `mail-contract-redline` | **是**   | 否       |
| `custom`               | 自定义交办       | daily 09:00       | —                       | —        | 否       |

**两个周报都是周一早上**（9 点与 10 点错开一小时）——**这是刻意的，避免同一时刻两个都跑**。

**只有 `client-weekly-update` 允许外发**——因为周报的目的就是发给客户。其余四个都是内部产出。

### 落盘路径：五处

```text
<工作区>/lawmind/automations/<id>.json               定义（+ .json.lock）
<工作区>/lawmind/automation-inbox/<itemId>.json      收件箱（+ .lock）
<工作区>/lawmind/automations/<id>/runs/…             运行历史
<工作区>/cases/<案>/mail/inbox                       案件邮件——收
<工作区>/cases/<案>/mail/sent                        案件邮件——已发
<工作区>/cases/<案>/mail/outbox                      案件邮件——待发
<工作区>/cases/<案>/mail/attachments/<名>            附件
```

**邮件按案件分目录**，而且 inbox / sent / outbox 三态分开——**所以「待发」是一个真实存在的目录，不是一个内存状态**。

而写入用的是 `writeJsonAtomic` + `withExclusiveFileLock`（第 57 章那两把锁）。

### 邮件正文里的两个上限

```text
buildMailBlocksForRefs：消息最多 5 封、正文各截 600 字
buildMailDigestSummary：消息最多 12 封
```

**两个数不一样**：拼给模型的引用只取 5 封（要省上下文），而摘要列表可以取 12 封（那是给律师看的清单）。

### 那几条「没找到」的话

```text
未发现带合同附件的邮件。请确认对方已发来 PDF/Word/图片等文件，或到「交办 → 邮箱配置」重新同步。
发现 N 个附件，但无一为可审阅合同格式（Word/PDF/图片等）：
请对方提供 .docx / .doc / .pdf 或清晰扫描件图片，或在对话中手动交办审查。
本期邮箱匣无新邮件。请在「交办 → 邮箱配置」连接真实邮箱并点「立即同步」。
```

**三条都是「为什么没有 + 怎么办」**：

| 情况             | 为什么     | 怎么办                      |
| ---------------- | ---------- | --------------------------- |
| 没有合同附件     | 对方没发来 | 去同步邮箱                  |
| 有附件但格式不行 | 格式不对   | 请对方给可读格式 / 手动交办 |
| 没有新邮件       | 没连邮箱   | 去连邮箱并同步              |

**第二条把「哪些格式能审」列出来了**——所以律师知道该要什么。

### 三条模式说明

```text
将启动「邮件合同审阅改稿」工作流（最小修改 + 原文件审阅痕迹）。
将启动「邮件合同审阅」工作流（意见书级审查；原件非 Word，不做审阅痕迹）。
完成后请在文书台签批；批准发送前不会对外发信。
```

**前两条的差别在于「原件是不是 Word」**——是 Word 就出审阅痕迹，不是就只出意见书。**这是个很实在的降级**（第 8 章讲过）。

而第三条把责任链说清了：**签批在文书台、发信前还要批准**。

## 69.2 一次 tick 跑什么

`lawyer-automations-runner.ts` 523 行。头注释一句话：

```text
Due-automation tick: enqueue workflows, digest mail, push results to automation inbox.
```

**三件事**：入队工作流、整理邮件、把结果推到收件箱。

### 七步

```text
① listAutomations → 筛 enabled 且 nextRunAt <= now
② 逐个 claimDueAutomation（抢不到就跳过）
③ 记 startedAt
④ try runOneAutomation
⑤ 成功 → 读回记录，记一条 status=outcome.status 的运行历史
⑥ 失败 → 重写 lastResultSummary / lastError*，nextRunAt 推到 1 小时后
         发审计 automation.run_failed
         按通知策略决定要不要推收件箱
         记一条 status=failed 的运行历史
⑦ 返回处理了几条
```

**第 ② 步的「抢不到就跳过」**是并发保护——因为桌面与守护进程可能同时在 tick。

**第 ⑥ 步那句「推到 1 小时后」**（`computeNextRunAt(failed.schedule, now + 3_600_000)`）——**失败不立刻重试**，而是等一小时。这是很实际的取舍：立刻重试多半还是失败。

### 五条错误码与它们的处理

```text
missing_api_key          模型没配
mail_sync_failed         邮件同步失败
workflow_enqueue_failed  入队失败
model_network_error      模型网络错误
automation_run_failed    其他
```

而失败时写进记录的那句话：

```text
运行失败（<错误码>）：<错误消息前 200 字>
```

**码在前、消息在后**——所以律师能看出是哪一类失败。

### 防重复派单：那条真实事故

`automation-dispatch-ledger.ts` 的头注释把事故写清了：

```text
背景（真实事故）：`邮件合同审阅改稿` 每 120 分钟派一次同一份附件；那一件已被
独立审稿门禁停在 `guardian_exhausted`，于是同一份材料被反复重派、反复撞同一道门禁。

规则（Codex 对齐「不要重跑注定失败的同一件事」）：
- 派单前按 **matter + 附件相对路径 + 内容指纹** 记账；
- 同一指纹上次派单已因门禁停下（`blocked`）→ 不再重复派，只更新交办摘要；
```

**这是一条完整的因果链**：每 120 分钟派一次 × 上次被门禁停下 = **无限重试同一件注定失败的事**。

而修法的三个键是**「案件 + 附件相对路径 + 内容指纹」**——三个一起才构成一条账。**加了内容指纹是为了「材料更新了就恢复派单」**。

### 指纹算法

```text
sha256(文件内容)
只在 stat.size > 0 && stat.size <= 4 MiB 时读内容
摘要截前 16 位
```

**两个条件**：空文件不算（没有内容可指纹）、超大文件也不读（超过 4 MiB 就不算指纹）。

**所以超大附件的指纹是什么？** 这里要诚实说一句：那种情况下指纹退化（拿不到内容）。**这是已知的取舍**，不是漏写。

### 台账的形状与两条上限

```text
<工作区>/lawmind/automation-dispatch-ledger.json（+ .lock）
{ 条目: { state: "dispatched" | "blocked", relativePath, fingerprint, reason, ... } }
最多 200 条（超了从最老的裁）
reason 截 500 字
```

**只有两个状态**：派过了 / 被拦了。

### 那条给律师的说明

```text
同一份材料上次已被门禁停下，本次不再重复派单（避免反复撞同一道门禁）：
- 基线：`<路径>`
- 上次停因：<原因>

材料内容有更新、或已在对话里让我继续本件后，会自动恢复派单。
```

**四段**：结论（不重复派）、两个证据（哪份材料、为什么停）、**恢复条件**。

最后那句是这类功能最要紧的一句——**不告诉律师「怎么恢复」，他就会以为坏了**。

### 从哪里读出基线路径

三个正则：

```text
/contract_edit_baseline_path\s*=\s*`([^`]+)`/
/默认\s*Word\s*基线[：:]\s*`([^`]+)`/
/默认分析附件[：:]\s*`([^`]+)`/
```

**三个都是「指令里那行反引号路径」**——因为台账要知道「这次派的是哪份材料」，就得从拼出来的指令里把路径抠回来。

### 收件箱的三条推送话

```text
<标题>：<mailUnavailable>，按你设定的规矩没有继续办。
<标题> · 没能办成
交办补充：
```

**第二条那个「· 没能办成」**——**这是给标题加后缀**，所以收件箱列表里一眼能看出是坏消息。

而第三条「交办补充：」是把律师原话引回来。

### 那条「本地未挂载钩子」的诚实提示

```text
（本地未挂载工作流入队钩子，仅生成附件路径清单。）
```

**「仅生成附件路径清单」**——明说这次什么也没干成，只列了路径。

## 69.3 一个小文件与它的存在理由

`automation-paths.ts` 只有 **41 行**，但它有头注释解释自己为什么存在：

```text
常设工作（自动办件）的落盘路径与 id 安全校验。

单独成模块的原因：`lawyer-automations.ts`（定义）与 `automation-run-history.ts`
（运行历史）都需要这些路径，而两者互相 import 会形成环。路径是叶子依赖，
放在这里让两边都只向下依赖。
```

**「两者互相 import 会形成环」**——这是一个纯粹的架构理由。而解法是「把共同依赖抽成叶子模块」——**这个仓库里反复出现的手法**（第 68.7 节的 `content-trust.ts`、第 68.18 节的 `capability-patterns.ts` 都是同一个思路）。

**41 行里做的事**：三个子目录常量（`automations` / `automation-inbox` / `runs`）、四个路径函数、一个 id 校验。

id 校验的正则：`/^[a-zA-Z0-9_-]{1,128}$/`，拒绝话是 `` `unsafe_automation_id:${前 32 字}` ``。

**注意它是「安全字符白名单」而且把不安全的值拼进错误里（截断到 32 字）**——这样报错能定位，又不至于把整段乱输入吐出来。

## 69.4 运行历史：为什么需要它

`automation-run-history.ts` 269 行。它的头注释是一段很好的「为什么」：

```text
背景：此前每个自动办件只有 `lastRunAt / lastResultSummary / lastError*` —— **最后一次覆盖式**。
后果是律师只看到「上次成功」或「上次失败」，看不出「过去 20 次里有 3 次缺数据」，
而「这个常设工作到底靠不靠得住」正是决定要不要信它的唯一依据。
```

**「这个常设工作到底靠不靠得住，正是决定要不要信它的唯一依据」**——这句话是整段的重点。**一次失败不值钱，失败频率才值钱。**

而条目数参照了一份评审文档（`docs/LAWMIND-GROK-BOT-BORROW-REVIEW.md` C5）。

### 结构

```text
保留最近 20 次（AUTOMATION_RUN_RETENTION）
文件名：<ISO 时间戳，冒号点都换成横杠>__<runId>.json
路径：lawmind/automations/<id>/runs/
```

**「文件按时间戳命名，天然的检索顺序」**（注释原话）——所以列目录加排序就是时间序，**不需要读每个文件的时间字段**。

### 一条记录的字段

```text
runId  automationId  trigger  status  startedAt  finishedAt
summary?  errorCode?  errorMessage?  jobId?  missingData?  notified?
```

而 `trigger` 四种：`schedule` / `manual` / `test` / `event`（本机事件：本案文件名、新来信发件人或标题、本机 webhook 文本），`status` 四种：`ok` / `failed` / `skipped` / `blocked`。

事件触发的三件套：`automation-event-trigger.ts`（校验：只认 `matter_files` / `mail` / `webhook` 三处来源，子串匹配，「全部 / 每条 / `*`」无界条件直接拒绝，间隔夹在 15 分钟到 24 小时）、`automation-event-scan.ts`（读本机三源看条件是否出现，不发网络请求——webhook 只读投到工作区里的一个 json）、`automation-source-gap.ts`（开跑前各预设自己的「源在不在」：卷宗不在算缺源，卷宗在只是还没到期合同算诚实空结果）。桌面与 lawmindd 可能同时扫到同一事件，先领到文件锁的写 `lastEventFiredAt`，后拿到的复验间隔后让位，不会双发。

### 那个「记录的是事实」的注释

`recordScheduledRun` 上面：

```text
落一条「计划触发」的运行记录。

记录的是**发生的事实**（收件箱里真有没有多一条），不是策略意图——
```

**「发生的事实，不是策略意图」**——所以 `notified` 字段记的是「收件箱真的多了」而不是「按策略应该通知」。

### 「能不能升格成常设」的判定

```text
AUTOMATION_PROMOTION_MIN_RUNS = 3
```

**至少跑过 3 次**才有依据。而判定结果有四条话：

```text
还需要再成功跑 <N> 次才有依据。
最近 3 次里有 <N> 次失败。
最近 3 次里有 <N> 次遇到资料缺失。
最近 <used> 次连续办成<coverage>。
```

**前三条是「还不行」，第四条是「可以了」**。而前三条都是在**说清缺什么**，不是笼统说「样本不足」。

最后那条还带一句括注：

```text
（依据最近 <used> 次，共 <N> 次记录）
```

**「依据最近 3 次，共 20 次记录」**——把「拿几个算的」和「一共存了几个」都报出来。**这是很诚实的一句话**：律师能看出结论只用了最近 3 次。

## 69.5 从「办完的活」变成「常设工作」

`automation-from-work.ts` 只有 86 行，头注释两句：

```text
Persist a completed 办件 as a scheduled LawyerAutomation.
Does not record screens or share logins — instruction + capability lock only.
```

**「不录屏、不共享登录」**——这句是**产品姿态声明**：把它存成常设工作，靠的是「指令 + 能力锁」，不是「记住你屏幕上做了什么」。

### 三个推导

```text
① capabilityId = work.capabilityId ?? 从 goal+title 解析能力锁
② inferred    = inferAutomationFromInstruction(goal || title)
③ presetId    = presetFromCapability(capabilityId) ?? inferred.presetId
```

**③ 的优先级**：**能力锁优先于文本推导**——因为能力是结构化的，文本是猜的。

而标题的拼法：

```text
例行 · <work.title 或 桌面项标签 或 推导标题>     截 80 字
```

**「例行 · 」这个前缀**——所以侧栏里一眼能看出哪些是常设工作。

默认计划是：

```text
weekly 周一 09:00
```

**与 `renewal-monitor` 预设同一个时间**——因为「从办完的活变成常设」多半就是这类定期盯梢。

### 那条唯一的拒绝

```text
work_missing_matter
```

**没有案件就不许存成常设**——因为自动办件要按案件跑（第 65.10 节的 `works_sits` 那条拒绝是同一个道理）。

## 69.6 守护进程：四件套

`lawmind-daemon.ts` 498 行。头注释有三个层次。

### 第一层：定位

```text
Local lawmindd — keep automations ticking after the desktop window closes.
One workspace, one pid file. Not a cloud VM.
```

**「Not a cloud VM」**——这句话也很重要。它说的是：这个后台进程**跑在你自己的电脑上**，不是一个云服务。**在一个以「数据不出本机」为卖点的产品里，这句话必须在最显眼的地方。**

### 第二层：四件套

```text
「可信后台」的四件套：
- **心跳**：`heartbeatAt` 每 tick 刷新，读侧给出 `heartbeatStale`，
  让「进程还在但循环卡死」与「进程没了」可区分。
- **退出记录**：崩溃/被杀之后留下 `lastExitClass`，桌面重开时如实告诉律师。
- **重启计数 / 放弃**：监督进程连续失败后停止重试，并把这件事写进状态，
```

**第一条那个区分是关键**：「进程还在但卡死」与「进程没了」是两种不同的故障。**只查 pid 存活是分不出来的**（卡死的进程 pid 还在）。

**解法是心跳**：每 tick 刷一次时间戳，读侧算「多久没跳了」。

### 心跳的两个数

```text
DAEMON_TICK_INTERVAL_MS   = 30_000    （30 秒一跳）
DAEMON_HEARTBEAT_STALE_MS = 30_000 × 3 = 90_000   （90 秒算陈旧）
```

那个注释写明了为什么取 3：

```text
心跳过期阈值：3 个 tick。取 3 而不是 1，是为了容忍一次慢 tick
```

**「容忍一次慢 tick」**——取 1 会误报（系统稍忙就超），取 3 给了两次容错。

而 `isHeartbeatStale` 在**没有心跳记录时返回不陈旧**——**初次启动不该被判死**。

`heartbeatAgeMs` 还有一处防御：**时钟回拨时钳到 0**（否则会算出负数年龄）。

### 四个文件

```text
<工作区>/lawmind/daemon.json      状态
<工作区>/lawmind/daemon.pid       pid（内容是 `<pid>\n`）
<工作区>/lawmind/daemon.lock      单实例锁（内容是 `{pid, at}` + 换行）
```

### 锁的取得：四次尝试两种结果

```text
① 用 flag: "wx" 写锁文件（独占创建）
② EEXIST → 读持锁者的 pid
   持锁者存在且不是自己且还活着 → { acquired: false, reason: "held", heldBy: <pid> }
   是残留锁或自己的 → 删掉重试一次
③ 其他错误码 → reason: "io_error"
```

**「粘锁自愈」**（第 57.3 节讲过）：进程被强杀会留下锁文件，所以要看「持锁者还活着吗」。

而 `releaseDaemonLock` **只在持锁者是空或自己时才删**——**不许删别人的锁**（与第 67.5 节那个凭据文件的 `instanceId` 比对是同一个原则）。

### 给律师的状态话

```text
期间后台办件中断过 <N> 次，已自动重启。
后台办件还开着，但已经超过一分钟没有动静，可能卡住了。
```

**第二条是「心跳陈旧」的界面话**——**「还开着，但可能卡住了」**。这句话把「pid 在、心跳停」这个技术状态翻成了律师能懂的描述。

而三个标题：

```text
后台办件已停止重试
后台办件可能卡住了
后台办件中断过，已自动恢复
```

**三个都是完整的短句，都含「后台办件」这个主语**——所以律师在通知里一眼知道说的是什么。

### 退出码的解析

```text
/（?:exit_code|code）=(-?\d+)/
```

**两种写法都认**（`exit_code=` 与 `code=`）——因为日志里两种都出现过。

### 环境变量的两张名单

**继承宿主变量**（15 项，与第 68.17 节那张一样）：

```text
PATH HOME TMPDIR TEMP TMP LANG LC_ALL NODE_PATH
（加上第 68.17 节那 7 项 Windows/账户相关的）
```

**拒绝七项凭据类**（与第 63.12 节那张一样）：

```text
LAWMIND_LOCAL_API_TOKEN
LAWMIND_SKIP_API_AUTH
LAWMIND_DESKTOP_PORT
LAWMIND_LOCAL_API_INSTALLATION_SECRET
LAWMIND_LOCAL_API_EPOCH
LAWMIND_LOCAL_API_REVOKED_CLIENTS
LAWMIND_LOCAL_API_INSTANCE_ID
```

**同一张名单在这个仓库里出现了三次**（`platform/lawmind-daemon.ts`、`server/lawmind-daemon-supervisor.ts`、`electron/local-server.mjs`）。第 63.12 节提过这件事，`buildDaemonProcessEnv` 上面那行注释就说了：

```text
/** Keep in sync with `buildDaemonProcessEnv` in `src/lawmind/platform/lawmind-daemon.ts`. */
```

**「Keep in sync」**——所以这是第 39 章那条「两处实现」的第三例。

而**传给守护进程**的是：宿主 `PATH` / `HOME` 等 + `LAWMIND_*` 与 `BRAVE_*` 前缀（联网检索与模型调用靠它们）+ `LAWMIND_WORKSPACE_DIR` / `LAWMIND_ENV_FILE` / `LAWMIND_REPO_ROOT` + 两把本地密钥 + `LAWMIND_DAEMON=1`；监督模式还要删 `LAWMIND_DAEMON` 并设 `LAWMIND_DAEMON_SUPERVISOR=1`。

spawn 统一走 `safeCommand`（`platform/safe-command.ts`）：子进程**不继承父 env**；加载器钩子（`LD_PRELOAD` / `DYLD_*` / `NODE_OPTIONS` 等）与凭据根即使在显式 env 里也会被剥掉——`buildDaemonProcessEnv` 的显式 env 是一方调用方的刻意授予，所以 `LAWMIND_*` / `BRAVE_*` 保留，只剥凭据根与加载器钩子。

## 69.7 监督决策：一个纯函数回答三个问题

`lawmind-daemon-supervision.ts` 139 行。头注释解释了它的分工：

```text
本模块只负责**判断**：这次退出算不算意外、该不该重启、退避多久、什么时候放弃。
真正 fork 子进程的副作用在 `apps/lawmind-desktop/server/lawmind-local-server.ts`。
```

**「只负责判断」**——所以它是纯函数，可以精确断言「重启了几次、第几次之后放弃」。

### 四种退出分类

```text
stopped     主动停止（intentional 或 SIGTERM/SIGINT）
clean       退出码 0
killed      被其他信号杀
crashed     其他非零退出
```

**顺序是不可以换的**：先判 `intentional`，再判两个信号，再判码 0，最后才是崩溃。

### 三种决策

```text
none       不重启
restart    重启（带延迟）
give_up    放弃
```

而 `none` 有**两个不同的原因**：

```text
intentional_stop    主动停的
clean_exit          自己正常收工
```

**这两个要分开**，因为给律师的话不一样：

```text
后台办件已正常停止。
后台办件自己收工了。
```

**「自己收工了」**——这个说法很有意思：没有活干了所以退出，是正常的。

而 `give_up` 的原因格式：

```text
restart_limit_reached:<已尝试次数 - 1>
```

**减一是为了让人读到「试了几次」而不是「第几次」**——第 5 次尝试失败后放弃，原因是 `restart_limit_reached:4`。

### 三个数

```text
baseDelayMs  500
factor       2
maxDelayMs   30000
maxAttempts  5
```

退避是 500ms → 1s → 2s → 4s → 8s（封顶 30 秒）。

### 四条给律师的话

```text
后台办件已正常停止。
后台办件自己收工了。
后台办件被这台电脑强制结束（常见于系统休眠或内存不足），已自动重启。
后台办件意外中断（退出码 <码>），已自动重启。
后台办件意外中断，已自动重启。
```

**第三条那句括注非常实用**：**「常见于系统休眠或内存不足」**——它把「被信号杀」这个技术事件翻译成两种律师熟悉的情况（合上笔记本、机器卡了）。**这样律师就不会以为程序有 bug。**

而放弃时那条：

```text
后台办件连续失败 <N> 次后已停止重试。这段时间的自动办件没有运行，
请打开桌面查看日志后再决定是否继续。
```

**「这段时间的自动办件没有运行」**——它明确说出了业务后果。**「已停止重试」是技术描述，「这段时间没办事」才是律师关心的。**

## 69.8 守护进程的日志

`lawmind-daemon-log.ts` 140 行。头注释是一段三点的设计取舍：

```text
设计取舍：
- **单世代轮转**（`daemon.log` → `daemon.log.1`），只为把磁盘占用封顶；
  不做多世代，因为这份日志的用途是「律师重开桌面时，看得出你走后发生了什么」，
  不是长期归档（长期归档走 `audit/`，且 `GOALS.md` 明确不把记录当产品价值）。
- 追加写用 `flag: "a"`，POSIX 下小写入是原子的；监督进程与子进程可同时写。
- 读侧只提供 tail，因为消费方只需要「最近发生了什么」。
```

**三点分别回答「轮转几代」「为什么不用锁」「为什么只给 tail」**。

第一点那句**「GOALS.md 明确不把记录当产品价值」**尤其要紧——它把「不做多世代」这个决定**追到了产品定位**，而不是「够用了」。

### 日志的三个数

```text
DAEMON_LOG_FILE          daemon.log
DAEMON_LOG_ROTATED_FILE  daemon.log.1
DAEMON_LOG_MAX_BYTES     1_048_576（1 MiB）
tail 默认                 200 行
```

**单世代轮转意味着磁盘占用上限是 2 MiB**（正本 + 备份各 1 MiB）。**这就是「把磁盘占用封顶」的意思。**

### 行格式与那个替换

```text
<ISO 时间> [<级别>] <内容>\n
```

**级别三种**：`info` / `warn` / `error`。

而内容里的换行会被替换成一个特殊符号：

```text
" ⏎ "
```

**这是为了让「一行日志就是一行」**——否则多行错误会把日志格式打乱，`tail` 出来的行数就没意义了。

### 追加路径四步

```text
① mkdirSync(recursive)
② rotateDaemonLogIfNeeded
③ appendFileSync
④ 全部失败都吞掉（best-effort）
```

**第 ④ 步是「日志失败不该影响业务」**——与第 66.10 节那条 `/* 审计为尽力而为，失败不阻塞业务 */` 是同一个姿态。

## 69.9 在办：一个形状与一次装配

### `agent-fleet.ts`：只有类型

123 行，头注释：

```text
Unified agent fleet model — Cursor Agents Window parity for LawMind.
Aggregates chat sessions, delegations, workflow jobs, queue items, and approvals.
```

**「Cursor Agents Window parity」**——又是一个明确对标。而它列出了**五种聚合来源**。

### 十种状态、八种来源

**状态**：

```text
queued  running
awaiting_approval  awaiting_clarification  awaiting_review
interrupted
completed  failed  cancelled
scheduled
```

**八种来源**（`AgentRunKind`）：

```text
chat  delegation  workflow_job  queue_item
tool_approval  matter_approval  pending_review  automation_send
```

**后四种都是「待处置」类**——审批、待审稿、待发邮件。**它们不是「正在跑的活」，而是「等律师点头的活」。**

### 那条「数字越小越优先」

`AgentRunSummary.priority` 上有一行注释：

```text
/** Lower = higher priority in fleet sort */
```

**数字小 = 优先**——所以排序是升序。

而 `AgentRunSummary` 有二十来个字段，其中一大串都是可选的 id：

```text
sessionId?  delegationId?  jobId?  approvalId?  queueItemId?
taskId?  workId?  actionId?
```

**七个可选 id**——因为「这一行点下去要跳到哪」取决于它是哪一类。**每一类用自己的那个 id。**

### 增长数据的三种视图

```text
AssistantGrowthRatesView    { tasksReviewed, firstPassApprovals, materialRewrites,
                              firstPassRate, rewriteRate }
AssistantGrowthRowView      { assistantId, roleId?, lifetime, window, pendingAdoptions,
                              lastUpdatedAt?, rewriteAmplitude? { samples,
                              avgAbsCharDelta, avgAbsParagraphDelta, lastAbsCharDelta } }
AssistantGrowthReportView   { windowDays, assistants }
```

**两个核心比率**（一次通过率、改写率）+ **一个改写幅度**（字符与段落两个维度 + 最近一次）。

**改写幅度里为什么要有「最近一次」**：因为平均值看不出趋势——**律师可能在改进，也可能在恶化**。

### `build-agent-fleet.ts`：397 行，没有头注释

它做的事**从导出名就能看出来**：`buildAgentFleetSummary`。

### 优先级的具体数字

| 来源                         | 优先级 |
| ---------------------------- | ------ |
| 案件审批 / 工具审批 / 待审稿 | **0**  |
| 对话·等审批                  | 0      |
| 对话·等澄清                  | 1      |
| 派活·运行中                  | 1      |
| 作业·运行中                  | 1      |
| 对话·运行中                  | 2      |
| 派活·其他                    | 2      |
| 作业·其他                    | 3      |
| 工作队列项                   | 4      |
| 对话·其他                    | 5      |

**三类「待处置」占了最高的 0**——所以侧栏最上面永远是「等你点头的」。

而排序是两级：

```text
按 priority 升序 → 同优先级按 updatedAt 降序
```

**「同优先级里最新的排前面」**——所以刚动过的那些更显眼。

### 四组状态集合

```text
ACTIVE_JOB_STATUSES          = {scheduled, queued, running}
ACTIVE_DELEGATION_STATUSES   = {pending, running}
AWAITING_ACTION_STATUSES     = {awaiting_approval, awaiting_clarification, awaiting_review,
                                queued, running, scheduled}
LAWYER_FACING_QUEUE_KINDS    = {"need_client_input"}
```

**第三组把「排队的」与「在跑的」也算进「等动作」**——因为它们都是「还没完」。

**第四组只有一个值**：只有「等客户给材料」这一类才进律师可见队列。

**这个收敛很要紧**：队列里有九种 kind（第 64.5 节那张表），但**只把一种给律师看**。其余的要么是内部状态，要么会从别的入口出现。

### 十一句中文标题

```text
委派子会话   对话 Agent   委派   团队工作流   工作流
工作队列   案件审批   待批准操作   待审核草稿   修改后待复核   交付物待审核
```

**十一个都是「这是什么」，不是「id: xxx」**。而最后四个还带状态：

```text
待审定：<标题前若干字>
拟落稿
```

**「待审定」与「拟落稿」**——这两个词把「一份草稿在待审」这件事说得比「pending_review」清楚得多。

### 八个合成 id

```text
chat:<sessionId>           delegation:<delegationId>
job:<jobId>                queue:<queueItemId>
approval:<approvalId>      tool:<actionId>
review:<taskId>
work:id
```

**前缀式 id**——所以拿一个 id 就能反推它是哪一类（第 62 章那些深链就靠这个）。

### 一处「这里没有」的事实

**`buildAgentFleetSummary` 只设 `runs` 与 `counts`，不设 `growth`。**

所以增长数据是**另一个入口**（`/api/assistants/growth`）单独取的——不在这个汇总里。

而 `byKind` 只统计**七种**（不含 `automation_send`）——因为待发邮件走的是自动办件那条链，不在这里分组。

## 69.10 Word 改稿：六个文件

这六个文件是一套完整的「改这份 Word」实现。分三层：

```text
core      浏览器安全的标记与解析（无 fs）
checklist 工作区侧车 I/O + 渲染成指令块
packs     九类合同的清单内容
instruction  回合识别 + 教练话 + 禁工具
excerpt   为推断类型而读的短摘录
```

### `word-revision-core.ts`：九个类型与三种立场

**九类合同**：

```text
equity       股权融资
ma           股权并购
procurement  采购供货
construction 建设工程
tech         技术与许可
loan         借款担保
lease        房屋租赁
employment   人事用工
charter      公司章程
```

**三种立场**：`甲方` / `乙方` / `中立`。

**四处文件里的标记**：

```text
改稿类型：<类型>         ← 正则 /^改稿类型：\s*(.+)$/m
己方立场：<立场>         ← 正则 /^己方立场：\s*(.+)$/m
<!-- word-revision-pack:v2 -->   ← 版本标记
## <条目 id> <看的前 16 字>       ← 条目标题
```

**前两行是给律师看的**（在指令里），**第三行是给程序看的**（版本），**第四行是清单结构**。

### 每个条目的五个字段

```text
{ id, look, editA, editB, stop, lens }
```

对应的中文标签是：

```text
看      要核对什么
改·甲方  甲方立场怎么改
改·乙方  乙方立场怎么改
停      不许改什么（未经确认不得动）
透      规范依据（哪条法/司法解释）
```

**「停」与「透」是这套清单最特别的两个字段**。

- **「停」**：明确列出**不许改**的项（比如「未经客户确认不得改数字或商务条件」）。
- **「透」**：给出**规范依据**。

而有一段话专门说明「透」不是「必须写进合同」：

```text
口径：制定法与司法解释优先。NVCA 等行业示范、律所公开课只作比较，不替代中国法。
透栏写的是规范依据，不是必须整段写入合同。
```

**「不是必须整段写入合同」**——防的是模型把「依据」当成「要写的条款」。

### 侧车序列化的那句横幅

```text
律师可改本文件。每条是检查单，不是必须全改。停项未经客户确认不得改数字或商务条件。
```

**三句都在给律师松绑**：可以改、不用全改、有些不能改。**这是「清单不是命令」的完整表述。**

### 版本与陈旧合并

```text
WORD_REVISION_PACK_VERSION = 2
```

而 `word-revision-checklist.ts` 有一条明确的陈旧规则（注释原文）：

```text
stale overlay (overlayVersion < WORD_REVISION_PACK_VERSION)
keeps lawyer items, appends missing builtin items (dedupe by id)
```

**「保留律师的条目、追加缺失的内置条目」**——所以内置清单升级不会覆盖律师的修改，只会**补上律师还没有的**。**这是侧车文件升级的正确做法。**

### 工作区侧车的路径

```text
<工作区>/playbooks/word-revision/<类型>.md
```

**放在 `playbooks/` 下**——与办案手册同一个目录（第 58 章那个 `practice/` 的产品面）。

### 那七条渲染出来的话

`formatWordRevisionChecklistBlock` 按四种情况拼：

| 情况             | 话                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| 律师点了类型     | `律师选定「<类型>」。按下列检查单处理：能落改则最短锚定；停项不得改；不对题的条目忽略并缓办。`   |
| 正文判断出类型   | `律师未点选类型。按合同正文判断为「<类型>」，已套该类要点。正文不对题则忽略该条，勿按错类强改。` |
| 文件名判断出类型 | 同上，只是把「按合同正文判断」换成「按文件名或指令判断」                                         |
| 判不出来         | `未识别合同类型。请先通读合同，按正文归纳审查要点，不要套用某一类预设清单。`                     |

**四种话都在防同一件事：按错类型强改。**

而「正文判断」与「文件名判断」**分开说**——因为后者的可靠度更低，所以律师/模型该更警惕。

**三种立场的话**：

```text
立场未确认：两侧「改」都列出，能确定的才落改，其余缓办。
中立：以「看」和「停」为主，不单边落改，争点写入 deferred。
己方立场：<立场>（<来源>）。只按该侧「改」落改。
```

**「只按该侧改」**——所以立场一旦确定，另一侧的改动建议就不该被采纳。

最后一条纪律：

```text
纪律：检查单不是必须全改。必要性优先。停项与未经确认的数字写入 craft_check.deferred。
不要读 playbooks/ 文件。
```

**「不要读 playbooks/ 文件」**——因为清单已经注入到提示词里了，再让模型去读文件就是浪费（而且可能读到别的类型的清单）。

### `word-revision-instruction.ts`：识别与教练

**六个推荐工具**：

```text
analyze_document  read_project_file  draft_document
update_draft  apply_surgical_edits  render_tracked_draft
```

**三个禁工具**：

```text
send_email  render_document  prepare_outbound_mail
```

**「禁 render_document」是这套东西的核心**——因为最常见的错误是**用模板重建一份新稿**，而不是**在原件上落痕**。

而拒绝提示把这件事说得很直白：

```text
本回合是原 Word 改稿：请拷贝原件落审阅痕迹。可以在对话里说明改了什么。
不要用 render_document 重建原件，不要准备外发邮件。
```

**「请拷贝原件落审阅痕迹」**——动作说清了（拷贝原件、落痕），反面也说清了（不要重建）。

那段 `WORD_REVISION_PROMPT`（九行）里有三处值得单独看：

**① 推荐路径给了完整的参数名**：

```text
落改：`draft_document`/`update_draft`（`contract_edit_baseline_path` = 源文件相对路径，
`seed_sections_from_baseline=true`，deliverable 必须是原文件正文不是审查意见或重建稿）
→ `apply_surgical_edits` → `render_tracked_draft`。
```

**「deliverable 必须是原文件正文不是审查意见或重建稿」**——这句话在防一个很具体的错误：把「原合同正文」写成「我的审查意见」。

**② 导出规则写了完整的命名规则**：

```text
导出规则（引擎执行）：**拷贝原文件**，在**源文件同一目录**写入 `原名_YYYYMMDD_01.docx`。
不改原件；保留原格式与原有修订，只叠加新修订。
```

**「保留原格式与原有修订，只叠加新修订」**——这句解释了为什么不能重建：**重建会丢掉原件里的格式和已有的修订痕迹**。

**③ 单独一条 `redlinePending=0` 不得导出**——空修订门禁。

### `word-revision-document-excerpt.ts`：48 行的一个上限

```text
WORD_EXCERPT_MAX_CHARS = 12_000
只读第一个 .docx pin
```

**为什么需要它**：律师没点类型时，得先读一小段正文才能推断类型。**而 12000 字足够判断一份合同是什么类型。**

### `word-revision-packs.ts`：1145 行的清单内容

九个包，共 **125 个条目**：

| 包                    | 条目数 |
| --------------------- | ------ |
| equity 股权融资       | **20** |
| procurement 采购供货  | 19     |
| employment 人事用工   | 18     |
| ma 股权并购           | 12     |
| loan 借款担保         | 12     |
| lease 房屋租赁        | 12     |
| construction 建设工程 | 11     |
| tech 技术与许可       | 11     |
| charter 公司章程      | 10     |

**股权融资最多（20 条）**——因为它确实是条款最密的一类。

而每个包还有一组 `aliases`（用来识别类型）。举一个：

```text
equity 的别名：增资 / 投资协议 / 股东协议 / SHA / 对赌 / 回购 / 优先股
                / ESOP / 估值调整 / 融资协议 / 股权融资 / 员工持股
```

**12 个别名里既有正式名（投资协议）也有口语（对赌）**——所以律师怎么说都能认出来。

**每个包的条目 id 都有前缀**（`eq.` / `pr.` / `em.` / `ma.` / `loan.` / `constr.` / `tech.` / `lease.` / `charter.`）——**所以跨包不会撞名**。

头注释两句话定了这套清单的性质：

```text
看/改/停/透 are grounded in statute, judicial documents, and widely taught market forms.
Not a second pipeline. Not mandatory full-document rewrites.
```

**「Not a second pipeline」**——这是第 8 章反复强调的那条：清单是注入到既有链路里的，不是另一条流水线。

## 69.11 什么算「发出去」

`lawyer-outbound-decision.ts` 119 行。它的头注释只有两句，但把口径定死了：

```text
待拍板口径：只拦「从律师这边发出去」的路径。
内部起草 / 审查 / 改稿直接出结果，律师再改或吩咐再做一轮。
```

**「只拦发出去的」**——所以起草、审查、改稿**都不拦**。这条口径决定了整个系统的松紧度：**内部动作快，外部动作慢。**

### 四组名单

```text
外发工具      send_email  prepare_outbound_mail
外发预设      client-weekly-update  mail-contract-review
外发工作流模板  mail-contract-redline  client-update-memo
```

**三组名单分别对应「工具、自动办件预设、工作流模板」**——因为这三条路径都能触发外发。

**而 `prepare_outbound_mail` 算「外发上下文」但不暂停**：

```text
toolRequiresLawyerPause 只在 name === "send_email" 时为真
```

**所以真正会停下来问的只有一个工具**：`send_email`。`prepare_outbound_mail` 只是**准备**（写进待发目录），它本身不发出任何东西。

**这个区分很实际**：如果准备也要批准，那律师每封邮件要点两次。而现在**点一次**（在最后发的时候）。

### 那个判定函数：九条分支

`isLawyerOutboundDecision` 的判定顺序（不可换）：

| 情况                                                               | 结果                               |
| ------------------------------------------------------------------ | ---------------------------------- |
| `kind === "automation_send"`                                       | **是**                             |
| `actionKind === "continue_tools"`                                  | 否                                 |
| `actionKind === "workflow_blocked"`                                | **是**                             |
| `kind` 是 `pending_review` 或 `matter_approval`                    | 否                                 |
| `actionKind === "clarification"` 或状态是 `awaiting_clarification` | **是**                             |
| `kind`/`actionKind` 是 `tool_approval`                             | 看工具名是不是外发工具             |
| `kind === "chat"`                                                  | 看是不是等澄清、或工具名是不是外发 |
| `kind === "queue_item"`                                            | 看状态是不是 `awaiting_approval`   |
| 其他                                                               | 否                                 |

**两处「优先返回否」很有意思**：

```text
continue_tools          → 否（它只是「还有活没干完」，不是外发）
pending_review          → 否
matter_approval         → 否
```

**它们都是「等律师」的事，但不是「等律师批准外发」**。所以侧栏里它们各有各的位置，不混进「待拍板」。

而 `workflow_blocked` 返回**是**——因为工作流被拦往往是卡在某个外发环节。

### 那句判定工具的话

```text
instruction blob 测 /发[给送信]|外发|批准后发|send_email|prepare_outbound_mail/
workflow blob 测 /prepare_outbound_mail|send_email/
```

**一个测中文（发给/外发），一个只测工具名**——因为工作流模板里的描述是结构化的，不需要猜中文。

## 69.12 已知坑（本章相关）

- **自动办件的「最后一次」是覆盖式的**；要看频率得读运行历史（保留 20 次）。
- **六个确认项里只有四项有专门字段**，标题与计划复用已有字段。
- **缺确认时的拒绝是「请先交代清楚：…」**（律师话）。
- **`interval` 计划夹在 5 分钟到 10080 分钟之间。**
- **`missingDataPolicy` 默认 `report_partial`**，`notifyPolicy` 默认 `always`（保持老行为）。
- **两个周报错开一小时**（9 点与 10 点），避免同时跑。
- **只有 `client-weekly-update` 允许外发。**
- **邮件有 inbox / sent / outbox 三个目录**——「待发」是真实存在的目录。
- **失败后下次执行推到 1 小时后**（不立刻重试）。
- **派单台账的指纹在文件为空或超过 4 MiB 时退化**（拿不到内容）。
- **台账只保留 200 条。**
- **防重派的话里必须给「怎么恢复」**（否则律师以为坏了）。
- **`automation-paths.ts` 只有 41 行**，单独成文件是为了断 import 环。
- **运行历史用时间戳命名文件**（列目录即时间序）。
- **「连续 3 次成功」才算有依据升格**。
- **判定结论里要报「依据最近几次、共几次」**。
- **守护进程不是云 VM**（这句话写在头注释最显眼处）。
- **心跳 30 秒一跳、90 秒算陈旧**（容忍一次慢 tick）。
- **`isHeartbeatStale` 在没有心跳记录时返回「不陈旧」**（初次启动不该判死）。
- **时钟回拨时心跳年龄钳到 0。**
- **锁要自愈**（进程被强杀会留粘锁）；**释放只删自己的锁**。
- **被信号杀的退出要解释成「系统休眠或内存不足」**（否则律师以为有 bug）。
- **放弃重试的话必须说业务后果**（「这段时间的自动办件没有运行」）。
- **守护进程日志只留单世代**，上限 2 MiB；理由追到了 `GOALS.md` 的产品定位。
- **日志里的换行会替换成 `⏎`**（保证一行就是一行）。
- **日志写入失败一律吞掉**（best-effort）。
- **环境变量拒绝名单在这个仓库里出现了三次，必须同步。**
- **`buildAgentFleetSummary` 不设 `growth`**（增长数据是另一个入口）。
- **优先级数字越小越优先**；三类「待处置」占最高优先。
- **队列有九种 kind，但只把 `need_client_input` 一种给律师看。**
- **`byKind` 不含 `automation_send`。**
- **合成 id 是前缀式**（`chat:` / `job:` / `review:` …），可反推类型。
- **Word 改稿真禁的只有三个工具**，而 `render_document` 是重点禁的那个。
- **导出规则是「拷贝原文件 + 只叠加新修订」**，因为重建会丢原件格式与已有痕迹。
- **清单侧车升级时保留律师条目、只追加缺的**（按 id 去重）。
- **「透」栏是规范依据，不是必须写进合同的条款。**
- **判不出合同类型时不许套任何预设清单。**
- **中文与英文文件名两种推断分开说**（后者可靠度更低）。
- **真正会停下来问的外发工具只有 `send_email`**；`prepare_outbound_mail` 不算。
- **`continue_tools` / `pending_review` / `matter_approval` 都不是「待拍板」。**
