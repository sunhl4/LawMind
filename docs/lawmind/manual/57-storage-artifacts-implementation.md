# 第 57 章 实现精读：存储与产物渲染

这一章讲两块：**数据怎么安全落盘**（`adapters/`）和**草稿怎么变成 Word/PPT**（`artifacts/`）。

放在一章的原因：它们合起来是「从内存到磁盘」的全程——先原子写、再渲染、最后按规则命名放到正确的位置。

## 57.1 两套 zod schema（一个已知的不一致）

`adapters/matter-storage/` 里有**两个** schema 文件：`schemas.ts` 和 `schema.ts`。这本身就是一件需要解释的事。

### `schemas.ts`：五个 schema

头部注释说明了它和 `core/contracts.ts` 的关系：

```text
Matter 真相源 zod schemas — 与 src/lawmind/core/contracts.ts 类型保持一致。
写侧 service 在落盘前用这些 schema 校验，错误走 audit `deliverable.spec.invalid`
类似事件。读侧返回前也建议用 `safeParse` 防御坏 JSON。
```

它导出五个 schema 与五个类型：`matterSchema`、`deliverableSchema`、`approvalSchema`、`queueItemSchema`、`deadlineSchema`。

### `schema.ts`：粒度更细、带默认值

`schema.ts` 的头部注释：

```text
zod schemas — `workspace/matters/<id>/` 下的 JSON 真相源（W3）。
这些 schema 是写侧 application services 与磁盘之间的契约。
当前与 src/lawmind/core/contracts.ts 中的 TypeScript 类型一一对应。
```

它导出二十多个**命名的** schema（`RiskLevelSchema`、`MatterStatusSchema`、`MatterPartySchema`、`MatterDocketSchema`、`MatterRecordSchema`……），粒度细到单个枚举。

### 两套的四处差异（这是要记住的）

| 项                           | `schemas.ts`                                       | `schema.ts`           |
| ---------------------------- | -------------------------------------------------- | --------------------- |
| `currentReviewStatus`        | `pending/approved/rejected/modified`               | 多一个 **`redacted`** |
| 数组字段                     | 必需                                               | 带 `.default([])`     |
| `approvalSchema.requestedAt` | `.min(1)`                                          | 无 `.min(1)`          |
| `deadlineSchema.dueAt`       | `.min(1)`                                          | 无 `.min(1)`          |
| `queueItemSchema`            | 无 `dependsOn`/`blockedBy`/`blockedReason`/`phase` | **有这四个**          |

**所以「用哪个 schema」会影响校验结果**：

- 走 `schemas.ts` 的 `deliverableSchema` 会拒绝 `currentReviewStatus: "redacted"`。
- 走 `schema.ts` 的 `QueueRecordSchema` 会**丢掉** `dependsOn` 那四个字段（因为它不认）。

**实践中以「实际调用的那个」为准**。`io.ts` 的 `readJsonValidated` / `appendJsonl` / `rewriteJsonl` 都是**调用方传 schema**，所以取决于调用方传的是哪一个。

这两套并存是历史演进留下的。**改数据模型时两处都要看**——这是这一层最容易出错的地方。

### `matterSchema` 的完整字段（`schemas.ts`）

我把它们按用途分组列一遍，因为这是「案件真相源长什么样」的权威答案。

**标识与状态**：

| 字段             | 约束                                       |
| ---------------- | ------------------------------------------ |
| `matterId`       | `.min(1)`                                  |
| `clientId`       | 可选                                       |
| `title`          | `.min(1)`                                  |
| `status`         | 七态枚举                                   |
| `sensitivity`    | `normal` / `high` / `restricted`           |
| `strategyStatus` | `missing` / `draft` / `approved` / `stale` |

**责任人**：`ownerLawyerId?`、`primaryAssistantRoleId?`。

**五个关联 id 数组**：`openQuestionIds`、`nextActions`、`deadlineIds`、`deliverableIds`、`queueItemIds`。

**案件画像**：`matterKind?`（三态）、`practiceTags?`、`causeOfAction?`（≤200）、`counterparty?`（≤200）。

**当事人**（`parties?`，**`.max(32)`**）：

| 字段              | 约束                                                      |
| ----------------- | --------------------------------------------------------- |
| `partyId`         | 1–64                                                      |
| `name`            | 1–120                                                     |
| `role`            | `client` / `counterparty` / `agent` / `counsel` / `other` |
| `standing?`       | ≤40                                                       |
| `serviceAddress?` | ≤200                                                      |
| `serviceMethod?`  | `mail` / `electronic` / `in_person` / `unknown`           |

**案号与法院**（`docket?`）：`caseNo`、`court`、`instance`、`standing`、`hearingAt`、`claimAmount?`（**自由文本**，≤120）。

`claimAmount` 是文本这一点值得记住——注释写明了原因：

```text
标的金额：自由文本，保留「32,100 元」等原始写法。
```

