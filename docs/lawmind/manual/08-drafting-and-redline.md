# 第 8 章 改稿、红线与 Word 插件

这一章讲 LawMind 最核心的能力：在一份已经有内容的文稿上，只改该改的地方，并把改动做成 Word 标准的修订轨。法律行业里，这件事做不好，其他都白搭。

## 8.1 问题出在哪

先说清楚要解决什么。

传统做法是「整段重写」：模型读完合同，把某一节重新写一遍，然后告诉你「我改了这几处」。问题有三个：

第一，你分不清它到底改了哪几个字。整段删、整段增，修订轨里一大团红色，真正改动的那个「30 日改 45 日」淹没在里面。

第二，你不知道哪些是它没动的。整段重写意味着每个字都重新生成过一遍，理论上每个字都可能被悄悄改掉。

第三，你没法核对。修订轨的意义就是「改动可见」，整段重写把可见性毁了。

LawMind 的做法是把这件事变成一个**可证明的硬约束**：一处改动里，没动的字必须留在修订轨之外。

## 8.2 最短改动：一条与长度无关的规则

规则就一句话（`docs/lawmind/LAWMIND-MINIMAL-EDITS.md` 的开头）：

> **一处改动里，没动的字必须留在修订轨之外；一句话里只改几个字，就只标那几个字。**

关键在于**判定方式**。它不是「find 太长就拒绝」，而是：

> **违反** = 一处改动内部夹着 ≥ 6 个**连续未改文字**。

代码里的两个常量（`src/lawmind/drafts/minimal-edit-script.ts`）：

```ts
export const MINIMAL_ANCHOR_CHARS = 4; // 认为「这段文字没动」的最短长度
export const MINIMAL_EDIT_MAX_UNCHANGED_RUN = 6; // 一处改动内允许的未改文字上限
```

`MINIMAL_ANCHOR_CHARS = 4` 的注释解释了为什么是 4：

> 低于它的公共片段视为巧合（「的」「甲方」这类），不作为锚点。

也就是说，「的」「甲方」这种两三字的重复不算「没动」，只有 4 个字以上的公共片段才认。

而 `MINIMAL_EDIT_MAX_UNCHANGED_RUN = 6` 是门槛：一处改动内部如果夹了 6 个以上连续没改的字，那就是没最小化。

### 为什么与长度无关

这一点是后来才想明白的，源码里有一条注释专门记录：

> 长度不再是罪名：真把一整句换成另一句（一个共同片段都没有）时，那本来就是一处合法的最短改动，不该被「find 超过 N 字」拦下。

用例子说：

- 你把「甲方应当赔偿乙方损失」改成「乙方应当赔偿甲方损失」——中间「应当赔偿」4 个字没动，4 < 6，**合法**。
- 你把「甲方应当赔偿乙方全部直接经济损失」改成「乙方应当赔偿甲方损失」——中间夹着的未改文字足够长，**违规**，引擎会自动拆。
- 你把「本协议自双方签字之日起生效」整句换成「本协议自双方盖章之日起生效」——只有「本协议自双方」和「之日起生效」是公共片段，中间「签字」改「盖章」是真改动，**合法**。

长度本身不是问题，问题是**改动里夹了多少没改的字**。

## 8.3 算法：摘掉公共片段，剩下的才是真改动

算法思路很朴素，原文抄下来：

> 反复在 (before, after) 里找**最长公共片段**（锚点），锚点即「没动的字」，把它从两侧同时摘掉后对左右两段递归。递归到某一段两侧不再有任何长度 ≥ 4 的公共片段时，那一段就是**真改动**，整段作为一处最短改动输出。

入口函数是 `computeMinimalEditSpans(before, after)`，返回一组 `MinimalChangeSpan`。

这个算法有两条**可证明的性质**（注释里列了）：

1. 构造出的每一处改动内部，都不含任何 ≥ 4 字的未改片段 → 自动满足硬不变量（不需要事后补救）。
2. 把结果按位置回放到 before 上，得到的必然**逐字等于** after。

第二条特别重要：它保证了「拆分」不会改坏内容。拆出来的多段改动回放回去，结果和模型原本想改的完全一样。

有三个防护值：

| 常量                     | 值  | 作用                             |
| ------------------------ | --- | -------------------------------- |
| `ANCHOR_MAX_CHARS`       | 120 | 锚点最长长度                     |
| `ANCHOR_MAX_OCCURRENCES` | 16  | 锚点最多出现次数                 |
| `MAX_SPANS`              | 400 | 极端碎片化保护：超过就合并成一段 |

`MAX_SPANS` 的注释解释了合并的代价：

> 极端碎片化保护：合并为一段（仍然正确，只是保留文字较少）。

也就是说，400 段还是太多，就退化成「一段改动」，正确性不受影响（回放还是等于 after），只是修订轨里保留的未改文字少了。

测试里除了单测，还有一组 **200 组随机对照**：随机生成 before/after，验证「回放=改后文本」且「审计无违规」。这种测试在工程上叫性质测试，比手写用例靠谱得多。

### 审计函数

`auditMinimalEditSpans(params)` 返回 `MinimalEditViolation` 列表。它是后面几个边界共用的检查器。

规则文本的**权威版本**是 `CONTRACT_REDLINE_CRAFT_SKILL`（`src/lawmind/drafts/contract-redline-craft.ts`）——它是一段代码常量，会被注入到合同改稿的 agent 上下文里：

```text
最短改动（硬约束）：只把真正变动的字标成删除/新增，中间没动的字不得包进改动里；
一句话里改几个字就只改那几个字。引擎会按此重算，不接受整句删写。
```

规则文本的单行版 `MINIMAL_EDIT_RULE_LINE` 由 `CONTRACT_REDLINE_CRAFT_SKILL` **原样引用**，门槛数字用同一个 `MINIMAL_EDIT_MAX_UNCHANGED_RUN`。改口径改常量，技能正文会跟着变。`MINIMAL_EDIT_RULE_TEXT` 仍是展开说明，给文档对照，不另写一份进提示词的数字。

