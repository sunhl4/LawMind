# 第 9 章 审查表与工作队列

这一章讲三件配套的东西：**审查表**（把一批材料抽成一张表）、**工作队列**（那些待办到底从哪来）、**审查专案组**（多角色分头看一份合同）。

## 9.1 审查表是干什么的

场景很具体：客户给你二十份合同，你要做尽调，得回答「每份合同的付款条件是什么、有没有责任上限、解除条款怎么样」。传统做法是一份一份读、一边读一边记，最后拼成一张表。

审查表把这件事变成「一次交办，出整张表」：

- 表格的行是**材料**（或审查事项），列是**要问的问题**。
- 每个格子要么有一个**出处**（哪份材料的哪一行/哪一页），要么**明说「无法判断（证据不足）」**。
- 表本身是一个交付物类型（`review.table`）。

设计上的硬约束写在代码头部，我原文抄下来：

```text
设计约束——**交付前不让律师介入**：
- 一次交办把整批材料抽完，不向律师提问、不要求逐格确认。
- 每格要么带出处，要么显式弃答（「无法判断（证据不足）」），**绝不编造**。
- 扫描件/图片走 OCR 兜底；**只读**抽取不进案件知识库，因此不设律师确认闸门。
- OCR 兜底失败即弃答，不空跑、不假装成功。
```

第三条要解释一下，因为乍看有点危险：「只读抽取不进案件知识库，因此不设律师确认闸门」。意思是——它只是**读**材料来填表，没有把材料内容写进知识库（写知识库才需要确认）。所以这一步不需要你点头。这是「一次交办」能成立的前提。

### 三种模板

| 模板 id         | 名称         | 列                                         |
| --------------- | ------------ | ------------------------------------------ |
| `due_diligence` | 尽调审查表   | 审查事项、对应文件、发现、风险等级、来源   |
| `evidence`      | 证据审查表   | 证据名称、证明目的、关联争点、证明力、来源 |
| `clause_matrix` | 条款对照矩阵 | 条款、我方文本、对方文本、风险、建议、来源 |

注意每一列都带一个可选的 `prompt` 字段，注释说是「该列的抽取提示（批量抽取时给执行器）。缺省用 label」。

### 存哪

表格本体存在**侧车文件**里：

```text
drafts/<taskId>.table.json
```

注释写得很明确：「表格本体存 sidecar `drafts/<taskId>.table.json`，导出 xlsx/docx 从 sidecar 出。」也就是说，草稿正文里只有表格的 markdown 预览，真正的数据在侧车里。这样表格可以有结构化字段（来源、置信度、锁定状态），而不被 markdown 的正文字符串限制。

## 9.2 律师侧：怎么用这张表

入口是改稿工作面里的审查表编辑器（`LawmindReviewTableEditor.tsx`）。它的头部注释：

> 审查表编辑器（review.table）— 文书台内的轻量表格编辑。表格本体存 sidecar（`GET/PATCH /api/drafts/:id/table`）；保存后草稿「审查表」栏目在服务端同步 markdown 预览，与 agent 的 `review_table_update` 同一真相源。

几个要点：

- 你能**直接编辑**格子内容。
- 编辑提交是**整表替换**（一次提交 columns + rows）。
- 保存后，草稿里的「审查表」栏目会自动同步成 markdown 预览。
- 唯一真相源是侧车文件，agent 工具和界面改的是同一个东西。

### 每一格的状态

每个格子可以带一份元数据（`ReviewCellMeta`）：

```ts
{ source?: string; confidence?: "high" | "medium" | "low"; abstained?: boolean; note?: string }
```

规则：「每格要么有**本格**出处，要么显式弃答（abstained），不得编造。」行上的文件名、来源列只说明这行是哪份材料，不能把旁边猜出来的发现洗成「有出处」。

`CellProvenance` 三态：`sourced`（本格 `cellMeta.source`）、`abstained`（弃答）、`missing`（有值或空着，但没有本格出处）。编辑器只在实质格下显示这三态，文件名列和来源列不标「缺出处」。已锁定的行不能改、不能删，要点「解除锁定」之后才能动。保存若漏掉锁定行，服务端会把该行补回去。律师改某一格时，只丢掉这一格的旧出处。

