# 第 6 章 记忆与学习

这一章讲 LawMind 怎么记住东西，以及为什么它记得这么「费劲」——很多看起来能自动写的地方，它偏偏要你点一下。

## 6.1 先说清楚：为什么不干脆自动写

假设系统发现你每次改稿都把「甲方应于收到发票后 30 日内付款」改成「45 日」。聪明的做法当然是自动记住「这个律师偏好 45 日」。但 LawMind 不这么干。

原因是一旦自动写，就没人拦得住错误。模型可能把一次偶然的改动当成习惯，把 A 客户的特殊要求记成你的通用偏好，或者把对方律师的措辞记成你的风格。这种错误**很难发现**，因为它已经变成「你的偏好」了，下次起草时静静地起作用。

所以 LawMind 的立场是：**未确认零写入**。所有学习都以「建议」的形式排队，等你点确认才落盘。

这条立场在代码里有一句原话（`src/lawmind/memory/batch-adoption.ts`）：

> LawMind 的既有姿态是 **未确认零写入**（候选 `enabled: false` / `state: "pending"`）。这条姿态不能丢，但「逐条点确认」把律师钉在点击上，于是高频低风险的风格 delta 永远合不上环。

后半句是关键：光有原则不够，逐条点确认的结果是**没人用**。所以有了 6.5 的批量采纳。

## 6.2 律师侧：待确认队列怎么用

入口是「记忆库」（设置 → 办案 → 记忆库），组件是 `MemoryInspector.tsx`。

界面上的设计口径是这样的（源码头部注释）：

> `MemoryInspector` — 待确认记忆建议队列。默认动作：确认 / 改写；预览·稍后·忽略收进「更多」。

也就是说，默认只有两个按钮：**确认**和**改写**。「预览」「稍后」「忽略」被收进「更多」里——因为绝大多数建议你要么收要么不收，不需要四个按钮摊在面前。

每个建议带一个**作用域**（scope），决定它最终会写进哪个文件。八个作用域：

| scope       | 中文          | 落盘位置                                  |
| ----------- | ------------- | ----------------------------------------- |
| `lawyer`    | 律师偏好      | `LAWYER_PROFILE.md`                       |
| `matter`    | 案件 CASE     | `cases/<id>/CASE.md`                      |
| `firm`      | 律所档案      | `FIRM_PROFILE.md`                         |
| `client`    | 客户档案      | `clients/<id>/CLIENT_PROFILE.md`          |
| `playbook`  | 条款 playbook | `playbooks/CLAUSE_PLAYBOOK.md`            |
| `opponent`  | 法院-对手画像 | `playbooks/COURT_AND_OPPONENT_PROFILE.md` |
| `project`   | 项目          | `memory/topics/historical-scan.md`        |
| `assistant` | 助手档案      | `assistants/<id>/PROFILE.md`              |

界面上简单模式只暴露三个（`SIMPLE_SCOPES = ["lawyer","matter","firm"]`），其余在高级里。

案件里的「认知」页（`MatterMemoryInspector.tsx`）是同一个组件的复用，只是把 scope 锁到当前案件。

## 6.3 记忆的真相源清单

记住一句话：**记忆的真相源全是 Markdown 文件，人可以直接打开看、直接改。** 数据库、索引、统计都是派生的，删了能重建。

`src/lawmind/memory/index.ts` 里定了固定的读取顺序：

1. `MEMORY.md` — 通用长期记忆
2. `LAWYER_PROFILE.md` — 律师个人偏好
3. `FIRM_PROFILE.md` — 律所级规则
4. `playbooks/CLAUSE_PLAYBOOK.md` + `playbooks/COURT_AND_OPPONENT_PROFILE.md`
5. `cases/<matterId>/CASE.md` + `cases/<matterId>/MATTER_STRATEGY.md`
6. 客户档案：从 CASE 里的 clientId → `clients/<id>/` → `clients/<matterId>/` → 根目录 `CLIENT_PROFILE.md`
7. `memory/YYYY-MM-DD.md`（今天和昨天）

### 哪些进提示词，哪些不进

这是最容易搞混的一点。**加载了，不等于会出现在系统提示里。** `memory-sources.ts` 明确标了每一层的 `inAgentSystemPrompt`：

**会进提示词的**：`LAWYER_PROFILE.md`、根 `CLIENT_PROFILE.md`、今天的日志、案件的 `CASE.md`、案件级客户档案、助手 `PROFILE.md`。