```text
判定门槛：一处改动内若夹了 ≥6 个连续未改文字，即视为未最小化，会被自动拆分。
```

## 8.4 五个落槌边界

「落槌」是指改动真正落到某个地方。有五个地方，都用同一套算法：

| 边界             | 位置                                                                                 | 干什么                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **B1 模型输入**  | `drafts/apply-surgical-edits.ts`                                                     | 收到 find/replace 就重算最短改动。同一 find 命中多处且未声明 `occurrences: "all"` 时整条跳过，不改第一处 |
| **B2 hunk 生成** | `drafts/redline-proposal.ts` → `drafts/surgical-diff.ts` 的 `splitSurgicalEditSpans` | 生成修订提案时出最短 span                                                                                |
| **B3 文件落盘**  | `artifacts/render-docx-tracked.ts` 的 `resolveOfficeCliFindReplaceOps`               | 写进 .docx 的最后一道                                                                                    |
| **B4 Word 插件** | `integrations/word-addin/review-requests.ts` 的 `hunksFromRedlineProposal`           | 插件在 Word 里就地落改                                                                                   |
| **B5 成品复核**  | `drafts/tracked-xml-qa.ts` 的 `qaTrackedDocxXml`                                     | **唯一看落盘文件**的一道                                                                                 |

B1–B4 管的是「要写什么」，B5 管的是「实际写成了什么」。文档里有一句话点明了这个分工：

> B1–B4 作用在「要写什么」上；**B5 是唯一看落盘文件的**。

B4 的处理最特别：纯插入会被改写成「插入点之后 6 字锚点整体替换」，**一个字都不删**。因为 Word 插件里的插入操作没有「删除」可用，只能借锚点替换来实现。

## 8.5 律师侧：改稿工作面怎么用

改稿工作面（视图 id `review`，界面标题「改稿」）是三栏结构：

- **左栏：元信息**。验收门、独立审稿结论、出处、模板、审查专案组。
- **中栏：正文编辑区**。可编辑（像 Cursor 的文档栏），改完能存。
- **右栏：预览**。只读排版视图，和编辑区左右对照，可以拖出去独立开窗。

三栏的显隐状态会**记住**（localStorage 键 `lawmind.ui.reviewPaneMeta` / `reviewPaneEditor` / `reviewPanePreview`），默认是元信息收起、编辑区和预览打开。有一条保护：**不允许三栏全关**（`hasVisibleReviewPaneAfter`）。

正式的三个动作——通过、驳回、需修改——主路径在「在办」，不在改稿面。改稿面保留的是「必核清单走完之后的兜底签批」。这个分工在 `ReviewWorkbench.tsx` 的头部注释里写明了。

### 红线面板

`LawmindRedlinePanel.tsx` 处理修订提案（hunk）。每个 hunk 有三个状态：`pending`、`accepted`、`rejected`，还有粒度字段 `granularity: "surgical" | "section"`。

界面上有四个动作：接受单个、拒绝单个、全部处理（resolve-all）、以及「重置基线」（baseline）。第四个项目比较少见，解释一下：如果你手动改了正文，原来的红线基线就对不上了，这个按钮把基线重置成当前正文。

Surgical 类型的 hunk 会显示上下文——`SURGICAL_CONTEXT_CHARS = 30`，也就是前后各 30 字，让你看清改在哪儿。

## 8.6 草稿存在哪

草稿在 `workspace/drafts/`，主文件是 `drafts/<taskId>.json`（只经 `commitDraft` 原子写）。通用写文件、文件页和脚本沙箱写不进 `drafts/`；改已有稿用 `update_draft`。

另外有一堆**侧车文件**（sidecar），都是同名不同后缀：

| 文件                                | 内容         |
| ----------------------------------- | ------------ |
| `drafts/<taskId>.json`              | 草稿本体     |
| `drafts/<taskId>.redline.json`      | 修订提案     |
| `drafts/<taskId>.redline-plan.json` | 修订计划     |
| `drafts/<taskId>.research.json`     | 检索快照     |
| `drafts/<taskId>.reasoning.json`    | 推理快照     |
| `drafts/<taskId>.clauses.json`      | 条款快照     |
| `drafts/<taskId>.guardian.json`     | 独立审稿记录 |
| `drafts/<taskId>.outline.json`      | 大纲         |
| `drafts/<taskId>.completion.json`   | 交付完成记录 |
| `drafts/<taskId>.redline.json.lock` | 修订提案锁   |

`listDrafts` **会排除**这些侧车，只列本体。`deleteDraft` 删本体，并删 `listDrafts` 排除的侧车：`research`、`reasoning`、`redline`、`redline-plan`、`clauses`、`guardian`、`outline`、`completion`，外加 `redline.json.lock`。修订计划必须一起删——否则下一次空的 `apply_surgical_edits` 会把已删草稿的计划又落回去。

## 8.7 修订提案：hunk 是怎么长出来的

`redline-proposal.ts` 里的结构：

```ts
type RedlineHunk = {
  hunkId;
  sectionIndex;
  sectionHeading?;
  before;
  after;
  rationale?;
  status: "pending" | "accepted" | "rejected";
  spanStart?;
  spanEnd?;
  granularity?: "surgical" | "section";
};
```

`RedlineProposal` 装的是 `baselineSections`（基线正文）和 `hunks` 两部分。基线很重要：hunk 的 `before` 是相对基线说的，不是相对当前正文。所以手动改了正文之后要重置基线。

单份正文和跨文书用同一条歧义规则：同一 `find` 命中多处、又没写 `occurrences: "all"`，**整条跳过，不改第一处**。Cursor / Codex 的补丁也是这样——上下文不唯一就失败，不猜第一处。当事人名统一替换显式传 `all`，引擎从右往左落，避免下标被左边的替换挤歪。某一处对不上原文时，这一条整处回滚，不做「其余处已落」。

提案文件有排他锁（`<redline.json>.lock`），注释说明锁的范围：

> 排他锁包住「读提案 → 改正文/baseline → 写提案」整段，避免并行 accept/reject 互踩。

### 空修订不许导出

