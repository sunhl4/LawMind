# 第 17 章 自动办件与运维

这一章讲「没人盯着的时候系统在干什么」，以及交付实施方要用的命令行。律师日常不走这些命令。

五条铁律在这里的取舍：

| 铁律           | 这一章怎么落                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 上手简单       | 「以后每周这样来一次」用模板把四句确认写好。律师改字即可。清空「办完是什么样」或「哪些事必须先问我」才不能创建。                        |
| 交付质量       | 无人值守的产出进收件箱，外发仍要单独批。失败必须看见，不靠运行次数当质量。                                                              |
| 稳定           | 同一份已停下的附件不反复重派。没有新来信就写「无新变化」，不把上周结果再写一遍。                                                        |
| 先复用，后自研 | 邮箱走 IMAP / SMTP / Graph。不自造邮件协议。                                                                                            |
| 发挥模型能力   | 邮件合同短路径只禁 `send_email` 和用 `render_document` 重建原件。识别到这条路不冻结其余工具。署名长度上限是邮件头能装下，不是文稿配额。 |

## 17.1 自动办件：让系统按点干活

场景很具体：每周一给客户发案件进展、每月续展提醒、每天早上把邮箱里待回的邮件整理出来。这些活不需要律师每次开口。

### 一个自动办件长什么样

存在 `<工作区>/lawmind/automations/<id>.json`，字段有：

| 字段                                            | 说明             |
| ----------------------------------------------- | ---------------- |
| `title`                                         | 名字             |
| `enabled`                                       | 开关             |
| `presetId`                                      | 预设（见下）     |
| `templateId`                                    | 用哪个工作流模板 |
| `matterId`                                      | 挂在哪个案件     |
| `instruction`                                   | 具体指令         |
| `schedule`                                      | 排期             |
| `nextRunAt`                                     | 下次运行时间     |
| `lastRunAt` / `lastJobId` / `lastResultSummary` | 上次运行情况     |
| `lastErrorCode` / `lastErrorMessage`            | 失败原因         |
| `expectedResult`                                | 期望结果         |
| `approvalBoundary`                              | 审批边界         |
| `missingDataPolicy`                             | 资料缺失时怎么办 |
| `notifyPolicy`                                  | 什么时候通知     |
| `allowSendEmailAfterApproval`                   | 批准后能不能发   |
| `notifyEmail`                                   | 通知发到哪       |

### 五种排期

| 类型       | 参数                                          |
| ---------- | --------------------------------------------- |
| `daily`    | 时、分；可选 `tz`（IANA，如 `Asia/Shanghai`） |
| `weekly`   | 星期几、时、分；可选 `tz`                     |
| `once`     | 具体时间点                                    |
| `interval` | 每多少分钟                                    |

`tz` 缺省时按本机墙钟算下次运行（与升级前一致）。带 `tz` 时按该时区的墙钟解释，并正确跨过夏令时。非法 IANA 名称创建/改排期会返回 400。

新建 **interval** 排期时，设置页会提示「约 N 次/天」以及「每次运行都会消耗模型用量；没有新情况也可能空跑」——只做频次可见性，不编造单价。

`interval` 的范围夹在 5 分钟到 7 天之间。

### 五个预设

`renewal-monitor`（续展监控）、`client-weekly-update`（客户周报）、`mail-inbox-digest`（邮箱摘要）、`mail-contract-review`（邮件合同审阅）、`custom`（自定义）。

预设里有两个带 `needsMail: true`（需要邮箱配置）；而 `defaultAllowSend: true`（批准后可以直接发信）**只有一个**预设（`client-weekly-update`）。注意字段名在预设侧是 `defaultAllowSend`，在自动化对象侧才叫 `allowSendEmailAfterApproval`（落盘时映射过去）——没有 `defaultAllowSendEmailAfterApproval` 这个字段。

### 六个确认项，缺一不许启用

这是自动办件设计里最值得学的一块。头部注释把它当原则：

```text
- **`never` 不压制失败**：无人值守的失败必须让律师知道，这是不可让的
  （否则「不打扰」会退化成「无声地不再办件」）。
```

「六确认」是个**产品口径**，不是某个类型：`AutomationConfirmationField` 只有 **4 个成员**（下面这四项，也是需要持久化的部分），第五项是**标题**、第六项是**计划**，各有既有字段。头部注释原话就是这个分法（`lawyer-automations.ts:142`）。