**时间戳**：`createdAt?`、`updatedAt?`。

### 其他四个 schema 的关键字段

**交付物**：`kind` 七态、`audience` 五态、`status` **八态**（生命周期）、`blockingReasons[]`。

**审批**：`requestedBy` / `requestedRole?` / `targetRole?`、`status` 四态。

`targetRole` 的注释：

```text
W8 起：明确委派的目标角色（即审批应由谁完成）
```

**队列项**：`kind` **九态**、`status` 四态、`priority` 四态、`phase?`（`plan`/`research`/`draft`/`review`/`render`）。

**期限**：`severity` 三态、`source` **五态**、`status` 四态、`eventKind?` 六态、`remindBeforeHours?` **0–720**（= 最多 30 天）、`dependsOnDeadlineId?`（≤64）。

## 57.2 路径计算：一个正则把住入口

`paths.ts` 的头部注释说明了这套目录和 `cases/` 的分工：

```text
`workspace/matters/<matterId>/` JSON 真相源的路径计算（W3）。
与现有 `cases/<matterId>/CASE.md` 并存：CASE.md 仍是律师可读的叙事文件，
本目录是机器可读的状态对象。
```

### 那个正则

```ts
ALLOWED_MATTER_ID = /^[a-zA-Z0-9_-]{1,128}$/;
```

**注意它比 `cases/matter-id.ts` 的 `MATTER_ID_PATTERN` 严得多**（那个允许中文、点、空格）。两套正则：

| 位置                               | 正则                                     | 允许中文 |
| ---------------------------------- | ---------------------------------------- | -------- |
| `cases/matter-id.ts`               | `^[\p{L}\p{N}][\p{L}\p{N}._\- ]{1,127}$` | ✅       |
| `adapters/matter-storage/paths.ts` | `^[a-zA-Z0-9_-]{1,128}$`                 | ❌       |

**storage 那一层更严**：因为它拼的是磁盘路径，字符集越窄越安全。而 `cases/` 那边要容忍律师起的名字。

不合法会抛：

```text
unsafe matter id: <id>
```

### 十一个路径模板

我把它们列全，因为这是「案件落盘长什么样」的权威答案：

| 函数                  | 路径                                     |
| --------------------- | ---------------------------------------- |
| `matterStorageRoot`   | `<workspace>/matters`                    |
| `matterDir`           | `<workspace>/matters/<matterId>`         |
| `matterJsonPath`      | `<matterDir>/matter.json`                |
| `deliverablesDir`     | `<matterDir>/deliverables`               |
| `deliverableJsonPath` | `<deliverablesDir>/<deliverableId>.json` |
| `approvalsJsonlPath`  | `<matterDir>/approvals.jsonl`            |
| `queueJsonlPath`      | `<matterDir>/queue.jsonl`                |
| `deadlinesJsonlPath`  | `<matterDir>/deadlines.jsonl`            |
| `triageDirPath`       | `<matterDir>/triage`                     |
| `campaignDirPath`     | `<matterDir>/campaigns`                  |

后两个的注释标了来源：「Skills E1：分诊会话目录」「Skills E2：审查专案组目录」。

**`deliverableId` 也过同一个正则**——所以交付物 id 也不许带中文。

## 57.3 IO 原语：四个能力

`io.ts` 是这一层的技术核心。它的头部注释列了真相源布局（五个文件），然后实现了四类原语。

### 原语一：原子写 JSON

```text
tmp = `${filePath}.tmp-${Date.now()}-${随机6位}`
写 tmp → renameSync(tmp, filePath)
```

**为什么用 `rename`**：因为它在多数文件系统上是原子的——读者要么看到旧文件，要么看到新文件，不会看到半截。

（第 7.3 节讲过它的局限：**没有 fsync**，所以防得住进程崩溃，防不住掉电。）

### 原语二：JSONL 追加与重写

```text
appendJsonl(filePath, schema, value):
  schema.parse(value)   ← 先校验，不合法直接抛
  mkdir recursive
  appendFileSync(`${JSON.stringify(value)}\n`)

rewriteJsonl(filePath, schema, values):
  逐个 parse（有一个坏就抛）
  拼成 "\n" 结尾的一整块
  tmp + rename
```

**`appendJsonl` 先 parse 再写**——所以「写进去的东西一定是合法的」。

**`rewriteJsonl` 也是 tmp + rename**：整个 JSONL 被重写时也要原子。

### 原语三：容错读 JSONL（这条最容易忽略）

`readJsonl` 的行为**逐行容错**：

```text
文件不存在 → []
空文件 → []
按 /\\r?\\n/ 拆
跳过空行
逐行 JSON.parse + schema.safeParse
  只 push safe.success 的
  parse 抛错 → 注释 "// skip bad line"
```

**关键点**：它 `never throws on bad rows`，而是**跳过坏行返回好行**。