有一条硬门禁（`tracked-render-hunk-gate.ts`）：

```ts
export const MIN_TRACKED_RENDER_HUNKS = 1;
```

它的目的是防「格式正确但零改动的假完成」。注释原话：

> Prevents 'format-correct but zero lawyer edits' fake completion.

拦下时的文案：

```text
合同审阅稿尚无待叠加修订（redline hunks=N，至少需要 1）。…禁止仅写 summary 后空修订导出。
```

这条在 Word 插件的提示词里也强调了一遍：`redlinePending=0` 不得导出。

### 那些被跳过的

不是每个 hunk 都能落地。跳过的原因会**如实记录**（`plan.skipped`），常见的有：原文找不到、需要收窄、碎片化。

这里还有一处口径修正的注释，值得看：

> 落改未采纳的条数：最短改动由引擎重算，落不下的原因改为「原文找不到 / 待收窄 / 碎片化」等，不能再只认「跨度硬门禁」这一种（那会让审稿员看不到真实的漏改）。

也就是说，早先只统计「因为跨度太宽被拒」的条数，结果漏改了也看不出来。现在按真实原因统计。

## 8.8 跨文书一致改

场景：一批文书里都要把「甲方」改成「买方」，或者当事人在十份文件里都得改名。

工具是 `apply_surgical_edits({ task_ids, edits })`，实现在 `src/lawmind/drafts/cross-document-edits.ts`。它有条硬规则：

> **先全批预检，再动笔。** 任一份出现「同一锚点多点命中且未声明统一替换」或跨度超硬门禁 → **整批停、零写入**。

注意是「整批停、零写入」，不是「能改的先改」。原因很实在：如果一份文书只改了一半，你会得到一个前后不一致的文书集，比全都不改更麻烦。

拦下时的报错会告诉模型怎么自己解决：

```text
锚点在多份文书里多处命中，未确定改哪一处：…。若确为当事人名/术语统一替换，
请对该条显式传 occurrences: "all" 后整批重来（本次未写入任何文书）。
```

也就是说，模型可以自己加 `occurrences: "all"` 重试，**不需要律师仲裁**。单份草稿（第 8.7 节）现在是同一句报错、同一种补救，不再只在跨文书上拦。

另一条规则：**找不到锚点不算错**。某份文书里根本没有那段原文，就如实记进变更清单，不报错。注释原话：「本模块不碰文件系统：规划与落笔都是纯函数，持久化与 Redline 由调用方负责。」

变更清单落在 `drafts/<batchId>.cross-document.json`。

## 8.9 导出 Word：三条路径

导出走 `src/lawmind/artifacts/render-docx-tracked.ts`，用随包的 officecli 落修订轨。三条路径：

**路径一：有上传的原合同**（`contract_file`）。这是合同审阅的正常路径：拷一份原件的副本，在副本上落改，输出到源文件同目录。**原件一个字节都不动**。源码注释明确：「never writes a sibling .docx next to the original」——不会在原件旁边生成一个转换过的 .docx。

**路径二：没有原件**（`rendered_draft`）。从草稿渲染一份，然后落改。这条路径会退化（`degraded`），因为排版是重新生成的。

**路径三：普通渲染**（不带修订轨）。走 `render-docx.ts`，跟审阅状态有关：

- `pending`（待审）、`modified`（需修改）、`approved`（已批准）都可以渲染。
- **只有 `rejected`（已驳回）拒绝渲染**，报错：`文书已驳回（当前状态：xxx），不能渲染。`

也就是说，未审的稿子可以出个草稿看，但被驳回的稿子不许出。

### 二进制 .doc 是一等公民

这条挺少见：老的 `.doc` 格式不需要先转成 `.docx`。代码里能直接处理。但转写会经过 `textutil`，会丢格式，所以会带一条警告：

```text
基线 .doc 仅经 textutil 转写，原有字体/版式/审阅修订可能已丢失；
请安装 Microsoft Word 或 LibreOffice 后重导以保留原格式。
```

诚实地告诉你格式丢了，而不是假装没丢。

## 8.10 落盘为什么必须从右到左

这是实现里最容易被忽略、但错了就出 bug 的一处。

officecli 在处理「同一个词在文档里出现多次」时，用的是**后顾锚点**（lookbehind）。后顾的意思是：确认这段文字前面是什么，才能定位到唯一一处。

如果从左往右落改，改完左边那处之后，右边那处的后顾条件可能已经被破坏了。

所以 `resolveOfficeCliFindReplaceOps` 的注释写：

> 顺序按**从右到左**返回：officecli 的歧义锚点用的是 lookbehind（右侧被改前、左侧文字须仍是原文），从右往左落盘可保证每一处应用时左侧都还没被动过。

排序代码就一行：

```ts
ops.toSorted((a, b) => (b.spanStart ?? 0) - (a.spanStart ?? 0));
```

### 歧义就整处跳过，不做部分成功

如果一段 find 在文档里出现在多个地方，且没法用锚点区分，处理方式是：

```text
多处命中：该 hunk 整处跳过并明示（不得交付多处替换稿）。
```

跳过时会记 `multi_match_skipped:<前30字>`，并且**整处回滚**。回滚也失败的话（`multi_match_rollback_failed`），这次导出**不算可交付**。

宁可不出稿，也不出一份「悄悄改了好几处」的稿。这条底线在代码里守得很死。

### 只读工作副本的坑

有一段注释记了真机踩到的故障：

> Project / Finder Word files are often copied as read-only; officecli cannot persist w:ins/w:del onto a 0444 working copy (io_error → 0 applied).

从 Finder 拷过来的文件经常是只读的（权限 0444），officecli 写不进去，结果是「0 处应用」——看起来成功，实际什么都没改。修法是落改前 `chmod 0o644`，而且拷贝前还有一次（因为之前失败过的运行可能留了个只读的同名文件）。

### 时间与作者

officecli 超时设的是 120 秒。修订作者默认写 `"LawMind"`。设置 → 外观里的「修订署名」写了名字后，导出改用那个名字（仍通过 `--prop revision.author=` 写入）。