### 行的审核状态

每行还能带审核状态（`CellReviewState`）：

```ts
{ reviewed?: boolean; locked?: boolean; assignee?: string; updatedAt?: string }
```

注释说明了设计意图：

> 表格审核状态：只记录律师/引擎真正碰过的格子，不强制任何流程。

以及一条硬规则：

> 锁定：批量重抽不得覆盖。

这条很实用。你手工核对过某几行、把它们锁上，之后重新批量抽取就不会把你核对过的内容冲掉。

## 9.3 验收口径：什么算缺陷

审查表能不能交付，靠 `reviewTableAcceptanceProblems` 判定。注释写得很清楚：

```text
验收口径：空表不可交付；每个非 source 列的值都要么有出处，要么显式弃答。
「显式弃答」是诚实交付，不算缺口；「有值但整行无出处」才是缺口。
```

三条规则：

1. 表里一行都没有 → 报「审查表为空」。
2. 只看实质列（发现、风险、建议等）。文件名列和来源列不算。
3. 实质列里有字、又不是弃答、又没有本格出处 → 这一行记一笔。最后报「N 行缺来源」。只有行级文件名时，空着的实质列不算缺陷；填了猜测才算。

判定「弃答」的条件是：

```ts
meta?.abstained || value === REVIEW_TABLE_ABSTAIN_TEXT;
```

弃答标记的固定文本是：

```ts
export const REVIEW_TABLE_ABSTAIN_TEXT = "无法判断（证据不足）";
```

注释：「弃答标记值：抽不动时写这个，不猜。」

**这条设计是整章最值钱的地方。** 它把「我不知道」和「我没有出处」分成了两件事：

- 「我不知道」→ 明确写出来，算诚实交付，不挡你出表。
- 「我知道但没出处」→ 算缺陷，挡你交付。

如果不分这两件事，模型会倾向于**编一个看起来合理但没出处的值**来填满表格。分开之后，编造就没必要了，因为「说不知道」是被允许的。

## 9.4 批量抽取怎么跑

入口是 `extractReviewTable`（`review-table-extract.ts`）。流程是「材料 × 列」的二维遍历：

```text
读材料正文 → （必要时）OCR → 逐列抽格 → 逐行汇总 → 完成
```

进度回调的相位是 `read`、`ocr`、`cell`、`row`、`done`。

几个默认值和上限：

| 常量                          | 值                | 说明             |
| ----------------------------- | ----------------- | ---------------- |
| `concurrency`                 | 默认 4，夹在 1–16 | 并发材料数       |
| `maxCharsPerDoc`              | 200000            | 单份材料读取上限 |
| `REVIEW_EXTRACT_DEFAULT_DOCS` | 120               | 默认最多抽多少份 |
| `REVIEW_EXTRACT_MAX_DOCS`     | 500               | 硬上限           |

行 id 是 `row-<序号>-<路径哈希 8 位>`。同一路径、同一序号，两次抽取 id 相同，锁定和 diff 才对得上。

### 两种抽取器：模式优先，模型兜底

这是设计上很聪明的一层。`review-table-patterns.ts` 用**确定性正则**去抽那些有确定答案的东西，注释解释了动机：

> 为什么需要它：交付前不让律师介入，也不该把「抽金额 / 抽日期 / 抽法院」这类有确定答案的活交给模型赌概率。模式能定的，引擎直接定；定不了的才交模型或弃答。

现有的模式有 11 种：金额、日期、天数、案号、法院、当事人、付款条件、交付条件、管辖、违约金、送达地址。

每种模式带一个 `columnHints`，用来决定它适配哪些列。匹配成功后返回的定位是 `line=<行号>`，值截到 200 字。抽取成功时的备注是「按「<模式名>」模式抽取」，置信度是 `high`（走 OCR 的是 `low`）。

抽不动时的弃答原因是写死的两种：

```text
该列（<列名>）无确定性模式，需模型判断或人工
未检出<模式名列表>
```