四项有专门的中文标签：

| 字段                | 标签             |
| ------------------- | ---------------- |
| `expectedResult`    | 期望结果         |
| `approvalBoundary`  | 审批边界         |
| `missingDataPolicy` | 资料缺失时怎么办 |
| `notifyPolicy`      | 什么时候通知     |

`validateAutomationConfirmations` 会检查显式新建时这四项在不在。选模板或说一句话创建时，`draftAutomationConfirmations` 会按模板写好可改的四句（例如续签只出清单、周报外发前必须批准、邮箱没有新来信就不要重复）。律师可以改字；把「办完是什么样」或「哪些事必须先问我」清空，设置页仍然不能创建。HTTP 的显式 `POST /api/automations` 仍拒绝空的四项；引擎的 `createAutomation` 在调用方没写时落入模板草稿，所以「从这句话创建」也会把规矩写进任务书。

### 缺资料时的三种处置

`missingDataPolicy` 三个值：

| 值               | 行为                                        |
| ---------------- | ------------------------------------------- |
| `report_failure` | 当失败报（`fail_run`）                      |
| `report_partial` | 出一份部分结果并报告（`proceed`，**默认**） |
| `skip_run`       | 安静地跳过（`skip_quietly`）                |

默认是「出部分结果并报告」，这个默认值选得好：既不假装成功，也不把「材料不齐」当严重失败。

### 通知策略与那条不可让的规则

`notifyPolicy` 三个值：`always`、`on_problem`、`never`。

但有一条覆盖规则，代码注释写得很硬：

```text
1. **失败与待拍板永不静默**：`failed` / `blocked` 一律通知，与 `notifyPolicy` 无关。
```

也就是说，即使律师选了「从不通知」，失败和需要拍板的事也会通知。注释解释了为什么：

> 无人值守的失败必须让律师知道，这是不可让的（否则「不打扰」会退化成「无声地不再办件」）。

这条设计很像「静默失败」那类经典故障的预防：一个自动化悄悄不再工作，而报表上看起来一切正常。

### 期望结果和审批边界真的进交办

有一条测试标题是「期望结果与审批边界真的进到交办里」。意思是这两项不只是配置，会被拼进给模型的任务书里。下一轮还会带上 `buildAutomationRunContinuityNote`：上次办到哪、上次如果没办成是什么错误码。没有新变化时，任务书要求写「无新变化」，而不是把上周的结果再写一遍。

### 收件箱：结果去哪了

自动化的产出进 `<工作区>/lawmind/automation-inbox/<id>.json`，条目有六种状态：

```text
open | acknowledged | approved_send | sent_remote | approved_local_only | dismissed
```

注意 `approved_send` 和 `approved_local_only` 是分开的：**批准发出去** 和 **批准只留本地** 是两个不同的动作。外发永远要单独批。

`pendingSend` 字段里带着待发的 `{to, subject, body, attachmentRelativePaths}`。

### 运行历史

存在 `<工作区>/lawmind/automations/<id>/runs/<时间>__<runId>.json`，保留最近 20 条（`AUTOMATION_RUN_RETENTION`）。

触发方式四种：`schedule`（排期）、`manual`（手动）、`test`（测试）、`event`（本机事件）。

`event` 触发只认三处来源（`src/lawmind/platform/automation-event-trigger.ts`）：本案文件名（`matter_files`）、新来信的发件人或标题（`mail`）、本机投递的一条 webhook 文本（`webhook`）。匹配是子串（不用正则）；「全部 / 每条 / `*`」这类无界条件直接拒绝；两次触发最少间隔 15 分钟（上限 24 小时，默认 60 分钟）。桌面与 lawmindd 同时扫到同一事件时靠文件锁抢占，不会双发。

状态四种：`ok`、`failed`、`skipped`、`blocked`。

### 抢占与防重

`claimDueAutomation` 用文件锁（`<文件>.lock`）做原子抢占，抢到之后把 `nextRunAt` 推到一小时后——这样即使这次跑很久，也不会被下一次重复触发。

### 从一件活直接变自动化