**为什么这样设计**：JSONL 是追加式存储，断电可能留半行。若整份读取因一行坏而失败，一次断电就让人读不了整个审批历史。**跳过坏行是更实用的取舍。**

**代价**：坏行会被静默丢掉。所以如果你看到「审批少了三条」，可能是坏行——而读取本身不会告诉你。

### 原语四：排他文件锁

`withExclusiveFileLock(lockPath, fn, opts)` 的三个默认值：

| 选项        | 默认  | 夹的范围 |
| ----------- | ----- | -------- |
| `timeoutMs` | 5000  | —        |
| `pollMs`    | 5     | ≥1       |
| `staleMs`   | 60000 | ≥1000    |

机制：

```text
fs.openSync(lockPath, "wx")     ← O_EXCL，原子创建
写入 { pid, acquiredAt }
跑 fn()
finally: 关闭 fd + unlink
```

**忙等**（`busy-wait`）而不是阻塞等待，间隔 `pollMs`。

### 陈旧锁的自愈（这是最值得看的一段）

`EEXIST` 时会判「是不是陈旧锁」：

| 判据                         | 说明                                                |
| ---------------------------- | --------------------------------------------------- |
| pid 已死                     | `process.kill(pid, 0)` 抛错算死；**`EPERM` 算活着** |
| `now - acquiredAt > staleMs` | 超时                                                |
| 老格式空锁                   | 按 `mtimeMs` 判                                     |

**「`EPERM` 算活着」这条很细**：在 Unix 上，向别的用户的进程发信号会得到 `EPERM`。那说明**进程存在**（只是你没有权限），所以不能当死锁处理。

接管的方式：

```text
rename 到 `${lockPath}.stale-${pid}-${时间戳}`
unlink 掉那个垃圾文件
打日志：`[LawMind] 自愈接管 stale 文件锁：<路径>`
```

**日志那句是「自愈留痕」**——删了别人的锁要留个字据。

### `readJsonValidated`

```text
文件不存在 → undefined（不是抛错）
否则 schema.parse(JSON.parse(raw))   ← 这里会抛
```

**「不存在」和「坏了」是两种结果**：前者返回 `undefined`（正常情况），后者抛 `ZodError` 或 `SyntaxError`。

## 57.4 会话转录：侧车与修复

`adapters/session-transcript/index.ts` 管两份转录：

```text
<workspace>/sessions/<sessionId>.transcript.jsonl
<workspace>/sessions/delegations/<delegationId>.transcript.jsonl
```

**第二份是委派的独立转录**（第 16 章讲的委派）。

### 行形状

```text
{ kind: "user"|"assistant"|"tool"|"system", content, timestamp,
  toolCalls?, toolCallResponses? }
```

后两个字段**只在非空时才序列化**（省体积）。

**`isTranscriptMessage` 只认三种 role**（`user` / `assistant` / `tool`）——`system` 不算「消息」。

### 修复链

```text
repairTranscriptChain(messages)
  = repairToolCallPairing(normalizeToolResultMessages(messages).messages)
```

**这是第 43 章那套「工具调用必须成对」的复用**：转录的修复和会话的修复走同一个函数。

`repairTranscriptFile` 写完用 `${fp}.repair.tmp` + rename——**修复本身也是原子写**。

## 57.5 Word 版式：为什么这些数字是这样

`docx-legal-typography.ts` 的头部注释列了六条设计参考。值得整段读，因为它解释了「为什么是这些值」：

```text
- 正文字体：中文宋体（SimSun）12pt（小四），黑色；西文可配合 Times New Roman
- 标题：黑体（SimHei）区分层级，主标题居中偏大，章节标题加粗
- 版心：A4 默认，页边距约 1 英寸 / 2.54cm
- 行距：约 1.5 倍行距，段间适度留白
- 正文段落：首行左缩进约 2 个汉字宽（常见的「首行缩进两格」）
```

而且诚实说明了这不是硬标准：

```text
设计参考（行业通用做法，非某一条强制国标）
```

### 十个导出常量的实际值

| 常量                 | 值                | 对应   |
| -------------------- | ----------------- | ------ |
| `LEGAL_BODY_FONT`    | `SimSun`          | 宋体   |
| `LEGAL_HEADING_FONT` | `SimHei`          | 黑体   |
| `LEGAL_LATIN_FONT`   | `Times New Roman` | 西文   |
| `SZ_BODY`            | **24**            | 12pt   |
| `SZ_H1`              | 32                | 16pt   |
| `SZ_H2`              | 28                | 14pt   |
| `SZ_TITLE`           | 44                | 22pt   |
| `SZ_SMALL`           | 21                | 10.5pt |
| `COLOR_TEXT`         | `000000`          | 黑     |
| `COLOR_CITATION`     | `404040`          | 深灰   |

**字号是 half-points**——注释专门写了这个换算：

```text
docx 字号为 half-points：12pt=24，14pt=28，16pt=32，22pt=44
```