### OCR 兜底

扫描件和图片会走 OCR。头部注释写清了边界：

> 扫描件/图片走 OCR 兜底；**只读**抽取不进案件知识库。

失败时的弃答原因有四种：

| 原因                   | 场景                                              |
| ---------------------- | ------------------------------------------------- |
| `扫描件未能识别出正文` | **这一份**材料 OCR 跑完了但没结果                 |
| `该材料无可用正文`     | 这一份根本没有文本层。不看别的材料有没有 OCR 失败 |
| `已取消`               | 中途取消                                          |
| `证据不足`             | 模型判定信息不够                                  |

走 OCR 的格子备注是「OCR 只读抽取」，置信度降到 `low`。**失败即弃答，不空跑、不假装成功。**

### 汇总文案

跑完给一句汇总（`summarizeReviewExtract`），形如：

```text
12 份材料 · 84 格（其中 71 格有出处、9 格弃答；4 份走扫描件识别，1 份扫描件未能识别）
```

律师一看就知道这张表的可信度大概什么样。

### 材料顺序按路径升序

这条很细但很重要。工具代码里有一段解释：

> 桌面材料列表按 mtime 倒序（"最近改过的在最上面"，那是人看的）；
> 审查表的**行序**必须可复现：同一批材料跑两次要出同一张表，
> 否则 diff 与验收都失去意义。故这里按路径排序，与 mtime 抖动无关。

也就是说，给你看的时候按修改时间倒序（方便），但表格行序按路径排序（可复现）。两种顺序服务两个目的，不能混。

重抽时按材料路径对齐：**已锁定的行整行留住**，不换成新抽的格子。这份材料已经不在本轮清单里时，锁定行仍留在表尾，不会被删掉。

文件名列按列 key 或整词标签识别（`条款`、`审查事项`、`对应文件`、`证据名称`）。标签里带「付款条款」「违约事项」的自定义列仍要抽，不会被当成文件名跳过。

## 9.5 `review_table_update` 的九个动作

这是模型操作审查表的唯一工具，实现在 `src/lawmind/agent/tools/legal/review-table-tool.ts`。九个动作：

| 动作                        | 干什么                                 |
| --------------------------- | -------------------------------------- |
| `set_template`              | 建表（选三种模板之一）                 |
| `set_columns`               | 自定义列                               |
| `add_rows`                  | 加行                                   |
| `update_cells`              | 改指定行的指定列                       |
| `group_by`                  | 按某列分组                             |
| `import_materials_metadata` | 从本案材料导入行元数据                 |
| `extract_batch`             | 批量抽取                               |
| `set_review`                | 标记审核状态（已看 / 锁定 / 解除锁定） |
| `to_draft`                  | 把结论推进草稿正文                     |

参数里 `extract_batch` 相关的两个：`max_docs`（默认 120，上限 500）、`cell_keys`（只抽这些列，缺省抽全部非来源列）。

### 几个关键报错

错误文案写得挺到位，模型看得懂该干什么：

| 情况                 | 报错                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| 没给 task_id         | `缺少 task_id。`                                                                |
| 找不到草稿           | `找不到草稿 <id>。请先 draft_document 建审查表草稿。`                           |
| 动作名写错           | `未知动作 <x>。可用：set_template / set_columns / …`                            |
| 表还没建             | `还没有审查表。请先 set_template（due_diligence / evidence / clause_matrix）。` |
| 改格子一个都没命中   | `update_cells 没有命中任何 rowId。`                                             |
| 导入元数据时没绑案件 | `草稿未关联案件，无法导入材料元数据。`                                          |
| 案件里没材料         | `本案 materials 为空，先 import_host_file 收材料。`                             |

`import_materials_metadata` 用了 `listMaterialsForReview(..., 200)`，也就是最多导 200 行。

### 推进正文（`to_draft`）

注释里说得很清楚：

> 审查表 → 文书：把已核验的结论与出处推进草稿正文，供导出。
> 只推「有出处」的行；弃答与待补另列一节，不混进结论。
> 不要求律师先确认——这就是交付前少介入的那一步。