`automation-from-work.ts` 提供一条捷径：某件活干完了，律师说「以后每周这样来一次」，就把它变成自动化。

- 默认排期是周一的 9:00（`DEFAULT_WORK_AUTOMATION_SCHEDULE`）。
- 能力能映射到预设（比如 `mail.contract` → `mail-contract-review`）。
- 没绑案件会报 `work_missing_matter`。

### 派发台账：一次真实事故的产物

`automation-dispatch-ledger.ts` 的头部注释记了事故：

> 背景（真实事故）：「邮件合同审阅改稿」每 120 分钟派一次同一份附件；那一件已被独立审稿门禁停在 `guardian_exhausted`，于是同一份材料被**反复重派、反复撞同一道门禁**。

也就是说：一个自动化在门禁那儿卡住了，但因为它不知道「这件已经卡住了」，就一遍遍重派，每次都在同一个地方撞墙。

配套的 `gate-stop.ts` 注释补了另一半：

> 独立审稿连续 block 到 `guardian_exhausted` 后，轮次虽已收口，但本件仍留在 `running`、缺口只散落在对话正文里，律师在「在办/待拍板」看不到「这一件正等着我处置」。自动化因此还会把同一份材料再派一次。

修法有两部分：**门禁停下时要产生一个律师可见的待处置项**（而不是只在对话里留一句话），以及**派发台账记住「这件已经因为门禁停过」**，不再重派。同一份材料的「未重复派单」只提醒一次（`lastQuietKey`）。邮箱整理在通知策略不是「每次都通知」时，同一批来信再跑不再多一条收件箱；匣是空的写「没有新来信」，匣里还有上次那些信则写「来信和上次一样」。选了「每次都通知」或旧文件没写策略（默认每次通知）时，仍然每次进收件箱。跑完一轮且没有抛错时清掉 `lastErrorCode`，否则下一轮任务书会一直写「上次没办成」。

## 17.2 邮件

邮件这条线是自动化的主要输入源，也是外发的唯一出口。

### 支持哪些邮箱

六种预设（`MAIL_PROVIDER_PRESETS`）：

| 预设          | IMAP                        | SMTP                                               |
| ------------- | --------------------------- | -------------------------------------------------- |
| Gmail         | `imap.gmail.com:993`        | `smtp.gmail.com:465`（secure）                     |
| Outlook       | `outlook.office365.com:993` | `smtp.office365.com:587`（非 secure，走 STARTTLS） |
| Microsoft 365 | 同上                        | 同上                                               |
| QQ 邮箱       | `imap.qq.com:993`           | `smtp.qq.com:465`                                  |
| 163 邮箱      | `imap.163.com:993`          | `smtp.163.com:465`                                 |
| 自定义 IMAP   | 自填 `:993`                 | 自填 `:465`（secure）                              |

认证方式三种：`password`、`app_password`（应用专用密码）、`graph_client`（Graph 应用权限）。

### 端口门禁

有一条安全约束：**非 TLS 标准端口默认拒绝**。

允许的端口：

```text
IMAP 安全端口：993
SMTP 安全端口：465, 587
```

不在这两个集合里就报 `insecure_imap_port` / `insecure_smtp_port`。

注释说明了这个设计的来源：

> 对齐 MCP `allowInsecureHttp` 先例：显式标志 + 明确警告文案。

也就是说，要放行得显式开，而且会有明确警告——不是静默允许。

### 附件大小限制

| 限制     | 值   |
| -------- | ---- |
| 单个附件 | 20MB |
| 附件总量 | 60MB |

### 密钥怎么存

邮箱密码/授权码不能明文放。`mail-secrets.ts` 用 AES-256-GCM 加密，存在 `<应用根>/mail-secrets.json`，权限 0600。

加密密钥来自 `LAWMIND_MAIL_SECRETS_KEY`，或者本机密钥文件 `~/.lawmind/keys/mail-secrets.key`。

两处处理：

**第一，v1 明文会自动迁移。**

> 既有 v1 明文文件读取时自动迁移为加密存储（临时文件 + rename 原子替换，明文不再滞留该路径；闪存块级擦除不可移植，见 SECURITY 报告残余说明）。

注意后半句的诚实：**它承认 SSD 的块级擦除不可靠**，所以「明文不再滞留该路径」是逻辑上的，物理上可能有残留。这种事写出来比藏着好。