**加载但不整段进提示词的**：`MEMORY.md`、`FIRM_PROFILE.md`、`CLAUSE_PLAYBOOK.md`、`COURT_AND_OPPONENT_PROFILE.md`、昨天的日志、`MATTER_STRATEGY.md`。

这层区分是有意的：偏好更像「人设」，每轮都要在；通用知识更像「可检索的资料」，需要时靠检索命中。

你在界面上能直接看到这个区分：`GET /api/memory/sources` 返回每一层的 `{ id, label, relativePath, exists, charCount, inAgentSystemPrompt, hint }`；审核台与案件认知用 `LawmindMemorySourcesPanel.tsx` 渲染成「这些档案在不在」（档案体检，不是某条回答的引用列表）。对话气泡不挂此面板（对齐 Codex / Cursor）。

每个进提示词的层都有字符上限，定义在 `prompt-windows.ts` 的 `PROMPT_WINDOW`。**这里有个容易看错的地方：每层通常有两个数，只有小的那个真的进提示词。**

| 层              | 进提示词（真正生效）                | 全文窗                       | 谁在读                                                  |
| --------------- | ----------------------------------- | ---------------------------- | ------------------------------------------------------- |
| 律师档案        | `lawyerFingerprintChars` **800**    | `lawyerProfileChars` 6000    | 指纹：`turn-orchestrator-prompt.ts`；全文窗**无消费点** |
| 案件 CASE       | `matterIndexChars` **1600**         | `matterContextChars` 8000    | 索引帽 / 进展修剪上限，同一个文件                       |
| 今日 / 昨日日志 | `dayLogIndexChars` **600**          | `dayLogChars` 3000           | 指纹：prompt + 检索适配器；全文窗**无消费点**           |
| 客户档案        | `clientFingerprintChars` **800**    | `clientProfileChars` 4000    | 指纹：prompt + 检索适配器；全文窗**无消费点**           |
| 助手档案        | `assistantFingerprintChars` **800** | `assistantProfileChars` 3000 | 指纹：prompt；全文窗**无消费点**                        |

也就是说：**「律师档案 6000 字」这种说法会把人带偏 8 倍。** 实际进提示词的是 800 字指纹，模型要读全文得走 `read_workspace_file`。上表「无消费点」的三项是定义了但全仓没人读的常量——查 `rg lawyerProfileChars` 只能查到它自己的定义。

律师档案这 800 字**不是从文件头切一刀**。`windowLawyerProfileForPrompt` 留下已填写的身份字段。装得下时 §八 整段都在。装不下时，用本轮问句的中文双字和短词去重叠打分，先留对得上的整条，其余写成「与本轮问题关系较弱」；问句一条都对不上（例如「今天天气如何」）就退回最近的整条。

这里**不上向量**。档案热文件最多 120 条，仓库里的嵌入是离线哈希桩，不是语义模型。Cursor Memories、Mem0 要的是「按本轮取出相关记忆」，不是必须上向量库。中文双字重叠和 `knowledge_fts` 的 trigram 是同一路，失败时退回最近条目，结果不飘。Lost in the Middle 说明把整份档案塞进窗口反而帮倒忙；MemGPT 的做法是按需换页，预算仍是这 800 字。身份字段仍要留，否则模型不知道这是谁的习惯。

这些数字不是随便定的，是为了让提示词不至于被记忆挤爆。窗口还会按模型上下文伸缩（`scalePromptWindows`，clamp 在 0.5–8 倍）。

而且**超帽必须带溢出指针**，不许静默截断（源码注释原话：`超帽必须带溢出指针（工具名 + 路径），禁止静默 slice。`）。意思是被截掉的部分会告诉模型「完整内容请用某工具读某路径」，而不是悄悄消失。

## 6.4 实现：五态状态机

建议的完整生命周期在 `src/lawmind/memory/adoption-service.ts`，存 `workspace/memory-adoption/suggestions.jsonl`。

五个状态（`MemoryAdoptionState`）：

| 状态            | 含义                                         |
| --------------- | -------------------------------------------- |
| `pending`       | 等你确认                                     |
| `adopted`       | 你确认了，已落盘                             |
| `auto_adopted`  | 系统自动采纳（只有明确低风险的场景）         |
| `dismissed`     | 你忽略了                                     |
| `recorded_noop` | 采纳了，但没有对应的落盘面，如实记录「没写」 |

最后一个状态很有意思。有些建议（比如某个 scope）确实没有可写的文件，系统不会假装写成功了，而是记成 `recorded_noop` 并带上 `noopReason`。源码注释就一句：

> 新增 kind 未配 writer 时必须如实标注，不得静默宣称已采纳。