三条都重要。尤其是第二条：**没出处的行不进结论**，而是单列一节（比如「诚实标注，未作推断」）。这就是「宁可少写，不编」的落地方式。

推进时找目标章节用的是正则：先找 `/审查结论|主要发现|尽调结论/`，找不到就新加一节叫「审查结论」。

### 分区标记的默认行为

`set_review` 默认只改被点名的行。已锁定的行，再标「已看」或再次锁定都会跳过，回执报「N 行已锁定未动」。只有 `unlocked` 会改锁定行。

## 9.6 工作队列：那些待办从哪来

工作台里的待办队列（`queue.jsonl`）不是凭空生成的，来源有两个：

1. **显式开**：代码里主动 `openQueueItem`（比如建案件时开的「完成利益冲突检查」）。
2. **从案件索引派生**：`buildQueueItemsFromMatterIndex` 按规则算出来。

派生的规则和 id 格式是固定的，列一下（id 里带冒号的这些是派生 id）：

| id 格式                 | 类型                                           | 触发条件                                           |
| ----------------------- | ---------------------------------------------- | -------------------------------------------------- |
| `<taskId>:confirm`      | `need_partner_approval` / `need_lawyer_review` | 任务需要确认且状态是 `created`；高风险走合伙人审批 |
| `<draftTaskId>:review`  | `need_lawyer_review`                           | 草稿是 `pending`                                   |
| `<draftTaskId>:revise`  | `ready_to_draft`                               | 草稿是 `modified` 或 `rejected`                    |
| `<draftTaskId>:render`  | `ready_to_render`                              | 草稿已批准且还没有产物路径                         |
| `<matterId>:evidence:N` | `need_evidence`                                | 阶段性收证据（优先级 `high`）                      |
| `<matterId>:strategy`   | `blocked_by_missing_strategy`                  | 案件既没有核心争点也没有任务目标                   |

### 优先级排序

队列读取时的排序规则：先按优先级（`critical` → `high` → `normal` → `low`），同优先级按 `updatedAt` 倒序。

### 依赖与「等谁」

队列项可以声明依赖（`dependsOn`）。没配 `blockedReason` 时，系统会自动算出来：

```text
等待前置待办：<未完成的 id 列表>
```

`blockedBy` 在开待办时写入：未完成的前置 id 列表。前置变成 `resolved` 或 `dismissed` 后，依赖它的条目会清掉自动生成的「等待前置待办」和 `blockedBy`。律师手写的其他 `blockedReason` 不动。

### 一个已知的口径问题

队列项有状态转移：

| 从            | 可以到                                 |
| ------------- | -------------------------------------- |
| `open`        | `in_progress`、`resolved`、`dismissed` |
| `in_progress` | `open`、`resolved`、`dismissed`        |
| `resolved`    | `open`（重新打开）                     |
| `dismissed`   | `open`（重新打开）                     |

相同状态是空操作。`resolved` 不能直接改成 `dismissed`，调用返回空、文件不改。现有调用点仍是把 `open` 收成 `resolved`。

## 9.7 审查专案组

这是对标 Harvey Review Tables 之外的另一条线：**让多个角色分头审同一份合同**，最后给一个综合结论。

### 默认专案组

打包了一个默认的（`STANDARD_CONTRACT_REVIEW`，id `standard-contract-review`，名称「标准合同审查专案组」），五个角色：

| 角色                  | 名称       | 权重 | 超时 | 可用工具                          |
| --------------------- | ---------- | ---- | ---- | --------------------------------- |
| `clause`              | 条款结构   | 0.2  | 120s | `draft_document`、`update_draft`  |
| `risk`                | 风险与责任 | 0.3  | 120s | `draft_document`、`research_task` |
| `compliance`          | 合规       | 0.15 | 90s  | `research_task`                   |
| `obligation_timeline` | 义务时间线 | 0.15 | 90s  | `draft_document`                  |
| `citation_check`      | 引用核验   | 0.2  | 90s  | `research_task`                   |

它适用于这几种交付物类型：`contract.review`、`contract.general`、`contract.nda`、`contract.rental`。