### 回执清单

每次导出会在产物旁边写一份清单文件 `.<taskId>.redline-manifest.json`，包含：

- `applyResult`：`{applied, attempted, ambiguous, lastError}`
- `applyStatus`：比如 `"ambiguous"`
- `openWord: false`

`openWord: false` 是个明确的决定，源码注释写着：

> Explicit: engine must never shell-open Word; lawyer opens the file.

**引擎永远不会帮你打开 Word**，你自己打开。这样才不会出现「桌面上突然弹出一堆窗口」。

## 8.11 B5：对着落盘文件再核一遍

前面四道边界管的是「要写什么」，难免有意外。所以最后有一道**成品复核**：读实际的 .docx，看 `w:del` 和 `w:ins` 标签。

`qaTrackedDocxXml(filePath, expectedHunks)` 做两件事：

1. 数有几处 `w:ins` 和 `w:del`。
2. 找出「整句删 + 整句增」的配对。

配对判定的三个门槛：

| 常量                         | 值  | 含义                     |
| ---------------------------- | --- | ------------------------ |
| `XML_PAIR_MIN_SIDE_CHARS`    | 12  | 两侧至少 12 字才判       |
| `XML_PAIR_MIN_UNCHANGED_RUN` | 8   | 共有未改文字 ≥ 8 字      |
| `XML_PAIR_MIN_SHARED_RATIO`  | 0.6 | 共有文字占较短一侧 ≥ 60% |

为什么这里用 8 而不是前面那个 6？注释解释得很清楚：

> 为什么不是直接用 `MINIMAL_EDIT_MAX_UNCHANGED_RUN`(6)：officecli 可能把一处替换切成多个 w:del/w:ins 片段，相邻片段未必属于同一对。要在**文件级**下断言，门槛必须收到「几乎不可能是巧合」的量级。

在文件级下结论比在内存里下结论风险更高（因为看不到配对关系），所以门槛要更严。

复核失败时的两种警告：

```text
已报叠加修订，但 XML 未见 w:ins/w:del。不要当红线已落盘。
收窄 find 后重跑 apply_surgical_edits 再导出。
```

```text
导出的修订轨里有 N 处「整句删+整句增」…
```

前者对应的错误码是 `xml_qa_no_tracks`，后者是 `xml_qa_non_minimal_edits`。

### 自动重试一次

`xml-qa-auto-retry.ts` 会在 XML 复核发现「没有修订轨」时，把计划**收窄一次**再重跑。

`shouldAutoRetryXmlQa` 决定要不要重试，`applyNarrowedPlanOnce` 执行收窄。这条重试在三条路径上都生效：解锁的合同审查、邮件短路径、Word 改稿锁定。

## 8.12 输出到哪个文件夹

这个决定顺序写在 `default-output-location.ts` 的头部，**第一个匹配的赢**：

```text
1. 律师点名的常见文件夹（桌面 / 下载 / 文稿）
2. 显式指定的路径或目录
3. 这份交付物所依据的源文件旁边
4. 当前案件的 cases/<matterId>/artifacts/
5. 已关联的项目目录
6. 工作区 artifacts/（最后的兜底）
```

几点说明：

- **「点名的三个文件夹」是白名单**，只有 `Desktop`、`Downloads`、`Documents` 三个（`PLACE_LEAF`）。这不是本机挂载的写权限，更不是全盘写。注释写得很直白：

> Not a host-mount write grant and not full-disk write.

- 这个「点名」来自意图编译的交付意图（第 4 章）。你说「写到桌面」，才会有第 1 条。
- **来源文件旁边优先于案件目录**。如果你在研究某个文件时产出了新文档，它会放在那个文件旁边，而不是案件目录里。
- **笔记类（note）永远不进 `artifacts/`**。注释说明了原因：`so write_document cannot bypass draft gates`。也就是说，普通文件写入不能绕过交付物的门禁。
- 不许覆盖源文件，试了会报：`不能覆盖源文件。请写入新的意见书文档。`
- 逃出工作区和项目目录的路径会被拒：`指定的输出路径不在工作区或已关联项目目录内。`

### 文件命名

默认名字是「标题_YYYYMMDD_01」，冲突就递增到 02。命名规则在 `matter-word-delivery.ts`：

- 保留原标题的词干，加日期戳。
- 会先剥掉**之前加过的**日期戳（正则 `_\d{8}(?:_\d{2})?(?:_\d{6})?$`），避免出现「合同_20260901_01_20260902_01」。
- 词干最长 160 字。
- 序号最大 99。
- **不用任务哈希做文件名**。这是明确的取舍：哈希名对人没意义。

## 8.13 Word 插件：把审查搬进 Word

这一节讲的是引擎怎么取件、怎么把最短改动变成锚点。**律师侧的加载项还是半成品**，不能按「已经能在 Word / WPS 里审」来用。没做完的验收、以及还要提供的证书、真机和标准名字，写在 [LAWMIND-WORD-ADDIN.md](../LAWMIND-WORD-ADDIN.md) 开头的「现状：半成品」。

场景：你在 Word 里看一份合同，不想切出去。窗格里是一个输入框，默认「按本所标准审这份」。跑完是逐条建议；点写入之后才在正文里成为修订。WPS 走同一套输入框，落修订的接口不同，而且还没在真机上验收。

对话中间栏打开 `.docx` 时是**正文预览**：按打开的文件画段落，有修订提案时仍以这份文件为准，不用另一份底稿盖住它。可以在预览里接受、拒绝或手改。只有已接受的修改才会导出到旁边一份稿；没决定的不写入，原件不动。预览不是终稿，也不是 Word / WPS 里的修订轨。加载项按上面的验收做完之前，律师路径以这一页预览为准，不要把加载项写成已经能审。

### 玩法

侧载插件后（`apps/lawmind-desktop/resources/word-addin/`），Word 里应出现一个任务窗格。点「开始」之后：