**第二，解不开就不覆盖。**

> 防误毁：磁盘上存在但任何本机密钥都解不开的密文，拒绝覆盖。

也就是说，如果密钥换了导致旧密文解不开，系统**不会**直接覆盖它——那等于把律师配过的邮箱账号悄悄删了。错误码 `mail_secrets_undecryptable`。

### 收信与发信

- IMAP 用 `fetchImapMessages`，连接超时 15 秒 / 命令超时 15 秒 / socket 超时 30 秒。
- SMTP 用 `sendSmtpMail`，`port === 587 && !secure` 时要求 `requireTLS`。
- Graph 走应用权限：取 token（`https://login.microsoftonline.com/<租户>/oauth2/v2.0/token`），然后读收件箱、拿附件、发送。

### 关注联系人

`watch-contacts.ts` 让律师列一份「重点关注的人」，收到这些人的邮件会高亮。上限 40 个。

### 邮件写什么格式

`mail-send-format.ts` 管署名、称呼、落款这些。

落幕风格五种：`none`、`formal`（此致敬礼）、`business`（顺颂商祺）、`reply`（此复）、`custom`。

限制：发件人显示名 ≤80 字，自定义落款 ≤200 字，签名 ≤2000 字。这是邮件头和落款块的长度，超了会挤坏版式或被对方服务器拒收。它不衡量这封信写得好不好。

`applyMailSendFormat` 的配套有一个防重复的处理（`alreadyHasMailBlock`）——如果你手写的正文里已经有署名块了，不会再加一遍。

## 17.3 邮件合同短路径：一条被钉住的路

这是邮件里最特殊的一条流程：收到一份合同附件，直接在对话里走审查改稿。

### 怎么识别

`isMailContractFastPathInstruction` 的判据有三种（任一命中）：

1. 指令里有 `【邮件合同审阅`。
2. 有 `mail-contract-redline`（模板 id）。
3. 同时出现「邮件合同」和 `render_tracked_draft|prepare_outbound_mail` 这两个工具名之一。

### 钉住了什么

```js
// 允许
[
  "analyze_document",
  "draft_document",
  "update_draft",
  "apply_surgical_edits",
  "render_tracked_draft",
  "prepare_outbound_mail",
][
  // 禁止
  ("send_email", "render_document")
];
```

注意两点：

- **允许名单现在返回 `undefined`**（不冻结工具表了）。有一个废弃函数 `mailContractFastPathAllowNames` 保留着，注释写着「Playbook no longer freezes an allow-list」。这是一个刻意的演进：早先靠白名单冻住工具表，现在只留否决清单。
- **禁止的两项很明确**：不许直接发信（只能准备待发邮件），不许用 `render_document` 重建附件（必须走修订轨）。

拒绝时的提示文案是：

```text
本回合是邮件合同短路径：附件路径已在指令里，不要翻案卷找同一份附件。
核法条可以用检索。不要 send_email，不要用 render_document 重建附件。
按任务选用工具，不要为走固定次序丢掉判断。
```

最后一句体现了第 1 章的引导原则：**不靠冻工具表来「走对流程」。**

### 指令模板里的硬约束

生成的指令头部是 `【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】`，里面有几条硬约束：

- 对合同正文做**最小必要修改**（最短改动，第 8 章）。
- `redlinePending=0` 不得 `render_tracked_draft`（空修订不许导出）。
- 不许 `send_email`。
- 不许 `render_document` 重建原件。

还有一段「相关邮件与附件（路径已给出）」——把附件路径直接写进指令，这样模型不用去翻案卷找（也就不用浪费检索次数）。

### 建议回复收件人

指令里可以带 `建议回复收件人：<地址>`，`extractSuggestedReplyTo` 会解析出来。外发前的预检会拿它和实际收件人比对，不一致就拦下（第 5 章）。

## 17.4 守护进程的运维入口

```bash
pnpm lawmind:daemon -- start|stop|status|enable|disable [--workspace <目录>]
```

状态存在 `<工作区>/lawmind/daemon.json`，pid 在 `daemon.pid`，锁在 `daemon.lock`。

tick 间隔 30 秒（`DAEMON_TICK_INTERVAL_MS`）。心跳超过 3 个周期（90 秒）算陈旧。