**这是 docx 库的约定**，不写下来很容易误以为 24 是 24pt。

### 三个非导出的常量

| 常量                      | 值                       | 含义                |
| ------------------------- | ------------------------ | ------------------- |
| `FIRST_LINE_INDENT_TWIPS` | **480**                  | 首行缩进 2 个汉字宽 |
| `LINE_15`                 | **360**                  | 1.5 倍行距          |
| `PAGE_MARGIN_TWIPS`       | `convertInchesToTwip(1)` | 1 英寸边距          |

**480 twips ≈ 24pt**（1pt = 20 twips），正好是两个 12pt 汉字的宽度。**这个数字是算出来的，不是凑的。**

### 条款与列表的识别

`isListOrClauseLine` 用四条正则判「这行是不是列表/条款」，命中就不加首行缩进（因为已有悬挂缩进）：

```text
^-\s / ^• / ^\*      ← 符号列表
^\d+[\s.)．、]        ← 阿拉伯数字
^[（(][一二三四五六七八九十\d]+[）)]\s+   ← 括号编号
^[一二三四五六七八九十]+[、.]\s*          ← 中文数字编号
```

**这四条覆盖了中文法律文书里常见的四种编号写法**。漏了第四种，「一、」开头的段落会被当成普通正文缩进——看起来会别扭。

### `deliverableTypeHint` 的分支

```text
contract. 开头 → "合同类交付物 / 工作稿"
letter. 开头   → "律师函/函件类 / 工作稿"
其他           → "<类型> / 工作稿"
无类型         → "法律文书 / 工作稿"
```

**每条都带「/ 工作稿」**——这是在文件里标注「这不是终稿」。

### 日期行的格式

```text
成稿日期：<本地日期>  ·  案件：<matterId 或「无」>
```

中间那个 `·` 两侧各两个空格——是排版细节。

### 引用的两种呈现

| 情况   | 用什么                                                                    |
| ------ | ------------------------------------------------------------------------- |
| 有 URL | `paragraphCitationBlockWithLinks`（样式 `Hyperlink`、斜体、深灰、10.5pt） |
| 无 URL | `paragraphCitationBlock`                                                  |

前缀固定 `"参见："`，多条之间用 `；` 分隔、末尾 `。`。

**「参见：」这个措辞对应用户可见规范**——第 24 章讲过，来源在界面上按法律报告体例显示，不显示 `src-1` 这种内部 id。

### 审阅备注

`paragraphReviewNoteItem` 用「•」（圆点加空格）作前缀。注释作者固定写 `"LawMind"`。

## 57.6 普通 Word 渲染

`render-docx.ts` 的头部注释四句话定了四条规则：

```text
- 把 ArtifactDraft 渲染为 .docx 文件
- 不包含任何检索或推理逻辑
- 本地出稿：pending / modified / approved 均可；仅 rejected 拒绝
- 依赖：docx (npm)
```

**第三条是产品规则**（第 8.9 节讲过）：待审、需修改、已批准都能出稿，**只有被驳回的不能出**。

拒绝文案：

```text
文书已驳回（当前状态：<状态>），不能渲染。
```

### 两条路径

| 情况                                             | 做法                                      |
| ------------------------------------------------ | ----------------------------------------- |
| `templateVariant === "uploadedMapped"` 且是 docx | 填上传的模板（走第 58.11 节的占位符机制） |
| 其他                                             | 用 `docx` 库按版式搭                      |

上传模板那条路会先检查文件在不在：

```text
上传的 Word 模板文件不存在或不可读。请在设置中重新登记或恢复模板文件。
```

### 摘要的标题按类型变

| 类型             | 摘要节标题   |
| ---------------- | ------------ |
| `contractReview` | **审查结论** |
| `demandLetter`   | **核心主张** |
| 其他             | 摘要         |

**「审查结论」比「摘要」更贴业务**——这是文案上的一处用心。

### 文档结构（按顺序）

```text
① 标题（居中）
② 元信息行（居中）
③ H1 摘要 + 摘要正文
④ 每节：
     有出处事件 → 用 Word 批注（comment）呈现出处
     否则 → H2 标题 + 正文行 + 引用块
⑤ H1「审阅备注」+ 每条备注
```

**第 ④ 步那个分叉值得注意**：开了 `includeProvenance` 时，出处是**Word 批注**而不是正文——这样律师看到的正文是干净的，出处挂在批注里（可关掉）。

### 文件名

```text
outputFileName 给了 → 用它
否则 → buildDeliverableFilename(draft.title || "文书", ".docx", now, { dirForUniqueness: outputDir })
```

注释专门提了一句：**`Default: 标题_YYYYMMDD_01.docx (never task-id)`**。

## 57.7 修订轨导出：五处技术细节

`render-docx-tracked.ts` 是 `artifacts/` 里最复杂的一个。它的头部注释三句：