1. 插件向本机服务发一个请求（`POST /api/word-addin/reviews`）。
2. **桌面端自动跑这次审查**——律师不需要回桌面端点一次。
3. 跑完后结果回填成逐条建议。律师点「写入这一处」或「全部写入」之后，才把修订落进当前文档。整节重写不落，窗格写「整节重写已放到桌面稿」。

第 2 步是这整套设计的关键，文档里专门有一节解释「为什么这里可以自动跑」，还修正了此前文档的说法。原因是：`toolRequiresExplicitApproval` 只对 `toolRequiresLawyerPause` 命中的工具返回 true，而那只包含 `send_email`。所以插件里的 `apply_surgical_edits` 和 `render_tracked_draft` 本来就不需要额外弹出确认。

### 三条不许破的线

插件代码的头部注释列了三条：

1. **只落本机**。所有通信走回环地址，数据存 `workspace/lawmind/word-addin/reviews.json`，不上传。
2. **无插件零影响**。没装插件时桌面路径完全不受影响。
3. **只有最短锚点能变成 Word 就地修改**。整节重写不上插件。

第 3 条是硬规则。`hunksFromRedlineProposal` 的注释：

> 硬不变量（最短改动）：**不**照抄 hunk 的粒度——历史 section hunk 的 before/after 可能是整节，直接塞给插件就会变成整节删+整节增。

处理方式：最短改动重算之后，真替换都交给 Word，不按字数丢进 `skippedSectionHunks`。文末插入直接跳过——「插件不猜位置」。

### 请求状态机

七个状态：

| 状态           | 含义                             |
| -------------- | -------------------------------- |
| `queued`       | 排队等跑                         |
| `running`      | 正在跑                           |
| `ready`        | 完成，可取件                     |
| `failed`       | 失败                             |
| `stale`        | 文件在点击后被改过               |
| `superseded`   | 同文件重复点击，被更新的那条取代 |
| `needs_matter` | 旧状态，见下                     |

`stale` 的判定值得说：取件时会**重算文件指纹**。2 MiB 以内哈希整文件；更大则取头 128 KiB 加尾 64 KiB，再加总字节数。Word 保存会改包尾的 `core.xml`，只哈希文件头会把文末条款的改动当成没变过，然后用旧基线出稿。和点击时记录的不一致就转 `stale`，提示：

```text
这份 Word 在你点「审这份」之后已被改动。为免用旧基线出稿，请重新点一次「审这份」。
```

`needs_matter` 是个**旧状态**：早先路径对不到唯一案卷时会停下来等你选案卷，现在改成 ad-hoc 直跑，不再用这个状态拦人。

### 折叠重复点击

真机实测律师会连点「审这份」。不折叠的后果是 N 倍模型开销——注释里写着「花两次模型钱（真机实测复现）」。

折叠规则：

- 创建时折叠同文件同指令，窗口 10 分钟（`WORD_ADDIN_DEDUPE_WINDOW_MS`）。
- 取件时再折一次同口径的 `queued`。
- **绝不折叠 `running`**。

还有一处真机踩到的细节：`pickWordAddinReviewForDocument` 优先返回最新的 `ready`，只有没有 `ready` 才返回最新那条。注释解释：

> 刚排队的空请求不该把已经拿到手的修订轨盖住（真机实测踩到）

也就是说，你拿到结果之后手滑又点了一次，新排队的空请求不该把刚拿到的结果顶掉。

### 孤儿清理

如果一次运行卡住了（进程重启、任务记录丢了），30 分钟后（`WORD_ADDIN_RUN_ORPHAN_MS = 30 * 60 * 1000`）会被如实标成 `failed`，而不是永远显示「运行中」。

错误文案是人话，`humanizeWordAddinJobError` 的映射表：

| 内部错误                    | 给律师的话                               |
| --------------------------- | ---------------------------------------- |
| `interrupted_by_restart`    | 桌面端中途重启过，这次审查被中断         |
| `cancelled_by_user`         | 你取消了这次审查                         |
| `missing_workflow_snapshot` | 任务记录不完整（缺少流程定义），请重试   |
| `source_file_missing`       | 源文件已被移动或删除                     |
| `enqueue_unavailable`       | 桌面端尚未就绪（模型或工作流入队不可用） |

还有一条排查经验写在注释里，很值钱：

> 真机实测这条最常见的真因是**模型调用失败**（如 key 失效 401）——引擎会把「本轮模型调用失败：…」当成一次成功的步骤结果，job 状态仍是 completed。所以这里不能只写「降级导出」那一类原因，否则窗格会把人往错方向带。

### 授权留痕

取件时会写一条 `authorization` 记录（**不是**独立审计事件，而是请求对象上的字段）：

```ts
type WordAddinRunAuthorization = {
  at;
  actorId;
  clientId;
  sourcePath;
  sourceHash;
  grantedDir;
  matterId;
  instruction;
};
```

也就是：谁、什么时候、点了哪个文件、点击时的内容指纹、授予了哪个本机目录、记到哪个案卷、指令是什么。

工作区外的文件会**临时**授予源目录（仅本次运行）。这是「本机文件夹默认不能改写」原则的一个受控例外。

### 开关与档位

`wordAddinAutoRun` 这个功能：**solo 默认开，firm / private_deploy 默认关**。

firm 档默认关的理由是保留「桌面端必须有一次显式动作」这个档位。可以用 `lawmind.policy.json` 的 `wordAddinAutoRun` 覆盖——但注意注释里的坑：**policy 文件必须带 `schemaVersion: 1`，否则整份文件会被忽略**。

### 真机踩过的两个坑

都记在 `docs/lawmind/LAWMIND-WORD-ADDIN.md` 里：

**坑一：CSP 拦掉内联脚本。**

> 凭据**不能写在页面里的内联 `<script>`**——Word 任务窗格启用 CSP，`script-src` 会把内联脚本拦掉，结果就是 base 与凭据都为空、所有请求 401（2026-09-20 真机实测踩到）。

修法是同源提供一个 `config.js`。

**坑二：localhost 和 127.0.0.1 不是一回事。**

> **一定要用 `localhost` 取清单**，不要用 `127.0.0.1`