权重是有意义的：风险和引用核验各占 0.3 / 0.2，加起来一半，说明这两项是这个专案组最看重的。

### 角色怎么绑到助手

每个角色映射到工作区里的一个岗位（`PLAYBOOK_ROLE_TO_WORKSPACE_ROLE`）：

| 专案组角色            | 对应岗位              |
| --------------------- | --------------------- |
| `clause`              | `contract_review`     |
| `risk`                | `contract_review`     |
| `compliance`          | `compliance_research` |
| `obligation_timeline` | `contract_review`     |
| `citation_check`      | `general_default`     |

绑定时会去找该岗位的第一个助手（`candidates[0]`）。也就是说，如果你没建对应岗位的助手，这个角色可能绑不上。

### 串行跑，且不用模型

这一点很容易误读，必须说清楚：**打包的串行执行器是启发式的，不调用模型。**

源码注释：

> Serial heuristic role runner — findings (no LLM) for reproducible Score.

也就是说，它靠一组写死的规则产出发现项，而不是真的让模型去读合同。现有的规则标签有：「缺少定义条款」「条款结构偏简」「沿用原审查口径」「未见责任上限」「责任表述偏极端」「解除/终止条款弱」「数据处理义务不足」「管辖/适用法未明示」「期限表述稀少」「存在自动续期」「高风险结论缺引用标注」「断言语气偏强」。

为什么这么做？因为**要可复现**。真让模型跑，同样的合同两次可能给不同分数。用启发式规则，同一个输入永远出同一个分。

结论里也有一句：「Solo must not call this.」——并行那条路是给律所版留的。

### 安全分怎么算

`aggregateSafetyScore` 的算法：

1. 只统计状态是 `done` 的角色。
2. 权重取角色的 `weight`，如果 ≤0 就用 0.1。
3. 分数取 `score`，如果是数字就用，否则默认 50。
4. 加权平均后夹在 0–100 之间取整。

严重程度排序是 `high`=3、`medium`=2、`low`=1，协商优先级列表按优先级降序、再按严重程度排序，最后重新编号 `priority: 1, 2, 3…`。

界面上有个重要声明（`LawmindReviewCampaignPanel.tsx` 的注释）：

> 不展示启发式 Safety Score，仅显示 runtime-events / lint / 律师编辑统计。

**这个分数是给引擎内部用的排序信号，不是给律师看的质量证明。** 界面上的覆盖、发现、已处理只来自运行记录和机械核对；没有记录时显示「—」，不用关键词的高/中/低计数去填。角色页不印启发式分数。报告和界面里的清单标题是「关键词信号」，并写明不是法律结论。这和全书第 1 章讲的「不包装假指标」是一致的。

### 专案组数据的存放位置

- 案件内的专案组：`workspace/matters/<matterId>/campaigns/<campaignId>.json`
- 没绑案件的：`workspace/lawmind/campaigns/<campaignId>.json`
- 自定义 playbook：`workspace/lawmind/fleet-playbooks/*.json`

`sourceText` 会截到 200000 字。自定义 playbook 至少 1 个认得出的角色。早先「少于 4 个就非法」是没有安全理由的硬门槛，一个角色（例如只核引用）也是合法专案组。

### 审查口径随稿带走

有个小机制挺实用（`review-brief.ts`）：

> 审查口径：立场 / 重点 / 深度。升专案组时随稿带走，不靠律师再填一遍。

它从文本里抽三种信息：己方立场、审查重点、审查深度。深度只认「快速」「标准」「深度」三种前缀。

抽到之后格式化成一行 `【审查口径】立场：…；重点：…；深度：…`，跟着稿子走。有个注释说：「升专案组时随稿带走，不靠律师再填一遍」——你要是已经说过审查重点，系统不让你再说一次。

### 快速模式

`preferFast` 会把角色裁掉：保留权重 ≥0.18 的，不够就按权重取前 4 个。

## 9.8 案件级审查矩阵（和审查表的区别）

第 7 章提过案件里的「审查矩阵」。这里说一下它和 `review.table` 的区别，容易混：