```text
Prefers an uploaded contract baseline `.docx` or binary `.doc` when `draft.contractEdit` is set.
Binary `.doc` is first-class: an ephemeral working copy may be used only for OpenXML edits
(never requires the lawyer to convert, and never writes a sibling `.docx` next to the original).
```

### 细节一：officecli 的调用形式

```text
set <file> /body --find … --replace … --prop revision.author=…
```

而正则形式的 find 要用**官方的 `r"..."` 前缀**：

```text
Regex finds use the official `r"..."` prefix on --find (not a separate prop).
(the legacy `docx apply-redlines` subcommand is not available on current CLIs).
```

**括号里那句是给后来者的警告**：老的子命令在当前 CLI 上已经没有了。

### 细节二：从右到左是必须的

`resolveOfficeCliFindReplaceOps` 最后一步：

```ts
return ops.toSorted((a, b) => (b.spanStart ?? 0) - (a.spanStart ?? 0));
```

注释解释了原因：

```text
顺序按从右到左返回：officecli 的歧义锚点用的是 lookbehind（右侧被改前、左侧文字须仍是原文），
从右往左落盘可保证每一处应用时左侧都还没被动过。
```

**第 8.10 节详细讲过这条**，这里只强调：**它是 `lookbehind` 锚定的必然结果，不是风格选择**。

### 细节三：多处命中的「整处回滚」

```text
matched > 1 → 回滚到备份 → 记 `multi_match_skipped:<前30字>`
回滚也失败 → 记 `multi_match_rollback_failed` → 这次导出不算可交付
```

**回滚用的是 `.lm-bak` 备份**（后缀常量）。**「不做部分成功」**在这里是硬规则。

唯一性判定用的文本是 `sectionBodiesBefore ?? sectionBodiesAfter`——**改动前的文本优先**（因为 find 是按原文找的）。

### 细节四：纯插入要「补齐锚点」

```text
pad = 16
```

纯插入（`before` 为空）时会用 16 字的后顾宽度来构造锚点。**这样插入也能落成「锚点替换」的形式**，而不是无中生有。

### 细节五：只读工作副本

```text
chmod(workingDocxPath, 0o644)
```

注释（第 29.8 节详述过）：从 Finder 拷来的 Word 文件常是只读的，officecli 写不进去，结果是「0 处应用」。**而且拷贝前还有一次 chmod**，因为之前失败过的运行可能留了个只读的同名文件。

### 三组常量

| 项             | 值                  |
| -------------- | ------------------- |
| officecli 超时 | 120000 ms           |
| 超时错误码     | `officecli_timeout` |
| kill 信号      | `SIGTERM`           |
| 修订作者默认   | `"LawMind"`         |
| 备份后缀       | `.lm-bak`           |

### 结果对象：成功有十二个字段

```text
outputPath, mode ("officecli" | "plain_fallback"), baselineSource ("contract_file" | "rendered_draft"),
degraded?, appliedHunks?, appliedOps?, minimalSplitHunks?,
conversionTool?, conversionFidelity? ("high" | "lossy"), warning?
```

**`baselineSource` 和 `mode` 是两个不同的轴**：

- `baselineSource` 说「用原件还是渲染稿当底」。
- `mode` 说「成功落了修订轨还是退化成普通渲染」。

### 五种失败码

| 码                        | 什么时候        |
| ------------------------- | --------------- |
| `baseline_prepare_failed` | `.doc` 转写失败 |
| `baseline_missing`        | 要求原件但没有  |
| `plain_render_failed`     | 退化渲染也失败  |
| `tracked_apply_failed`    | 落改失败        |
| `tracked_render_failed`   | 渲染失败        |

### `.doc` 那条有损警告

```text
基线 .doc 仅经 textutil 转写，原有字体/版式/审阅修订可能已丢失；
请安装 Microsoft Word 或 LibreOffice 后重导以保留原格式。
```

**它诚实说明「格式丢了」并给出改进办法**（装 Word 或 LibreOffice）。这是第 32 章那条「不确定就说不确定」的例子。

### 两条「部分成功」的提示

```text
已叠加 N/M 处修订，未应用 K 处
已按最短改动把 N 处拆成多段（只标真正变动的字，没动的字不在修订轨内）。
```

**第二条把「最短改动」这个技术事实讲给律师听**——它解释「为什么这一处改动被拆成了好几段」。

### 清单文件

```text
.<taskId>.redline-manifest.json
```

内容含 `applyResult`（`applied` / `attempted` / `ambiguous` / `lastError`）、`applyStatus`、以及：

```text
openWord: false
```

**引擎永远不会帮你打开 Word**——这条是写死的。

### 四条最终失败的文案

```text
未能在原件副本上写入审阅痕迹：<详情>
未能在原件副本上写入审阅痕迹（请确认本机 officecli 可写该副本；不会用模板重建）。
审阅痕迹写入失败，且未能生成可读的备用稿（…）
导出失败，且未能生成可读的备用稿
```