因为 `localhost` 会先解析到 `::1`（IPv6），而本机服务原先只绑了 IPv4，那条路是死的。现在服务同时绑 IPv4 和 IPv6。

端口漂移也会误导人，文档里描述得很形象：

> 现场表现会误导人——先是窗格报 `unauthorized`（持有派生改造之前的旧凭据），服务换端口后变成 `Load failed`（网络错误）。两者都看不出真因。

所以本机端口是**持久化**的：`desktop-config.json` 里存着 `apiPort`，尽量复用，就是为了让侧载的 manifest 一直能找到服务。

### Word.js 是队列式 API

还有一条实现细节，不写清楚后人一定踩：

> **Word.js 是队列式 API**：属性/集合必须先 `load()` + `context.sync()` 才能读（不 load 就走，Word 会直接抛「属性…不可用」——真机实测踩过一次）。

落改的顺序是固定的：

```text
load 修订轨设置 → sync → 打开修订轨 → sync
→ 逐个锚点 search/load/sync → 恢复律师原本的修订轨设置 → sync
```

**恢复律师原本的修订轨设置**这一步很容易漏。你不能改完就走人，把律师的 Word 设置改了——那是越界。

## 8.14 独立审稿与修订稿的档位

LawMind 有一个**独立审稿人**（Guardian），它在**另一个会话**里跑，不看写稿的过程，只看成品的有限证据，给出通过/不通过加缺口清单。

它什么时候跑？判定在 `shouldRunLegalGuardianForDocument`：

```ts
const DOCUMENT_GUARDIAN_EXACT = new Set(["memo.opinion", "memo.research", "contract.review"]);

if (draft.contractEdit) return false; // 修订稿不跑
// 交付物类型是上面三个之一，或者以 letter. / litigation. 开头 → 跑
```

注意第一行：**`contractEdit`（带修订轨的合同稿）直接豁免**。道理是修订稿不是最终交付物，真正的把关在「外发」那一步。

### 修订稿的三个档

但「豁免」不等于「随便」。修订稿有自己的档位（`resolveGuardianTrackedRedlinePosture`），解析顺序是三层：

1. policy 里的 `guardianTrackedRedline`（显式 `block` / `advisory`）
2. 环境变量 `LAWMIND_GUARDIAN_TRACKED_REDLINE`（显式 `block` / `advisory`）
3. edition 缺省 `guardianTrackedRedlineBlock`：**solo 关 → advisory；firm / private_deploy 开 → block**

两个档的区别：

- `advisory`：审稿照跑，缺口如实地随结果交给你，但**不拦住出稿**。
- `block`：审稿不过就不出稿。律所级硬墙。

为什么 solo 默认 `advisory`？`GOALS.md` 里有解释，大意是：solo 档如果把修订稿按 `block` 处理，整条无人值守改稿会在「审稿 2 轮未过」处断掉，律师只看到「没有结果」。而律所档保留硬墙，因为那边「未过独立审稿的稿子流出去」代价更高。

注意未知取值（包括拼写错误）会**回落**到 edition 缺省。所以 `guardianTrackedRedline: "BlOcK"` 这种不会报错，而是按档位处理。

### 审稿的证据包是代码装的，不是写手给的

有一条注释很关键：

> Bounded evidence pack. Assembled by code, not by the writer. Must not include writer self-scores (craft_check.coverage).

也就是说，给审稿人的证据里**不包含写稿模型自己给自己打的分**。这防的是「自己给自己打分说自己过了」。

证据包不再按条数丢掉修订、章节、争点、核对项或引用。单条文字仍截断（改动前后各 400 字、章节 800 字），避免一条超长段落撑爆窗口；条数本身不是拒绝线。

### 判定由代码聚合

审稿模型只给**逐项判定**，最终结论由代码聚合（`aggregateGuardianItems`）。有一条 fail-closed 的纪律：

> 注意第 2 条：**缺答即 fail**…这是 fail-closed。

模型漏答一项，不能当成「没问题」，而是当成「不通过」。这个方向是对的：漏答是不确定，不确定不该放行。

### 机械验证器

有些判断不该交给模型，交给代码（`machine-verifiers.ts`）。现有的验证器 id 有：`forum.form_valid`、`citations.subset`、`citations.used`、`graph.authority_used`、`parties.consistent`、`amounts.case_consistent`、`dates.ordered`、`placeholders.closed`、`statute.lpr_multiple`、`statute.deposit_cap`、`guarantee.form_valid`，以及 `disputeFormVerifier()`。

未知验证器或抛错 → 该项记 `unavailable`（fail-closed），**不静默丢弃**。

### 判定分级表

一张 150 项的判定表（`item-judgments.ts`）决定每一项由谁判：

| 级别      | 谁判       |
| --------- | ---------- |
| `machine` | 代码验证器 |
| `judge`   | 审稿模型   |
| `lawyer`  | 律师       |

其中 125 项来自 Word 改稿清单，25 项来自验收清单（`EXPECTED_TOTAL_ITEMS = 150`）。

分级解析的三条 fail-closed 纪律：

1. 键不在表里 → 当成 `judge`，并记警告。
2. 表里是 `machine` 但缺验证器 → 退成 `judge`，并记警告。
3. 表里是 `lawyer` 但缺 `lawyerReason` → **保留 `lawyer`**（往安全方向退），记警告。

### 缓存

审稿结果按证据包的哈希缓存（`shouldReuseGuardianRecord`）。三种情况**不**复用：

- 没有哈希或哈希不同。
- 结论是 `skipped`（注释：`Disabled / no_model must not cache-block a later usable model`——这次没跑成，不能因此挡住下次）。
- 基础设施失败（`isInfraGuardianFail`）。

只有 `pass` 和 `fail` 才缓存。这条设计避免了「上次模型抽风失败，这次明明配好了还复用失败结论」。

审稿记录存在 `drafts/<taskId>.guardian.json`，最多保留 6 轮（`MAX_STORED_ROUNDS`）。头部注释一句：

> Guardian sidecar — audit only. Never injected into the writer session.

**审稿记录不进写手的会话**。写手看不到审稿人的评语，避免它「针对性地辩解」而不是改进。