### 建议的种类

`MEMORY_ADOPTION_KINDS` 一共 16 种，覆盖三大类：案件类（`case.core_issue`、`case.risk_note`、`case.task_goal`、`case.progress`、`case.artifact`）、风格类（`playbook.clause_learning`、`lawyer.profile_learning`、`assistant.profile_section`、`firm.preference`、`client.profile_note`、`opponent.note`、`project.note`）、以及学习类（`historical.knowledge`、`lawyer.habit_pattern`、`review_label`、`source.annotation`）。

### 去重

`pending` 状态下的建议会**去重**：同一个 `kind` + `targetId` + 内容，不会堆两条。重复的会直接复用已有那条，返回 `reusedPending: true`，不写新记录。

已决（非 pending）的历史只保留最近 1000 条，`pending` 全量保留。理由写在注释里：

> pending 是可行动项，不得静默丢弃。

清理不是每次写都做，而是等超过 `1000 + 200` 条时才在锁内压缩一次——避免每追加一条就重写整个文件（那是 O(n²)）。

### 并发：两个坑都踩过

这段代码的注释是「踩坑史」，值得一读：

> 进程内互斥：suggest（append）与 adopt/dismiss/mark（读-改-全量重写）必须串行，否则 adopt 的 rewrite 会用旧快照覆盖并发 suggest 的 append，静默丢记录。
>
> suggestions.jsonl 的跨进程排他锁：append 与「读-改-全量重写」共用同一把 O_EXCL 文件锁，避免 rewrite 覆盖并发 append。

说白了：追加和重写这两种操作混在一起，不锁就会丢数据。而且锁有两层——进程内一个队列，跨进程一把文件锁。

### 采纳是三步，不是一步

`adoptMemorySuggestion` 的顺序：

1. 加锁读，校验这条还是 `pending`（不是就报 `not_pending`）。
2. 调用 writer 真正写 Markdown（这一步**不碰 jsonl**）。
3. 再锁内读一次，条件写入状态。如果并发里被别人抢先了，本条返回 `not_pending`，不覆盖。

分三步是为了让「写文件」这个可能失败的动作，与「改状态」分开。写文件失败就不会把状态改成 `adopted`。

## 6.5 批量采纳：为什么必须有

原则是好原则，但逐条点确认在实践里没人坚持。所以有了 `src/lawmind/memory/batch-adoption.ts`。

它提供两个函数：

- `planBatchAdoption(workspaceDir, opts)` — **纯读**，零写入，返回一份预览计划。
- `adoptBatch(workspaceDir, auditDir, ids, opts)` — 律师确认后才调用。

批量采纳**默认是预演**。API 层也是这个口径：`POST /api/memory/adoption/adopt-batch` 的 `dryRun !== false` 时只返回计划，响应里带 `applied: false`。

### 只挑低风险的

批量模式有个白名单（`LOW_RISK_STYLE_KINDS`）：

```ts
[
  "lawyer.profile_learning",
  "lawyer.habit_pattern",
  "firm.preference",
  "playbook.clause_learning",
  "review_label",
  "source.annotation",
];
```

全是风格类，没有一条碰案件事实。案件事实类的建议永远走单条确认。

带金额、日期或公司名的 `lawyer.profile_learning` / `lawyer.habit_pattern` 也不进这批。`isDealSpecificLearningText` 认出「2026年」「1,200,000元」「有限公司」这类个案事实后，`isLowRiskStyleAdoption` 返回 false。期限从 30 日改成 45 日没有这些标记，仍算风格，可以进批量。律师点名某条 id 时仍可单条采纳。

### 一条失败不掀整批

源码注释写得很直白：

> 单条写入面抛错不得掀掉整批：其余条目照常采纳，本条如实报失败。

所以 `adoptBatch` 的返回值有三叠：`adopted`、`failed`、`recordedNoop`。你批准十条，八条成功、一条失败、一条没落盘面，它会如实告诉你这个分布。

`MemoryInspector.batch.test.tsx` 有两条测试专门守这个：`预览不发写入请求，确认后才一次落盘`、`没有待确认项时不提供批量入口`。

## 6.6 律师档案：两个容易踩的细节

### 空模板不许当偏好注入

`src/lawmind/memory/lawyer-profile-for-prompt.ts` 的头部注释就一行：

> Empty LAWYER_PROFILE templates must not enter the system prompt as if they were preferences.

问题在于：新建的工作区里 `LAWYER_PROFILE.md` 是有一份模板的，里面全是「姓名：`___`」「所在机构：`___`」这种占位行。如果整段塞进提示词，模型会以为你有一堆空偏好，行为会变形。