守护进程有四件套（注释里叫「可信后台的四件套」）：

1. **心跳**：有 `heartbeatAt` / `lastTickAt`。
2. **退出记录**：`lastExitClass` / `lastExitAt` / `lastExitDetail`。
3. **重启计数与放弃**：`restartCount` / `supervisionGaveUpAt` / `supervisionGaveUpReason`。
4. **单实例锁**：只有 tick 子进程持有。

有一条契约写得很清楚：

> 契约：**只在真出过事时才有内容**。

四件套的价值在于**安静的守护进程什么都没有**——日志空、状态干净，就说明没事。出过事才有内容，这是可读性的关键。

日志文件滚动（`lawmind-daemon-log.ts` 里管）——注意注释提到一个细节：不能直接把子进程的 stdout/stderr 指向 `daemon.log`，因为**轮转之后那个 fd 会一直写到改名后的旧 inode 上**。所以要接管输出、逐行加时间戳再写。

## 17.5 运维命令

### `pnpm lawmind:ops`

子命令：

| 命令                       | 干什么                                                   |
| -------------------------- | -------------------------------------------------------- |
| `status`（默认）           | 工作区概览                                               |
| `doctor`                   | 与 `lawmind:doctor` 同一份三行巡检（会话 / 投影 / 索引） |
| `export-dashboard`         | 导出质量看板                                             |
| `acceptance-pack`          | 出工作区级验收包                                         |
| `matter-consistency`       | 案件投影一致性检查                                       |
| `matter-repair-projection` | 修投影漂移                                               |

参数 `--workspace <目录>`。`--deep` 只额外跑 `lawmind:smoke`，不是每周巡检。

### `pnpm lawmind:doctor`

无界面体检，先打印会话、投影、索引三行。投影对不上，或自定义技能因签名停用时，退出码为 1。参数 `--json`、`--fix`。

`--fix` 把损坏的工具调用配对写回 `session.json` 和 `transcript.jsonl`。不带 `--fix` 时只报告：下一轮对话会自动补上。

工作区目录从 `LAWMIND_WORKSPACE_DIR` 读。

### 备份

```bash
LAWMIND_WORKSPACE_DIR=<工作区> pnpm lawmind:backup -- <输出.tar.gz>
```

- 参数：输出 tar.gz 路径（可选）。
- 环境变量：`LAWMIND_WORKSPACE_DIR`（必填）、`LAWMIND_BACKUP_INCLUDE_ENV=1`（连环境文件一起备）。
- 会写一份 `BACKUP-MANIFEST.txt`。
- 默认**排除** `<工作区>/.env.lawmind` 和 `<工作区>/.env`。

排除环境文件是有道理的：备份包常被拷来拷去，把 API Key 打进去风险很高。要备得显式开开关。

### 本机 API 凭据（只读）

```bash
pnpm lawmind:local:token [--json] [--status] [--client cli]
```

它读 `<用户数据目录>/LawMind/local-api-clients.json` 拿 CLI 的凭据。CLI 客户端是**只读**的（只能 GET / HEAD / OPTIONS）。

### HTTP 冒烟

| 脚本                                  | 干什么                       |
| ------------------------------------- | ---------------------------- |
| `lawmind-desktop-http-smoke.mjs`      | 对着已跑起来的服务探测       |
| `lawmind-desktop-http-smoke-auto.mjs` | 自己找空闲端口起一个服务再探 |

探测的核心是 `GET /api/health` 的 `ok === true`。`LAWMIND_SMOKE_DEEP=1` 会多检查几项（任务列表、任务详情里的校验点、草稿的引用完整性）。

### 跨机器验收探针

```bash
pnpm lawmind:matter-replica:probe [--strict]
```

它建两个临时工作区加一个中继目录，跑十二项跨机器检查（编号 X1–X12，另外有两个对照组 C1/C2）。`--strict` 下失败会退出码 1。

这是案件副本功能唯一的端到端验证手段——单测覆盖不到「两台机器 + 中继」这种拓扑。

### 案件云服务

```bash
pnpm lawmind:matter-cloud --dir <数据目录> --port 8788 --host 127.0.0.1 --setup
```