|          | 审查表 `review.table`                          | 案件审查矩阵                         |
| -------- | ---------------------------------------------- | ------------------------------------ |
| 位置     | 某个任务的草稿（`drafts/<taskId>.table.json`） | 案件层面（跨该案件所有草稿与材料）   |
| 数据     | 你或模型填的有出处结论                         | 从现有文本里**摘录**关键词附近的句子 |
| 用途     | 交付出去                                       | 内部对照、人工核对                   |
| 能否编辑 | 能                                             | 只能在界面上写批注和「已核对」标记   |

矩阵的摘录算法（`excerptForQuestion`）值得说一下，因为它很克制：

1. 先清理 markdown 噪音。
2. 按问题 id 取关键词表，**取不到关键词就直接返回空**（所以 `q-misc` 永远是空的）。
3. 逐个关键词找位置，命中第一个就取前 24 字开始的一段，最多 160 字。

注释解释了为什么不命中就留空：

> Keyword-hit excerpt only. No hit → empty (do not dump document head into every column).

意思是：**宁可这格空着，也不要每格都塞文档开头那段。** 塞开头看起来「填满了」，实际全是重复噪音。

六个问题各自的关键词列表：

| 问题         | 关键词                                                   |
| ------------ | -------------------------------------------------------- |
| 当事人与主体 | 当事人、甲方、乙方、双方、签署、委托人、原告、被告、对方 |
| 核心商业条款 | 价款、价格、期限、交付、付款、标的、报酬                 |
| 风险与责任   | 违约、赔偿、责任、损失、免责、风险                       |
| 知识产权     | 知识产权、专利、著作权、许可、商标                       |
| 解除与终止   | 解除、终止、到期、解约                                   |
| 争议解决     | 管辖、仲裁、争议解决、适用法、诉讼                       |

### 导出 CSV

表头固定：

```text
documentId,documentTitle,questionId,question,excerpt,status,citation
```

`citation` 取 `sourceId` 或退回 `taskId`。转义规则：换行替换成空格，含引号或逗号时加引号并把内部的引号翻倍。

### 批注存在浏览器里

批注和「已核对」写在案件目录 `matters/<matterId>/review-matrix-notes.json`（`GET/PUT /api/matters/review-matrix/notes`）。浏览器 localStorage 仍留一份副本：工作区里已有内容时以工作区为准；工作区是空的、浏览器里还有旧批注时，打开矩阵会把旧批注补写进案件目录。换机器只要带走工作区，批注还在。

## 9.9 HTTP 端点

| 端点                                           | 方法      | 说明                                                                              |
| ---------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| `/api/drafts/:id/table`                        | GET       | 读审查表（没有则 404 `table_not_found`）                                          |
| `/api/drafts/:id/table`                        | PATCH     | 整表替换（草稿不在待审/需修改状态则 409 `draft_not_editable`）                    |
| `/api/drafts/:id/table.xlsx`                   | GET       | 导出 xlsx。第一张是表，第二张「逐格出处」。工作表名取标题前 31 字，缺省「审查表」 |
| `/api/matters/review-matrix/notes?matterId=`   | GET / PUT | 矩阵批注与已核对标记（案件目录 JSON）                                             |
| `/api/matters/review-matrix?matterId=`         | GET       | 读矩阵                                                                            |
| `/api/matters/review-matrix/export?matterId=`  | GET       | 导出 CSV                                                                          |
| `/api/queues?matterId=&kind=`                  | GET       | 读工作队列                                                                        |
| `/api/approvals?matterId=&status=&targetRole=` | GET       | 读审批（可按目标角色）                                                            |
| `/api/fleet-playbooks`                         | GET       | 列专案组模板（含角色数）                                                          |
| `/api/fleet-playbooks/:id`                     | GET       | 读一个模板                                                                        |
| `/api/review-campaigns?taskId=&matterId=`      | GET       | 读专案组运行                                                                      |
| `/api/review-campaigns`                        | POST      | 建专案组（可传 `idempotencyKey`、`runNow`、`preferFast`、`preferParallel`）       |
| `/api/review-campaigns/:id/cancel`             | POST      | 取消                                                                              |
| `/api/review-campaigns/:id/roles/:role/rerun`  | POST      | 重跑某个角色                                                                      |
| `/api/review-campaigns/:id/report`             | GET       | 出 Markdown 报告                                                                  |