有一个隐患也写在注释里：

存档时律师可见面仍按 `slimGuardianView` 收成结论和缺口，审稿原文截到 4000 字。其余字段（证据哈希、待定夺项，以及以后加在 `GuardianRecord` 上的字段）随记录一起落盘。以前这里是手写白名单，漏加一列就会静默丢掉待定夺项。

## 8.15 术语自适应：一份文书不许两套称谓

这条针对一个很常见的问题：从先例库里拿来的段落，里面的当事人叫「甲方乙方」，而你这份文书里叫「买受人出卖人」。直接粘进去，一份文书里就有两套称谓了。

`terminology-adapt.ts` 分三层：

**第一层：抽表。** `extractDefinedTerms` 从文书里认三种定义形式：

- 引号定义：`"XX"系指...`（动词有 `系指|是指|指|即为|即|为`）
- 括号别名：`XX（以下简称YY）`
- 角色词：一份 27 个词的清单（`CONTRACT_ROLE_WORDS`），涵盖甲方乙方丙方丁方、买方卖方、需方供方、发包人承包人、出租人承租人、出卖人买受人、委托方受托方、许可方被许可方、披露方接收方、出借人借款人、保证人、服务方、供应方、采购方。

**第二层：对齐。** `alignTerminology` 做确定性替换。

**第三层：兜底。** 检测漂移（`detectTerminologyDrift`），报出还没映射的外来叫法。警告文案：

```text
本次写入出现本文未定义的当事人叫法：请改用本文已定义术语（或用 search_precedents 的 term_map 对齐）后再导出，避免一份文书里两套称谓。
```

也就是说，对齐不了的会**报出来**，不会默默放过。

## 8.16 出处与受众

### 出处链

每个段落带一条「它是怎么变成现在这样的」记录（`provenance.ts`）。事件类型八种：`upload`、`extraction`、`ai_suggest`、`lawyer_edit`、`lawyer_accept`、`self_revise`、`import`、`export`。

作用者三种：`user`、`model`、`system`。

界面上有个小标记（`LawmindProvenanceIndicator.tsx`）。两个查询函数挺有用：`isUserModifiedProvenance`（这段律师动过）和 `isAiGeneratedProvenance`（这段是模型写的，律师没看过）。

### 对内外之分

`audience-split.ts` 处理「对内底稿不等于对外稿」。

受众三种：`internal`、`client`、`court`。

判定用正则：诉讼类文档（起诉状、答辩状、代理词、呈请法院、此致某人民法院）→ `court`；提到给客户、发给客户、给对方律师的 → `client`。

适用的能力有七个（`letter.draft`、`litigation.draft`、`materials.draft`、`contract.review`、`contract.draft`、`research.memo`、`litigation.talk`），但在**修订轨路径和邮件短路径上排除**——因为那两条路径有自己的交付口径。

头部注释还有一句：「Never blocks.」这一层只是注入提示，不硬拦。

### 未核验标注

`source-boundary.ts` 给意见书和研究备忘加了「已核验 / 未核验 / 缺口」三类栏目，是防编造用的。注释同样强调「Never blocks」，而且修订轨路径不用这套。

## 8.17 HTTP 端点

### 修订提案

| 端点                                                | 方法 | 说明                                |
| --------------------------------------------------- | ---- | ----------------------------------- |
| `/api/drafts/:taskId/redline`                       | GET  | 读提案                              |
| `/api/drafts/:taskId/redline/generate`              | POST | 生成提案                            |
| `/api/drafts/:taskId/redline/hunks/:hunkId/resolve` | POST | 处理单个 hunk（接受时顺带捕捉立场） |
| `/api/drafts/:taskId/redline/resolve-all`           | POST | 全部处理                            |
| `/api/drafts/:taskId/redline/baseline`              | POST | 重置基线                            |

接受 hunk 时会调 `captureStanceAfterAccept`，把这次接受变成立场库的证据。注释说明：「证据账本记录来源案件；draft 缺失时留空，注入门槛按不可考处理」——拿不到案件就按不可考处理，不给它凑证据。

### 后台修订

```text
POST /api/drafts/:taskId/revision-job
```

这是「文书台 → 提交改稿」的入口：把一次修订派给某个助手在后台跑。

前置条件卡得比较严：

- 草稿必须存在（否则 404 `draft_not_found`，文案会告诉你去哪找文件）。
- **`reviewStatus` 必须是 `modified`**，否则 400：

```text
请先将签批标为「需修改」，再使用「提交改稿」。
```

- 必须有模型配置（否则 503 `missing_api_key`）。

指令长度上限 48000 字（`REVISION_INSTRUCTION_MAX`），实际传入截到 12000。工具调用上限取配置和 24 里的较大值。

指令模板里有三条硬约束，值得抄下来：

```text
对合同正文做**最小必要修改**（只改必须改的字词）
**必须落盘，禁止只改聊天文字：**
**禁止**调用 draft_document / execute_workflow 重新生成新草稿
```

第二条「必须落盘，禁止只改聊天文字」是踩过坑的：模型可能在对话里说「我改成 45 天了」，但文件根本没变。所以有一条验证（`revision-persisted.ts`）专门确认文件真的落了盘，没落就报：

```text
revision_not_persisted: 助手未将修订写入 drafts 文件，请查看对话后重试或手动恢复待审核。
```

跑完之后会重开审核（`reopenDraftReview`），记录改稿幅度，并生成一条学习建议。

### Word 插件

| 端点                                         | 方法     | 说明                             |
| -------------------------------------------- | -------- | -------------------------------- |
| `/word-addin/manifest.xml`                   | GET      | 清单（模板变量替换）             |
| `/word-addin/taskpane.html` / `.js` / `.css` | GET      | 静态页                           |
| `/word-addin/icon-32.png`                    | GET      | 图标                             |
| `/word-addin/config.js`                      | GET      | 同源配置与凭据                   |
| `/api/word-addin/reviews`                    | GET/POST | 列/建审查请求                    |
| `/api/word-addin/reviews/:id`                | GET      | 读一个请求                       |
| `/api/word-addin/reviews/:id/result`         | POST     | 回填结果                         |
| `/api/word-addin/reviews/:id/matter`         | POST     | 指定案卷（旧 `needs_matter` 用） |
| `/api/word-addin/reviews/:id/export`         | POST     | 取导出路径                       |
| `/api/word-addin/matters`                    | GET      | 可选案卷列表                     |