环境变量 `LAWMIND_MATTER_CLOUD_DIR`（默认 `.lawmind-matter-cloud`）、`LAWMIND_MATTER_CLOUD_PORT`（默认 8788）、`LAWMIND_MATTER_CLOUD_HOST`（默认 `127.0.0.1`）。

### 初始化与演示数据

| 命令                          | 干什么                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `pnpm lawmind:setup`          | 交互式快速配置（`--preset`、`-y`）                               |
| `pnpm lawmind:setup:team`     | 团队环境初始化（`--yes`、`--desktop`）                           |
| `pnpm lawmind:onboard`        | 上门初始化（`--preset`、`--yes`、`--skip-smoke`、`--no-strict`） |
| `pnpm lawmind:env:check`      | 环境与模型连通性检查（`--strict`）                               |
| `pnpm lawmind:seed:desk`      | 灌一份演示工作台数据                                             |
| `pnpm lawmind:seed:workflows` | 灌内置工作流模板                                                 |

`lawmind:onboard` 是给交付实施用的：它串起「快速配置 → 严格环境检查 → 空声明检查的冒烟」，一条命令跑完上门的准备步骤。

预设 id 有五个：`qwen-only`、`qwen-chatlaw`、`deepseek-lawgpt`、`general-lexedge`、`general-partner`。

### 演示数据

`seedSampleDesk` 会灌三个案件：

| 案件 id             | 类型                                 |
| ------------------- | ------------------------------------ |
| `xinghui-sale-876`  | 一个像样的诉讼卷宗                   |
| `xinghui-nda-2026`  | 一个轻量合同案件                     |
| `lianhua-sale-2022` | 一个已结案的（用来演示相似案件召回） |

幂等：id 固定，已有行会跳过。

## 17.6 工作台设置

`desk-settings.ts` 存 `<工作区>/lawmind/desk-settings.json`，两个字段：

| 字段                       | 说明                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `contractBatchRelativeDir` | 合同批量处理的相对目录（校验会拒 `..` 和绝对路径，错码 `invalid_contract_batch_dir`） |
| `auditExternalAnchorUrl`   | 审计外锚地址                                                                          |

`schemaVersion` 固定 1。

## 17.7 历史扫描的入口

```text
GET  /api/historical-scan
POST /api/historical-scan/roots
POST /api/historical-scan/roots/remove
POST /api/historical-scan/run
```

跑一次扫描会：走目录树（上限：3 个根、2000 个文件、深度 8）、分类文档、比对游标算增量、抽习惯（≥5 次）、把建议写进记忆采纳队列。

增量靠 `cursor.json`（记每个文件的 mtime 和大小）和目录指纹（`hashCatalogFingerprint`）。指纹没变时**不重复产出知识建议**——避免每次跑都往队列里塞一堆一样的条目。

## 17.8 多任务工程的审计工具

仓库里有一组专门做「工程过程审计」的脚本（对应 `LAWMIND-MULTITASK-*` 那几篇文档）：