**括号里那句「不会用模板重建」是一条承诺**：宁可不给稿，也不给一份「重新排版过的假原件」。

## 57.8 PPT 渲染：七套配色

`render-pptx.ts` 的头部注释说明了它的核心选择：

```text
Structured layouts (agenda / bullets / two-column / matrix / checklist)
instead of a single free-floating text box per section.
```

也就是：**不用「一页一个大文本框」那种偷懒做法**，而是按内容选布局。

### 七套模板样式（连同颜色）

| 变体                  | 主色             | 副标题                             |
| --------------------- | ---------------- | ---------------------------------- |
| `hearingStrategy`     | `3b4cca`（蓝）   | Hearing Strategy                   |
| `evidenceTimeline`    | `7a4f15`（棕）   | Evidence Timeline                  |
| `uploadedMapped`      | `1f7a6e`（青绿） | Uploaded Template Mapping          |
| `trainingCle`         | `0f3d5c`（深蓝） | Compliance / CLE Training          |
| `crossborderMatrix`   | `1a4a6b`         | Cross-border Jurisdiction Briefing |
| `internalKnowledge`   | `2c3e50`         | Internal Knowledge Share           |
| `caseClinic`          | `4a3728`         | Case Clinic (Redacted)             |
| 默认（`clientBrief`） | `1a1a1a`         | Client Brief                       |

页脚还会写「Template: <名字>」——**让律师知道用了哪个模板**。

### 统一的尺寸常量

| 元素                             | 值                                      |
| -------------------------------- | --------------------------------------- |
| 幻灯片布局                       | `LAYOUT_16x9`                           |
| 作者                             | `LawMind`                               |
| 标题：x/y/w/h                    | 0.5 / 0.3 / 9 / 0.65，字号 22           |
| 页脚 y / 字号 / 颜色             | 6.85 / 10 / `666666`                    |
| 矩阵：列宽 / 最大行 / 单元格截断 | `min(9/cols, 2.2)` / 8 / 80 字          |
| 双栏：x1/x2/w/y/h                | 0.5 / 5.2 / 4.4 / 1.15 / 5.2            |
| 列表类：x/y/w/h，字号            | 0.7 / 1.2 / 8.6 / 5.3，16               |
| 引用页                           | x 1, y 2, w 8, h 3.5，字号 18，斜体居中 |
| 标题页                           | 标题 32、副标题 14                      |

### 两个「占位兜底」

```text
引用页正文为空 → "（无正文）"
标题正文本页为空 → "（无正文）"
```

**空页给一个明确的占位文案**，而不是空白页——律师一看就知道「这节没内容」而不是「渲染坏了」。

### 审阅备注会变成一页

```text
{ layout: "bullets", heading: "审阅备注", bullets: draft.reviewNotes }
```

**备注进 PPT 而不是丢掉**——虽然 PPT 通常是对外的。

### 命名与拒绝

```text
rejected → `文书已驳回（当前状态：<状态>），不能渲染。`
默认文件名 → buildDeliverableFilename(draft.title || "汇报", ".pptx", now, ...)
```

## 57.9 分页布局的判定顺序（七档）

`pptx-slide-layouts.ts` 的 `parseSectionToSlideContent` 是这一章逻辑最密的一段。**顺序不能换**：

| #   | 条件                                          | 布局        |
| --- | --------------------------------------------- | ----------- |
| ①   | markdown 表格 ≥2 行                           | `matrix`    |
| ②   | 标题含 `议程/大纲/目录/agenda`                | `agenda`    |
| ③   | 标题含 `红旗/行动/清单/checklist/教训/下一步` | `checklist` |
| ④   | 标题含 `脱敏声明/一句话结论/为什么重要`       | `quote`     |
| ⑤   | 要点 ≥ 4 条                                   | `twoColumn` |
| ⑥   | 要点 ≥ 1 条                                   | `bullets`   |
| ⑦   | 其他                                          | `titleBody` |

**为什么表格排第一**：表格是**结构最强**的内容，如果一节里是表格，那它就该是矩阵页，不管标题叫什么。

**为什么 `twoColumn` 在 `bullets` 前面**：≥4 条时双栏更好看；<4 条时单栏更聚焦。

### 表格解析的四条规则

```text
① 行必须首尾都是 |
② 至少 2 行
③ 分隔行（| --- | --- |）丢掉，正则 /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?$/
④ 单元格 trim，空行丢掉
```

### 要点的清洗

```text
剥 `^-*•\s+` 和 `^\d+[.)、]\s*`
丢掉「像表格分隔行」的行（/^\|?\s*-+\s*\|/）
```

### 三个上限

| 项                           | 上限  |
| ---------------------------- | ----- |
| agenda / checklist / bullets | 8 条  |
| matrix                       | 8 行  |
| 单格文字                     | 80 字 |