所以 `lawyerProfileForPrompt(raw)` 做了判断：

- 文件是空的 → 返回 `undefined`，不注入。
- 既没有填过的身份字段、也没有真的个人积累 → 返回 `undefined`（这就是「空模板不注入」）。
- 没填身份但有积累 → 只返回 §八 那一段。
- 填了身份 → 整体注入。

判断「真的积累」的逻辑也挺细：日期开头的条目（`[2024-xx-xx]`）、含「草稿审核学习」的、或者任何一条不是模板库存行的 bullet。

### §八 会轮转

`LAWYER_PROFILE.md` 的「八、个人积累」有个上限：`SECTION_EIGHT_MAX_BULLETS = 120`。超了就轮转。

轮转是把**最早的**条目挪到 `memory/lawyer-profile-archive.md`（不删除），然后返回 `{ rotated, archivePath }`。

为什么要轮转，注释解释了：

> prompt 只注入 800 字指纹，因此轮转不改变注入行为，只保证档案本身体积有界。

轮转保证文件有界。指纹窗另有一条规则：身份字段留下；装不下时优先留和本轮问句重叠的整条，对不上才留最近的整条。文件开头的模板说明不占这 800 字。已被轮转的条目在 `memory/lawyer-profile-archive.md`，不在热文件里，因此也不会被这轮问句选中。

### 写入去重

`appendLawyerProfileLearning` 在写之前会检查三种重复：

- 已经存在同 `[idem:<key>]` 标记的。
- 已经有「任务 `<id>`」+「草稿审核学习」的。
- 手工来源且核心文字完全一样的。

行格式是 `- [<时间戳>] [source:<review|manual>] <内容>`。

## 6.7 风格记忆闭环

这条链路讲的是「你在改稿里动过的手，怎么变成下一次的偏好」。它跨了好几个文件：

**第一步：捕捉改动。** `src/lawmind/learning/draft-edit-learning.ts`：

- `MAX_CANDIDATES = 3`（一次最多提 3 条候选）
- `MIN_DELTA_CHARS = 6`（改动太小不算）
- `MAX_CANDIDATE_CHARS = 160`（候选太长截断）

它走两条通道：偏好通道和样例通道（写进 `edits/edit-examples.jsonl`）。

偏好通道按改动内容分流，未确认前都不落盘：

- 写法类（例如责任上限、不含间接损失、付款期限 30 日改 45 日）→ `lawyer.profile_learning`，确认后进 `LAWYER_PROFILE.md`。
- 个案事实（金额、日期、公司名）且带了 `matterId` → `case.progress`，确认后进该案进展，不进律师通用偏好。没有案件 id 时仍进律师队列，但批量采纳会把它排除，必须单条确认。

这是 Harvey Memory 和 Cursor Memories 都会做的范围隔离：一个客户的数字不能变成你的通用习惯。样例通道仍照存对照，供检索，不当成指令。

**第二步：审核标签。** 你在审核时勾的标签（`src/lawmind/learning/apply-review-labels.ts`）会写进律师档案、助手档案、playbook，还有一个特殊标签「质量范例」会把这份稿提升为黄金样本（写 `golden/<taskId>.golden.json`）。

**第三步：拒绝棘轮。** 见 6.9。

## 6.8 编辑样例：存得宽，注入得省

`src/lawmind/learning/edit-examples.ts` 把「原文 → 改后」的对照存成可检索素材，存在 `edits/edit-examples.jsonl`。

这里的注释是全章最精彩的一段，我原文抄下来：

> **注入**时的每侧上限（比存储上限紧得多）。存储要宽（将来可能用全文做别的用途），注入要省——这是实测到的：首版把 600 字两侧原样塞进 prompt，结果 prompt 打包器**在范例块中间截断**，把末尾的「律师说明」（最值钱的「为什么改」）挤掉了。结论：**存得宽、注入得省**；且把最短最值钱的字段放在最前面。

这段说明了两轮迭代：

- 存储上限 `MAX_EXAMPLE_CHARS = 600`，注入上限 `MAX_EXAMPLE_CHARS_IN_PROMPT = 220`，默认只取 2 条（`DEFAULT_EXAMPLE_LIMIT = 2`）。
- **字段顺序也是设计**：律师说明写在标题行。注释里说明为什么：

> 这不是排版偏好——实测过：首版把说明放在每例末尾，结果 prompt 打包器在范例块中间截断，恰好把「为什么改」挤掉了。