有一个坑写在 xlsx 那条路由的注释里，挺典型：

> ⚠️ 与诊断包同一个坑：**手写 `writeHead` 必须带 `...c`**（CORS 头）。
> 渲染层对本服务是跨源；漏了它浏览器会直接拦掉响应（`Failed to fetch`，几毫秒内失败、与超时无关），而服务端日志里一切正常。

也就是说，这类 bug 表现为「前端报网络错误，后端日志全绿」。记住这个症状，省得下次从服务端查起。

## 9.10 关键文件

| 关注点         | 文件                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 审查表数据模型 | `src/lawmind/deliverables/review-table.ts`                                                                                                                                                                     |
| 批量抽取       | `src/lawmind/deliverables/review-table-extract.ts`                                                                                                                                                             |
| 确定性模式     | `src/lawmind/deliverables/review-table-patterns.ts`                                                                                                                                                            |
| 工具           | `src/lawmind/agent/tools/legal/review-table-tool.ts`                                                                                                                                                           |
| 案件审查矩阵   | `src/lawmind/matter/review-matrix.ts`、`review-matrix-compare.ts`、`review-matrix-notes-store.ts`                                                                                                              |
| 专案组         | `src/lawmind/review-campaign/`（`playbooks.ts`、`serial-runner.ts`、`bind-assistants.ts`、`safety-score.ts`、`review-brief.ts`、`storage.ts`、`types.ts`）                                                     |
| 队列           | `src/lawmind/application/services/queue-write-service.ts`、`queue-service.ts`                                                                                                                                  |
| 队列派生       | `src/lawmind/core/contracts.ts`（`buildQueueItemsFromMatterIndex`）                                                                                                                                            |
| CLI 审核门     | `src/lawmind/review/cli.ts`                                                                                                                                                                                    |
| HTTP           | `apps/lawmind-desktop/server/lawmind-server-route-review.ts`、`-review-campaign.ts`、`-matters.ts`                                                                                                             |
| 桌面 UI        | `apps/lawmind-desktop/src/renderer/LawmindReviewTableEditor.tsx`、`LawmindReviewCampaignPanel.tsx`、`matter/MatterReviewQueuePanel.tsx`、`matter/MatterReviewMatrixPanel.tsx`、`matter/review-matrix-notes.ts` |

## 9.11 已知坑

- **「弃答」和「缺出处」是两件事，别混。** 弃答是诚实交付，缺出处才是缺陷。改验收逻辑时别把弃答也算成问题，否则模型会退回编造。
- **弃答的文本是固定值**（`无法判断（证据不足）`）。改成别的措辞，验收判定会失效。
- **锁定的行批量重抽不会覆盖。** 这是有意的，别为了「数据一致」把它去掉。
- **审查表行序按路径升序，不是按时间。** 为了让两次跑出同一张表。别改成 mtime 排序。
- **表格本体在侧车，不在草稿正文里。** 想读原始数据就读 `drafts/<taskId>.table.json`。
- **专案组的安全分是内部信号，不给律师看。** 界面上显示的是运行时统计。`LawmindReviewCampaignPanel` 的注释明确写了这一点。
- **打包的串行角色跑的是启发式规则，不调模型。** 看到「专案组跑完了」不要以为模型读了合同。
- **自定义 playbook 至少 1 个角色。** 认不出角色 id 的条目会被丢掉；一个都没有则整份模板无效。
- **矩阵批注在案件目录。** 浏览器副本只是断网时的缓存，以 `review-matrix-notes.json` 为准。
- **队列终态不能互改。** `resolved` 不能直接 `dismissed`，要先 reopen 成 `open`。
- **手写 `writeHead` 必须带 CORS 头。** 症状是前端 `Failed to fetch`（几毫秒内失败）而后端日志正常。