| 命令                                   | 参数                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm lawmind:multitask:validate`      | `--with-playwright`、`--strict`                                                                                       |
| `pnpm lawmind:multitask:guardrail`     | `--contract`、`--request`、`--out-dir`                                                                                |
| `pnpm lawmind:multitask:audit`         | `--strict`、`--out-dir`                                                                                               |
| `pnpm lawmind:multitask:observability` | `--window-days`、`--out-dir`                                                                                          |
| `pnpm lawmind:multitask:decision`      | `--task-complexity`、`--workspace-volatility`、`--dependency-density`、`--acceptance-pressure`、`--context-isolation` |

`observability` 产出的报告里有几个百分位指标（`leadTimeP50Ms`、`leadTimeP90Ms`）和比率（重试率、取消率、失败率、冲突率、一次通过率）。

`decision` 回答的是一个工程组织问题：「这件事该按任务优先还是工作区优先来做」。参数就是给这个判断打分的输入。

这几个脚本服务本仓库的开发过程，不进律师界面，也不当作交件质量或「可审计」的证据。

## 17.9 关键文件

| 关注点           | 文件                                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自动办件模型     | `src/lawmind/platform/lawyer-automations.ts`、`automation-paths.ts`、`automation-run-history.ts`                                                                                                                                                                                                                |
| 从活变自动化     | `src/lawmind/platform/automation-from-work.ts`、`infer-automation-from-instruction.ts`                                                                                                                                                                                                                          |
| 派发台账与门禁停 | `src/lawmind/platform/automation-dispatch-ledger.ts`、`gate-stop.ts`                                                                                                                                                                                                                                            |
| 邮件             | `src/lawmind/mail/`（`imap-client.ts`、`smtp-client.ts`、`graph-mail.ts`、`sync-inbox.ts`、`provider-presets.ts`、`mail-secrets.ts`、`mail-attachments.ts`、`convert-to-docx.ts`、`mail-transport-guard.ts`、`mail-send-format.ts`、`mail-contract-formats.ts`、`watch-contacts.ts`、`mail-accounts.ts`）       |
| 邮件合同短路径   | `src/lawmind/platform/mail-contract-short-path-instruction.ts`                                                                                                                                                                                                                                                  |
| 守护进程         | `src/lawmind/platform/lawmind-daemon.ts`、`lawmind-daemon-supervision.ts`、`lawmind-daemon-log.ts`；`scripts/lawmind/lawmind-daemon.ts`                                                                                                                                                                         |
| 工作台设置       | `src/lawmind/learning/desk-settings.ts`                                                                                                                                                                                                                                                                         |
| 历史扫描         | `src/lawmind/historical-scan/`                                                                                                                                                                                                                                                                                  |
| 多任务审计       | `src/lawmind/ops/multitask-observability.ts`、`scripts/lawmind/lawmind-multitask-*.ts`                                                                                                                                                                                                                          |
| CLI 脚本         | `scripts/lawmind/`（`lawmind-ops.ts`、`lawmind-doctor.ts`、`lawmind-backup.sh`、`lawmind-local-token.ts`、`lawmind-matter-cloud-server.ts`、`lawmind-matter-replica-cross-machine-probe.ts`、`seed-*.ts`、`lawmind-team-env-setup.ts`、`lawmind-quick-setup.ts`、`lawmind-onboard.ts`、`lawmind-env-check.ts`） |
| 桌面端投递       | `src/lawmind/insights/session-timeline.ts`、`metrics/lawyer-dashboard.ts`、`metrics/team-growth-dashboard.ts`                                                                                                                                                                                                   |

## 17.10 已知坑

- **失败和待拍板永不静默。** 即使 `notifyPolicy` 是 `never`，失败也会通知。这是设计，不要「优化」掉。
- **六项确认不是装饰。** 模板会预填可改的四句；「期望结果」和「审批边界」会进任务书。清空这两项不能创建。
- **同一批来信、同一份已停下的附件不要反复提醒。** `lastQuietKey` 挡住第二次，但「每次都通知」仍然每次进收件箱。有新来信或新附件时标记清掉。成功跑完要清掉上次的失败码。
- **下一轮要看见上次办到哪。** 连续性说明进任务书，没有新变化就写「无新变化」。
- **`approved_send` 和 `approved_local_only` 是两件事。** 批准发出去得单独做。
- **缺资料的默认是「出部分结果并报告」。** 改成「安静跳过」会让问题不可见。
- **抢占后 `nextRunAt` 会推后一小时。** 排期任务跑很久也不会被重复触发。
- **邮件非 TLS 标准端口默认拒。** 放行要显式开并有警告，别默默放宽。
- **`mail-secrets.json` 解不开时不许覆盖。** 那等于把律师配过的账号悄悄删掉。
- **明文迁移承认 SSD 擦除不可靠。** 这是诚实的边界说明，不是待办。
- **邮件合同短路径只保留禁项，不再冻结允许清单。** 「按任务选用工具」是有意的。
- **附件路径写在指令里。** 不要再让模型去翻案卷找同一份附件。
- **守护进程的日志不能直接指 fd 写文件。** 轮转后 fd 会写到改名后的旧 inode。
- **备份默认不含环境文件。** 要备得开 `LAWMIND_BACKUP_INCLUDE_ENV=1`。
- **`lawmind:backup` 不在 `pnpm lawmind:*` 清单里。** 要直接跑脚本。
- **门禁停下必须产生律师可见的待处置项。** 只在对话里留一句话会导致自动化反复重派。
- **跨机器探针是案件副本唯一的端到端验证。** 改同步逻辑记得跑它。