还有一条关于「放哪」的决定：

> 刻意**不**把改稿塞进 `golden/`：`golden/` 的语义是「律师**判定**这条是典范」；改稿只是「律师动过手」。很多改稿是在**修缺陷**，不是示范。混存会让检索时坏例子挤掉好例子，也会让 `golden/` 的含义变模糊。

注入时用的块标题是「## 改稿参照（本所律师对系统稿的实际修改）」，而且明确是**素材**不是指令——测试标题就写着 `改稿范例：注入文案是**素材**而非指令`。

## 6.9 拒绝棘轮：把驳回分门别类

`src/lawmind/learning/rejection-ratchet.ts` 处理的是「你驳回了这份稿」这件事。

先分类（`classifyRejectionLabels`），按优先级：

| 类别       | 触发标签                         |
| ---------- | -------------------------------- |
| `verify`   | 引用有误、引用不完整             |
| `template` | 模板不匹配                       |
| `skill`    | 语气过强、语气过弱、受众定位不当 |
| `playbook` | 以上都不是（兜底）               |

分类结果记进工作记录，事件类型 `rejection_ratchet`。为什么要分这么细？因为「引用错了」该去改验证器，「语气太强」该去改技能，「模板不对」该去改模板——三类问题的修法完全不同，混成一锅就只能写「再改改」。

有一条硬门：**光点驳回、不打标签，什么都不写**（源码注释：`Bare reject (no labels) writes nothing.`）。因为「驳回」本身不携带信息，只有标签才说明问题在哪。

带标签的驳回会在**同一任务的下一轮**由 `formatRejectionCoach` 写进系统提示，标题是「本任务上次审核」。文案只说先核对引用、结构、语气或论证，并写明这不是新的禁写规则，与本条律师指令冲突时以指令为准。不锁工具，不要求重写法律结论。Codex / Cursor 把上一轮纠正留在后续上下文里；这里只留分类后的一句，避免把整段驳回稿再塞进窗口。

## 6.10 立场库：只在高置信时进提示词

`src/lawmind/stance/` 存的是「你在某类条款上的一贯立场」，存在 `lawmind/stance/items.json`。

一个条目长这样（`StanceItem`）：

```ts
{
  id, clauseType, family?,
  position,            // 一句话立场
  preferredLanguage,   // 你偏好的措辞
  rationale?, statuteBasis?,
  source,              // redline | habit_adopt | manual | revision_pack
  confidence, occurrences,
  evidence: [{ source, at, matterId? }],
  createdAt, updatedAt, supersededBy?
}
```

条款类型只有七种（`STANCE_CLAUSE_TYPE_IDS`）：管辖、违约金、保密、赔偿、定金、知识产权、其他。

### 什么情况下才注入

这是重点。`selectInjectableStances` 的门槛不低：

- 被取代的（`supersededBy`）不要。
- id 以 `firm_default_` 开头的预置条不要，理由是 `unconfirmed_firm_default`。
- 置信度衰减后低于 `MIN_HINT_CONFIDENCE = 0.4` 不要。衰减规则：30 天内不变；超过 30 天按 `max(0.5, 1 - 天数/365)` 打折。
- **证据必须跨至少 2 个不同案件**（`MIN_DISTINCT_EVIDENCE_MATTERS = 2`），否则跳过，理由是 `single_matter_evidence: 证据仅覆盖 N 个不同案件`。同一个案件的证据是豁免的。

为什么要求跨 2 案？因为一个案件里的做法很可能只是这单的约定，不是你的立场。跨两案才勉强算「习惯」。

还有一组**冲突检查**（这是最容易出事的地方）：

| 跳过原因            | 含义                             |
| ------------------- | -------------------------------- |
| `client_conflict`   | 当前客户曾经是证据来源案件的对方 |
| `client_conflict`   | 当前对方曾经是证据来源案件的客户 |
| `client_specific`   | 证据全部来自其他客户             |
| `opponent_specific` | 证据全部来自其他对手的案件       |

最后还有一条全局规则：没指定案件（全局提示词）时，如果证据只来自**一个**客户，也不注入，理由 `client_specific: 证据全部来自单一客户，不进全局提示词`。

换句话说，一个客户的偏好不许变成你的通用立场。这条如果没做，律所做多个客户时会直接出利益冲突。

排序方式是 `衰减后置信度 × 出现次数`，默认最多注入 8 条（`max = 8`）。

注入时的措辞是「已按你确认的条款立场：」，然后逐条列 `【条款类型】偏好措辞`。**「你确认的」是重点**——立场库里的东西都是确认过的，不是猜的。