静态面**免 bearer 鉴权**，但仍在回环 Host 门后面（第 14 章讲鉴权）。插件页面的凭据从同源 `config.js` 拿。

## 8.18 关键文件

| 关注点             | 文件                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最短改动算法与审计 | `src/lawmind/drafts/minimal-edit-script.ts`                                                                                                                                                                                   |
| 落改               | `src/lawmind/drafts/apply-surgical-edits.ts`、`resolve-surgical-edits.ts`、`surgical-diff.ts`                                                                                                                                 |
| 跨度经验值         | `src/lawmind/drafts/surgical-span-gate.ts`、`contract-redline-craft.ts`                                                                                                                                                       |
| 改稿幅度门         | `src/lawmind/drafts/surgical-edit-gate.ts`                                                                                                                                                                                    |
| 修订计划           | `src/lawmind/drafts/redline-plan.ts`                                                                                                                                                                                          |
| 修订提案           | `src/lawmind/drafts/redline-proposal.ts`                                                                                                                                                                                      |
| 合同基线           | `src/lawmind/drafts/contract-edit-baseline.ts`                                                                                                                                                                                |
| 空修订门           | `src/lawmind/drafts/tracked-render-hunk-gate.ts`                                                                                                                                                                              |
| XML 复核与重试     | `src/lawmind/drafts/tracked-xml-qa.ts`、`xml-qa-auto-retry.ts`                                                                                                                                                                |
| 跨文书             | `src/lawmind/drafts/cross-document-edits.ts`                                                                                                                                                                                  |
| 术语               | `src/lawmind/drafts/terminology-adapt.ts`                                                                                                                                                                                     |
| 出处与受众         | `src/lawmind/drafts/provenance.ts`、`audience-split.ts`、`source-boundary.ts`                                                                                                                                                 |
| 草稿持久化         | `src/lawmind/drafts/index.ts`                                                                                                                                                                                                 |
| 渲染               | `src/lawmind/artifacts/render-docx.ts`、`render-docx-tracked.ts`、`render-pptx.ts`                                                                                                                                            |
| 输出位置与命名     | `src/lawmind/artifacts/default-output-location.ts`、`matter-word-delivery.ts`、`word-revision-delivery.ts`、`named-user-place.ts`                                                                                             |
| 排版               | `src/lawmind/artifacts/docx-legal-typography.ts`                                                                                                                                                                              |
| officecli 定位     | `src/lawmind/artifacts/officecli-bin.ts`                                                                                                                                                                                      |
| Word 改稿锁定      | `src/lawmind/platform/word-revision-instruction.ts`、`word-revision-core.ts`、`word-revision-checklist.ts`                                                                                                                    |
| Word 插件          | `src/lawmind/integrations/word-addin/`（`review-requests.ts`、`auto-run.ts`、`attach-result.ts`、`addin-assets.ts`）、`apps/lawmind-desktop/server/lawmind-server-word-addin-runner.ts`、`lawmind-server-route-word-addin.ts` |
| 插件资产           | `apps/lawmind-desktop/resources/word-addin/`                                                                                                                                                                                  |
| 独立审稿           | `src/lawmind/guardian/`                                                                                                                                                                                                       |
| HTTP               | `apps/lawmind-desktop/server/lawmind-server-route-redline.ts`、`-draft-revision.ts`、`-word-addin.ts`                                                                                                                         |
| 桌面 UI            | `apps/lawmind-desktop/src/renderer/LawmindRedlinePanel.tsx`、`ReviewWorkbench.tsx`、`review/`、`LawmindDraftDocumentEditor.tsx`、`LawmindWordRevisionBar.tsx`、`stores/review-pane-visibility-store.ts`                       |

## 8.19 已知坑

- **别用「find 太长就拒」的旧理解。** 跨度经验值（48 字、含句读 12 字）现在只是**模型自查**的建议值，引擎是按最短改动**重算**，不是按长度拒绝。这是 2026-09-20 的行为变更。
- **从右到左不是可选项。** 落盘顺序改成从左往右，会出现「重复短语改错位置」的 bug。
- **多处命中一律整处跳过。** 不要为了「尽量多改」退回「改第一处」的行为，那正是注释里点名禁止的。
- **只读文件要 chmod。** 从 Finder 拷来的 0444 文件不改权限，officecli 会「0 处应用」且不报错。
- **XML 复核的门槛（8 字 / 60%）比内存里的（6 字）严，这是有意的**，别为了少报而调低。
- **计划跳过原因要按真实原因统计。** 只认「跨度硬门禁」会让审稿人看不到真正的漏改。
- **Word 插件的端口是持久化契约。** 换端口会让已侧载的窗格找不到服务，表现还是误导性的 `unauthorized` 或 `Load failed`。
- **`needs_matter` 是旧状态。** 新流程不该再用它拦人。
- **插件折叠绝不折 `running`。** 折了会重复扣模型钱。
- **policy 文件缺 `schemaVersion: 1` 会被整份忽略。** 配了 `wordAddinAutoRun` 没生效，先看这一条。
- **审稿记录不进写手会话。** 想「让写手看看审稿意见再改」是反设计的，别这么做。
- **审稿存档不再用字段白名单。** 律师可见面仍瘦身；`GuardianRecord` 上的其余字段原样留下。审稿原文仍然截断。
- **子工不代替落稿。** `draft_worker` 只读，不能改原件、不能导出。对话里并行拆开的长任务，正式稿仍走父会话的 `draft_document`（第 3.1.1 节、第 23.7 节）。这是交付要停在父会话签批，不是派工没接上。
- **导出永远不开 Word。** `openWord: false` 是刻意的，别改成自动打开。