**双栏的拆分点是**：

```text
Math.ceil(bullets.length / 2)
```

**「多的一侧放前面」**——因为左侧视觉权重更高。

### 复选框前缀

```text
checklist → "☐ "
bullets   → "• "
agenda    → "1." 起编号
```

## 57.10 Word 交付的命名与位置

这一块有三个文件，分工是：

| 文件                         | 管什么                                     |
| ---------------------------- | ------------------------------------------ |
| `matter-word-delivery.ts`    | 案件目录下的命名（`标题_YYYYMMDD_NN.ext`） |
| `word-revision-delivery.ts`  | 修订稿的落点规划（原文件旁边优先）         |
| `default-output-location.ts` | 通用输出位置的六级优先级                   |

### `matter-word-delivery.ts` 的五条规则

**规则一：日期戳**。`formatDeliveryDateStamp` 本地 `YYYYMMDD`；`formatDeliveryTimeStamp` 是 `HHmmss`（用于需要秒级的场景）。

**规则二：词干消毒**。允许的字符集是：

```text
[^\w.\u4e00-\u9fff（）()[\]【】\-—_ +<>《》]
```

注意它**保留了中文标点和书名号**（法律文书里常有《》）。不允许的换成 `_`，连续 `_` 合并，首尾 `_` 与空格去掉。

**规则三：先剥旧日期戳**。正则：

```text
_\d{8}(?:_\d{2})?(?:_\d{6})?$
```

**为什么**：不然「合同_20260901_01」再导一次会变成「合同_20260901_01_20260902_01」。**带三种格式是因为历史版本用过带时分秒的戳。**

**规则四：序号递增到 99**。`Math.min(max + 1, 99)`。找法是遍历目标目录，用正则匹配同词干同日期的文件，取最大序号 +1。

**规则五：词干最长 160 字**，兜底 `"合同"`。

### 案件目录的判定

```text
resolveMatterWorkspaceDir(workspaceDir, matterId)
  → path.join(resolve(workspaceDir), "cases", matterId)
```

`matterId` 校验：空、含 `..`、含 `/`、含 `\` 都抛 `"invalid_matter_id"`。

反向的 `matterIdFromWorkspaceRelativePath` 用正则 `/^cases\/([^/]+)\//`——**它只认 `cases/` 开头**。

### `word-revision-delivery.ts` 的三级落点

头部注释四句话：

```text
Copy the original, write next to the source, name 原名_YYYYMMDD_01.docx.
Never mutates the lawyer's original. Never uses task-id / hash suffixes.
```

**「Never uses task-id / hash suffixes」**是重复强调的规则（第 57.6 节也提过）。

`planTrackedWordDelivery` 的顺序：

```text
① 有基线路径 → 解析出来；可写就放「原文件同目录」
② 否则有案件 → 放 cases/<matterId>/
③ 否则 → <workspace>/artifacts
```

**第 ① 步的「可写」判定**：必须在 `workspaceDir` 或 `projectDir` 内。

兜底文件名 `"合同.docx"`（可用 `fallbackBasename` 覆盖）。

它还有两个正则：`WORD_BASELINE_RE = /\.docx?$/i`（认 `.doc` 与 `.docx`）、`REVISION_STAMP_RE` 与第 57.10 节那个相同。

### `default-output-location.ts`：六级优先级

头部注释把六级列清了，而且给了两点说明。

**第一点：这不是原创，是模仿 Cursor / Codex。**

```text
Mirrors Cursor / Codex, not a global dumpster:
  Cursor — write into the open workspace / next to the related file; never invent a hash dump.
  Codex  — workspace is `--cd` / cwd; user files go in that tree, not $CODEX_HOME.
```

**「not a global dumpster」**这句话很直白：不往一个全局垃圾目录里堆。

**第二点：命名规则重申。**

```text
Filenames are 标题_YYYYMMDD_01.ext — never task-id hashes.
A lawyer-named place is not full-disk write: only Desktop / Downloads / Documents.
```

### 六级（第一匹配者胜）

| 级  | 位置                             | reason                                    |
| --- | -------------------------------- | ----------------------------------------- |
| ①   | 点名的常见位置（桌面/下载/文稿） | `named_place`                             |
| ②   | 显式指定路径                     | `explicit`                                |
| ③   | 源文件旁边                       | `beside_source`                           |
| ④   | 案件目录                         | `matter`                                  |
| ⑤   | 关联项目目录                     | `project`                                 |
| ⑥   | 工作区 `artifacts/`              | `workspace_artifacts` / `workspace_notes` |

### 三条守卫

**守卫一：点名位置只对 `deliverable` 生效。**

```text
kind === "note" → 不走 named_place
```

因为「点名的常见位置」是给交付物用的，不是给笔记用的。

**守卫二：笔记永远不进 `artifacts/`。**

```text
leafDir = kind === "note" ? "notes" : "artifacts"
```