### 置信度怎么算

`stanceConfidenceFromEvidence` 用的是一个叠加公式：`1 − Π(1−w)`，各来源权重（`STANCE_SOURCE_WEIGHT`）是：

| 来源            | 权重 |
| --------------- | ---- |
| `habit_adopt`   | 0.5  |
| `manual`        | 0.45 |
| `revision_pack` | 0.4  |
| `redline`       | 0.25 |

意思是：一次习惯采纳比一次红线编辑更有说服力（红线可能只是这单的调整）。

### 预置的两条

`firm-defaults.ts` 在立场库为空时种两条（`ensureFirmStanceDefaults`）：

- **管辖**：`争议提交一家明确的仲裁机构或一家有管辖权的人民法院，不写或裁或诉。`（置信度 0.45）
- **定金**：`定金不超过主合同标的额的百分之二十。`（依据民法典第 586 条，置信度 0.45）

这两条在中国法下是常见口径，所以空库时写在立场文件里，供律师打开看。**它们不进提示词。** `selectInjectableStances` 看到 `firm_default_` 前缀就跳过，原因是 `unconfirmed_firm_default`。

以前置信度 0.45 刚好超过 0.4，又没有证据账本，于是空库会被说成「已按你确认的条款立场」，模型可能按 20% 去改定金、按「不写或裁或诉」去改管辖。定金是否压到法定上限、管辖写仲裁还是法院，是交易结构判断，不能靠预置句替律师做。律师自己采纳或从改稿里确认之后，才走上面的注入门槛。

### 自查

`stanceSelfCheck` 会在成品里找「说好的立场没落实」。它拿偏好措辞的前 16 个字符去正文里找，找不到就报一条 `stance.unapplied`（严重度 `info`，不可自动修）。规则是：正文短于 20 字就不查，针短于 8 字也不查。

## 6.11 历史扫描：从旧文件夹里学习惯

`src/lawmind/historical-scan/` 干的事是：扫描你自己的历史文件夹，看看能总结出什么。

边界卡得很死（`types.ts`）：

| 限制             | 值                           |
| ---------------- | ---------------------------- |
| 最多扫描根目录   | 3（`MAX_SCAN_ROOTS`）        |
| 最多文件数       | 2000（`MAX_SCAN_FILES`）     |
| 最大深度         | 8（`MAX_SCAN_DEPTH`）        |
| 习惯最少出现次数 | 5（`HABIT_MIN_OCCURRENCES`） |

会跳过的目录：`node_modules`、`.git`、`.svn`、`dist`、`release`、`__pycache__`、`.lawmind`，以及所有点开头的目录。符号链接直接跳过，而且用 `realpathSync` + `isPathInsideRoot` 防「软链跳出去」。

### 产出什么

- 任务记录：`lawmind/historical-scan/jobs/<scanId>.json`
- 根目录配置：`lawmind/historical-scan/roots.json`
- 增量游标：`lawmind/historical-scan/cursor.json`（记每个文件的 mtime 和大小）
- 建议：写进记忆采纳队列，两类——`scope: "project"` / `kind: "historical.knowledge"`，和 `scope: "lawyer"` / `kind: "lawyer.habit_pattern"`（后者标注 `note: "habit_min_5"`）

采纳后落到 `memory/topics/historical-scan.md`。

### 习惯从哪来

`extractHabitsFromRedlines` 读的是 `drafts/*.redline.json`——也就是系统自己产出的改稿记录。它会：

- 冲突时保留 mtime 最新的改后文本。
- 只有出现次数 **≥ 5 次**才入队。

从 5 次才开始，是为了排除偶然。改过两次的习惯不值得记住。

### 分类

`classifyDocKind` 按文件名和内容分五类：合同、诉讼、证据、函件、其他。另外还有 `classifyLayout` 判断目录是不是「杂乱的」——条件是目录名是 `desktop`/`downloads`/`桌面`/`下载`/`未分类`/`tmp` 这类，或者目录里文件少于 2 个。

这个判断是为了生成「这个目录该整理一下」的建议。

## 6.12 助手档案与成长

每个助手有自己的档案，路径是 `assistants/<assistantId>/PROFILE.md`（`lawMindRoot` 下，与 `assistants.json` 同级）。注意：**不是**在工作区里，而在应用根目录。

档案写入格式是一段带时间戳的块：

```text
---

## <ISO 时间>
<一行内容>
```

去重规则：同一个任务 id + 「草稿审核」的重复不写。

助手还有几个结构性字段（`AssistantProfile`）：`orgRole`（`lead`/`member`/`intern`）、`reportsToAssistantId`（汇报对象）、`peerReviewDefaultAssistantId`（互审首选）。这些会变成提示词里的组织信息（`org-prompt.ts`），比如「向 **某某** 汇报」「建议互审：**某某**」。

校验有三条硬规则，违反会报错：

- 汇报对象不能是自己。
- 汇报对象必须存在。
- 互审默认对象不能是当前智能体自己。

**复制助手不会复制记忆**（`duplicateAssistant`）：角色和 org 关系会拷，`PROFILE.md` 和统计不会。这是有意的——复制一份助手的性格可以，复制它的经历没意义。

成长报告（`src/lawmind/learning/assistant-growth.ts`）把几件事拼在一起：生命周期统计、按窗口的产品事件、待确认的采纳、改稿幅度。窗口默认 30 天，夹在 1–365 之间。

## 6.13 重写幅度：一个差点测错东西的指标

`src/lawmind/learning/rewrite-amplitude.ts` 记录「改稿改了多大」，存 `quality/rewrite-amplitude.json`。

它本身没有阈值，是个纯指标。但它的注释记了一次**口径错误**，值得一读：

> `source` **必须能区分两种改稿**（2026-09-22 补记）… 之所以补这个字段，是因为此前只有 `draft-revision` 一条路径产出样本，而律师最常用的直接改稿路径**不产出** —— 于是「改稿幅度」实际测的是助手，与它要回答的问题不符。

说白了：这个指标本来想问「律师把我写的稿改了多少」，但因为没有记录律师直接改的那条路径，实际测的是「后台修订助手把稿改了多少」。问题问的和测得的是两回事。修法就是加一个 `source` 字段（`assistant_revision` / `lawyer_edit`）。

## 6.14 实现：写入网关与锁

`src/lawmind/memory/write-gateway.ts` 是「Markdown 记忆改动」的统一入口。它的定位写在头部注释里：

> New agent/engine writes should go through this module so adoption-service can eventually own all persistence. Direct `memory/index.ts` append helpers remain for engine hot paths but are routed here from agent tools.

最有代表性的调用方是 `add_case_note` 工具：

```ts
writeCaseMemorySection({
  workspaceDir,
  matterId,
  section,
  content,
  trackAdoption: true,
  origin: "agent",
  actorId: ctx.actorId,
});
```

`section` 只允许五个值（`CaseMemorySection`）：`core_issue`、`risk`、`progress`、`artifact`、`task_goal`。每个映射到 CASE.md 的一个小节。

**CASE.md 有专门的锁**（`case-md-lock.ts`），头部注释解释了为什么：

> Serialize CASE.md read-modify-write per matter. Concurrent appends/projections otherwise lose updates (empty §9, torn templates).

「torn templates」说的是：两个写入者同时改同一个文件，结果模板被撕成两半。锁的键是 `工作区\0案件id`。

### 进度条目也会轮转

CASE.md 的「八、工作进展记录」超过上限（`PROMPT_WINDOW.caseProgressMaxBullets = 80`）时，最早的会挪到 `cases/<matterId>/progress-archive.md`，并在原位留一行说明：

```text
- _（更早 N 条已轮转省略；完整历史见 progress-archive.md）_
```

**注意这是两层修剪，别只看 80**：80 是**文件级轮转**的上限（超过才挪去 archive）；真正进提示词时 `windowCaseMarkdownForPrompt` 还会再收到 **24 条**（内部常量 `keep = 24`），并补一行「更早 N 条进展已省略」。所以提示词里看到的进展永远不超过 24 条——轮转是为了让文件有界，24 是为了让 token 有界。

### MEMORY.md 的迁移

`memory-md-migrate.ts` 处理的是一件历史遗留：旧版本的工作区里 `MEMORY.md` 带着 2025 年的过时口径（比如「调用外部模型前告知预估消耗」「禁止将案件材料发送至外部服务」）。这些口径现在不对了，但**不能**直接重写整个文件——律师自己写的积累会丢。

所以它做的是「只改过期的库存行」，靠一份 6 条特征串（`STALE_MARKERS`）来识别哪些是库存内容。头部注释就是：

> Rewrite expired stock MEMORY.md policy without wiping lawyer-written notes.

## 6.15 HTTP 端点一览