**守卫三：三个写失败的错误文案。**

```text
指定的输出路径不在工作区或已关联项目目录内。
指定的输出目录不可写入。
不能覆盖源文件。请写入新的意见书文档。
```

**第三条（`protectSourcePath`）防的是「把意见书写回原合同」**——这是会毁掉原件的操作。

### `PROJECT_PREFERRED_SUBDIRS`

```ts
PROJECT_PREFERRED_SUBDIRS = ["artifacts", "deliverables"];
```

**项目目录下优先用这两个子目录**（存在才用，否则用项目根）。

### 两个识别函数

```text
DELIVERABLE_FILE_EXT_RE = /\.(docx|pptx|xlsx|md)$/i
isWorkspaceDeliverableRel → artifacts/<x> 或 cases/<id>/artifacts/<x>
```

### 两个默认文件名

| kind          | 默认标题 | 默认扩展名 |
| ------------- | -------- | ---------- |
| `note`        | 工作笔记 | `.md`      |
| `deliverable` | 文书     | `.docx`    |

## 57.11 三个「点名位置」的白名单

`named-user-place.ts` 很小，但它的头部注释把边界说得很清楚：

```text
Lawyer-named well-known folders (桌面 / 下载 / 文稿).
Not a host-mount write grant and not full-disk write. Only these three
directories under the home folder may receive a deliverable when the
compiled delivery intent named them.
```

**三句否定**：不是挂载点写权限、不是全盘写、只有这三个目录。

```ts
PLACE_LEAF = { desktop: "Desktop", downloads: "Downloads", documents: "Documents" };
```

**`isAllowedNamedUserPlaceDir` 会 realpath 之后再比**——所以软链绕不过去。

## 57.12 officecli 在哪：五级查找

`officecli-bin.ts` 的头部注释说明了为什么需要一个「解析器」：

```text
Packaged desktop apps and `pnpm install` vendor a platform build under
`apps/lawmind-desktop/resources/officecli/<platform-arch>/`. Electron injects
`LAWMIND_OFFICECLI`; this resolver is the engine-side fallback for CLI / unpackaged runs.
```

五级顺序：

| #   | 来源                                                      |
| --- | --------------------------------------------------------- |
| ①   | `opts.explicit`                                           |
| ②   | `LAWMIND_OFFICECLI`                                       |
| ③   | `LAWMIND_RESOURCES_PATH` + `/officecli/<平台-架构>/<bin>` |
| ④   | `LAWMIND_REPO_ROOT` + 仓库 vendor 路径                    |
| ⑤   | `opts.cwd` 或 `process.cwd()` 下的 vendor 路径            |

**「Electron 注入环境变量，引擎做兜底」**这个分工值得记：**打包的桌面应用靠注入，CLI 靠查找**。

### 两个平台差异

| 函数                       | 行为                                        |
| -------------------------- | ------------------------------------------- |
| `officecliRuntimeKey`      | `${platform}-${arch}`，比如 `darwin-arm64`  |
| `bundledOfficeCliFileName` | win32 → `officecli.exe`，其他 → `officecli` |

**「存在」的判定**是 `existsSync && !isDirectory()`——**目录不算**（防的是「有个同名目录」这种情况）。

## 57.13 已知坑（本章相关）

- **两套 zod schema 并存，四处差异。** 改数据模型两处都看。
- **`storage` 层的 matterId 正则比 `cases/` 层严**（不许中文）。
- **原子写没有 fsync。** 防进程崩溃，不防掉电。
- **`readJsonl` 跳过坏行不报错。** 所以「少了记录」可能是坏行。
- **文件锁的 `EPERM` 算「进程活着」。**
- **接管陈旧锁会打日志**（自愈留痕）。
- **`readJsonValidated` 对「不存在」返回 `undefined`，对「坏了」抛错。**
- **docx 字号是 half-points**（12pt = 24）。
- **首行缩进 480 twips ≈ 2 个汉字**，不是随便填的。
- **列表识别的四条正则覆盖四种编号写法**，少了第四种会难看。
- **只有「已驳回」的稿子不能渲染。**
- **`includeProvenance` 会把出处放进 Word 批注**，不是正文。
- **修订轨落盘必须从右到左**（lookbehind 锚定）。
- **多处命中整处回滚**，不做部分成功。
- **`.doc` 转写是有损的**，且会如实警告。
- **引擎永远不会自动打开 Word**（`openWord: false`）。
- **「不会用模板重建」是一条承诺。** 宁可不给稿。
- **PPT 布局判定顺序不能换**（表格第一、双栏在单栏前）。
- **PPT 的空页给「（无正文）」占位。**
- **文件名要剥旧日期戳**（否则会叠日期）。
- **笔记永远不进 `artifacts/`。**
- **点名位置只有三个目录，且会 realpath 校验。**
- **`protectSourcePath` 防的是「把意见书写回原合同」。**