| 端点                                                  | 作用                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/memory/adoption?scope=&state=&matterId=`    | 列建议（默认只 pending）；`unified=1` 会合并学习队列 |
| `GET /api/memory/adoption/:id/preview-diff?matterId=` | 采纳前看差异（404 表示找不到）                       |
| `POST /api/memory/adoption/suggest`                   | 提交一条建议（`origin: "lawyer"`）                   |
| `POST /api/memory/adoption/adopt`                     | 采纳单条                                             |
| `POST /api/memory/adoption/adopt-batch`               | 批量（`dryRun !== false` 时只预览）                  |
| `POST /api/memory/adoption/dismiss`                   | 忽略                                                 |
| `GET /api/memory/sources?matterId=&assistantId=`      | 记忆来源分层（含是否进提示词）                       |
| `GET /api/memory/source-text?path=&maxChars=`         | 只读看某个记忆文件的片段（maxChars 夹在 200–16000）  |
| `GET /api/memory/adoptions?assistantId=`              | 已落盘的「认知升级建议」行（最多 40 条）             |
| `GET /api/learning/suggestions`                       | 学习队列                                             |
| `GET /api/learning/contract-revisions`                | 合同修订积累包列表                                   |
| `GET /api/assistants/growth`                          | 助手成长报告                                         |
| `GET /api/historical-scan`（含加根目录、跑扫描等）    | 历史扫描                                             |

## 6.16 关键文件

| 关注点         | 文件                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 记忆加载与路径 | `src/lawmind/memory/index.ts`、`case-workspace.ts`、`memory-sources.ts`                                                                                                                    |
| 采纳状态机     | `src/lawmind/memory/adoption-service.ts`                                                                                                                                                   |
| 批量采纳       | `src/lawmind/memory/batch-adoption.ts`                                                                                                                                                     |
| 写入网关       | `src/lawmind/memory/write-gateway.ts`                                                                                                                                                      |
| CASE 锁与写入  | `src/lawmind/memory/case-md-lock.ts`、`case-writes.ts`                                                                                                                                     |
| 档案与提示词   | `src/lawmind/memory/lawyer-profile-for-prompt.ts`、`lawyer-profile-learning.ts`                                                                                                            |
| 提示词预算     | `src/lawmind/memory/prompt-windows.ts`                                                                                                                                                     |
| 采纳落盘       | `src/lawmind/memory/adoption-apply.ts`、`memory-target-path.ts`、`adoption-preview-diff.ts`                                                                                                |
| 跨案召回       | `src/lawmind/memory/similar-case-recall.ts`、`relevant-recall.ts`                                                                                                                          |
| 学习           | `src/lawmind/learning/edit-examples.ts`、`draft-edit-learning.ts`、`rejection-ratchet.ts`、`apply-review-labels.ts`、`rewrite-amplitude.ts`                                                |
| 立场库         | `src/lawmind/stance/`（`store.ts`、`inject.ts`、`capture.ts`、`firm-defaults.ts`、`self-check.ts`）                                                                                        |
| 历史扫描       | `src/lawmind/historical-scan/`                                                                                                                                                             |
| 助手           | `src/lawmind/assistants/`                                                                                                                                                                  |
| 桌面 UI        | `apps/lawmind-desktop/src/renderer/MemoryInspector.tsx`、`LawmindMemorySourcesPanel.tsx`、`LawmindMemoryTruthSources.tsx`、`matter/MatterMemoryInspector.tsx`、`LawmindSettingsMemory.tsx` |

## 6.17 已知坑

- 说「加载了记忆」不等于「模型看到了」。判断方法只有一条：看 `GET /api/memory/sources` 里的 `inAgentSystemPrompt`。
- 空模板不注入这条规则改变时，`lawyer-profile-for-prompt.test.ts` 会红——别改测试来凑。
- §八 轮转把最早的条目挪进归档。指纹窗在装不下时按本轮问句留整条，对不上才留最近的。轮转掉的旧条目不在热文件里，问句也选不中。若模型没跟上某条习惯，先看它是否还在热文件、以及本轮问句是否对得上。
- 空库里的管辖、定金预置条在立场文件里，不在「已按你确认的条款立场」里。
- 带金额、日期或公司名的改稿进案件进展队列（有案件 id 时），不进批量风格采纳。
- `golden/` 和 `edits/` 是两回事：前者是「律师判定为典范」，后者是「律师动过手」。别把改稿写进 `golden/`。
- 立场库不注入不代表立场错了。先看它是不是只覆盖了一个案件、或者证据全来自其他客户。
- 历史扫描的习惯**要出现 5 次**才入队。少于 5 次的改法永远看不到，这是有意的。
- 批量采纳默认 `dryRun`，接口和函数层都是这个默认。写代码调用时别指望它直接落盘。
