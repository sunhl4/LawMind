# 第 58 章 实现精读：分类、路由与执业标准

这一章讲「**这句话是什么活、该按什么标准办**」这件事的完整实现：`router/`（分类）、`routing/`（派给谁）、`triage/`（先干什么）、`contracts/`（合同分类）、`practice/`（执业口径）、`templates/`（模板）。

六个目录，25 个实现文件，但逻辑上是一条链：

```text
指令 → 分类（router）→ 交付物类型（deliverable-meta）→ 承办人（routing）
     → 分诊（triage）→ [合同类再分类（contracts）] → 标准与口径（practice）
     → 模板（templates）
```

## 58.1 关键词路由：三十二条规则

`router/keyword-route.ts` 的定位是「同步、确定性、兜底」：

```text
Keyword-based instruction router (sync, deterministic fallback).
```

它用一个**有序的正则表**（`TASK_KIND_PATTERNS`）：**从上往下找，第一个 `test` 命中的就取它的 kind**。

### 八种 kind

```text
research.general  research.legal  research.hybrid  draft.word
draft.ppt  summarize.case  analyze.contract  unknown
```

### 三十二条规则（按定义顺序，节选关键的）

我把三十二条里最能说明设计意图的挑出来：

| #    | 命中什么                                 | kind               | 说明                                                                          |
| ---- | ---------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| 1    | `起草/拟定/撰写… × 合同/协议`            | `draft.word`       | 起草合同                                                                      |
| 2    | `计算 × 经济补偿/赔偿金/加班费/N+1/2N`   | `draft.word`       | 劳动计算                                                                      |
| 3–17 | **十五个 `EXPLICIT_*` 正则**             | `draft.word`       | 期限/案卷/发票/传票/知产/并购/数据/广告/LPM/家事/资本/破产/刑事/民事阶段/治理 |
| 18   | `修改合同\|合同改稿\|审阅痕迹\|红线稿`   | `draft.word`       | 改稿                                                                          |
| 19   | `合同审查\|审查.*合同\|条款审查`         | `analyze.contract` | 合同审查                                                                      |
| 20   | `催告函\|催款函\|demand letter`          | `draft.word`       | 催告                                                                          |
| 21   | `写/起草… × 意见书/答辩状/代理词/…`      | `draft.word`       | 各类文书                                                                      |
| 22   | `律师函\|催款\|通知函`                   | `draft.word`       | 函件                                                                          |
| 23   | `合同\|协议\|条款`（**带负向先行断言**） | `analyze.contract` | 见下                                                                          |
| 27   | `起诉状\|答辩状\|代理词\|诉讼大纲`       | `draft.word`       | 诉讼文书                                                                      |
| 28   | `摘要\|案情\|summarize`                  | `summarize.case`   | 案件摘要                                                                      |
| 29   | `汇报\|PPT\|幻灯片\|培训课件`            | `draft.ppt`        | PPT                                                                           |
| 30   | `合规卷宗\|调研简报\|学习简报`           | `draft.word`       | **放在 31 之前**，见下                                                        |
| 31   | `检索\|调研\|整理\|背景\|研究`           | `research.hybrid`  | 兜底检索                                                                      |
| 32   | `文件\|文书\|报告\|word\|docx`           | `draft.word`       | 最宽                                                                          |

### 两处刻意安排的位置

**第 23 条的负向先行断言**：

```text
/(?!.*(?:催告函|催款函|demand letter|催告|律师函))(?:合同|协议|条款)/i
```

**它在排除「函件里的合同字样」**。因为第 20、22 条已经把函件归到 `draft.word` 了，但「催款函里提到合同」这种句子会让第 23 条（合同 → 合同审查）也命中——如果不排除，函件会被误判成合同审查。

**第 30 条在第 31 条之前**，代码注释写明了原因：

```text
// Deliverable-shaped research memos (before generic 检索/调研 → research.hybrid)
```

也就是说：**「合规卷宗」这类有明确交付物形状的，要在泛化的「检索/调研」之前判**，否则会被后者抢走。

### 十五个 `EXPLICIT_*` 正则从哪来

它们**不是写在 router 里的**，而是从 `skills/capability-patterns.ts` import 的（第 4 章讲过那个共享叶子模块）。

这是「三处判定不许漂」的落点：**router 的 keyword 表、意图编译、交付物元数据用的是同一批正则**。

我列几条原文，因为它们本身就是很精确的判定：

| 常量                | 正则                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PERIOD_CALC_RE`    | `/(期限计算\|(计算\|起算\|几天内).{0,10}(上诉期\|答辩期\|申请仲裁)\|上诉期.{0,6}(计算\|届满)\|答辩期.{0,6}(计算\|届满))/` |
| `MATTER_INTAKE_RE`  | `/(整理案卷\|整理.{0,8}案件材料\|新建案件\|建立案件\|案件目录\|归位材料\|补卷宗\|按这个文件夹\|按里面的材料)/`            |
| `COURT_SMS_RE`      | `/(法院短信\|12368\|开庭短信\|缴费短信)/`                                                                                 |
| `IP_DISPUTE_RE`     | `/(知产争议\|专利侵权\|商标侵权\|著作权侵权\|被控侵权)/`                                                                  |
| `FAMILY_MATTER_RE`  | `/(离婚诉讼\|抚养权\|探望权\|遗产继承\|婚内财产分割\|遗嘱继承)/`                                                          |
| `CRIMINAL_ROUTE_RE` | `/(取保候审\|会见申请\|审查起诉意见\|刑事辩护提纲\|死刑复核\|侦查阶段)/`                                                  |
| `QUICK_TRIAGE_RE`   | `/(违法吗\|合法吗\|能不能告\|能不能起诉\|有没有责任\|怎么维权\|是否构成\|算不算违法\|这算不算问题)/`                      |

**`CRIMINAL_ROUTE_RE` 有一条注释**：

```text
/** Kind/deliverable routing only — do not steal generic 查一下审查起诉. */
```

**它只认「审查起诉意见」不认「审查起诉」**——因为「查一下审查起诉的规定」是检索任务，不是刑事文书任务。这个细节决定了「查法规」和「写辩护意见」不会互抢。

**`COMPUTE_TABLE_PACK_RE` 也有一条注释**：

```text
/** 路由到核算对照交件；不含裸 .xlsx，避免抢走合同审查。 */
```

**「不含裸 `.xlsx`」**——因为附了 Excel 的合同审查任务不该被路由到核算。

### 风险与确认的推导

```text
inferRiskLevel(kind):
  draft.word / draft.ppt          → high（HIGH_RISK_KINDS）
  analyze.contract / research.legal / summarize.case → medium
  其他                            → low

requiresConfirmation = riskLevel === "high" || kind === "unknown"
```

**「起草类算高风险」是核心判断**：因为草稿是「可能会发出去的东西」。而 `unknown` 也要确认（猜不出来就别乱动）。

### 输出的确定

```text
draft.ppt → pptx
draft.* / analyze.contract / summarize.case → docx
否则 → markdown
```

### 摘要的生成

`buildSummary` 会给出一句中文，格式是：

```text
任务类型：<中文标签>。原始指令：「<前 60 字>…」
```

标签表（九项）：通用检索整理、法律专项检索、联合检索整理、「生成」+输出名、案件摘要、合同审查、对话指令、未识别。

**「未识别」那条的标签是「任务类型未识别，需人工确认」**——它把不确定性写进了摘要，而不是含糊地说一句「处理一下」。

## 58.2 模型路由：一个 strict schema 与三条回落

`router/model-route.ts` 的定位：

```text
Model-driven instruction routing (default on when LLM credentials exist).
```

### `ROUTER_JSON_SCHEMA`

它声明了一个 JSON schema，名字是 `lawmind_router_intent`，六个必填字段：`kind`、`summary`、`riskLevel`、`models`、`requiresConfirmation`、`output`。

各字段的枚举：

| 字段        | 枚举                                                |
| ----------- | --------------------------------------------------- |
| `kind`      | 八种（同上）                                        |
| `riskLevel` | `low` / `medium` / `high`                           |
| `models`    | `["general"]` / `["legal"]` / `["general","legal"]` |
| `output`    | `markdown` / `docx` / `pptx` / `none`               |

**注意 `output` 多了 `none`**——关键词路没有这一档。**它表达的是「这次不产出文书」**（纯检索类）。

### system prompt 里那句「只做分类」

```text
你是法律工作流程路由器，只做分类与风险评估，不输出法律结论。
只输出 JSON，不要 markdown。
```

**「不输出法律结论」是刻意的**：路由是个分类任务，它不该顺手给个法律判断——那样既没经过门禁，也没经过引用核验。

而且要求「不要 markdown」——因为要直接解析 JSON。

### 三条回落

`routeAsync` 的逻辑：

```text
cfg = resolveRouterLlmConfig(lawMindRoot)
keywordIntent = route(input)             ← 关键词结果先算出来（同步，白拿）
modelIntent = cfg ? await routeWithModel(...) : null
resolved = modelIntent ?? keywordIntent  ← 模型失败就用关键词
记录分歧（见下）
if (escalation) return { ...resolved, requiresConfirmation: true }
```

**「关键词结果先算出来」**是有意的——注释解释了原因：

```text
关键词 route() 是同步纯函数，本来就该算（旧实现只在模型失败时才算）
```

因为算它不花钱，所以「无论模型成不成功都算一遍」，才能拿来做分歧比较。

### 模型结果的四条校验

```text
① 解析失败或 kind 不在八种里 → 返回 null（走关键词）
② riskLevel 缺 → inferRiskLevel(kind)
③ models 过滤只留 general/legal，空 → inferModels(kind)
④ requiresConfirmation = 高风险 || unknown || （模型给的布尔值）
```

**第 ④ 步的写法**：模型的布尔值**只能加不能减**——`high` 或 `unknown` 时一定为真，模型说 false 也不管用。这是「安全方向只加严」的落地。

## 58.3 三路分歧：不需要概率也能拿到的信号

`router/route-divergence.ts` 是这一章设计最巧的一块。它的头部注释前三行就是核心命题：

```text
核心命题：不需要概率，也不需要新供应商，就能拿到「这次判断可能不可靠」的信号。
不确定性 = 多个便宜且相互独立的判定路径彼此不一致。
```

而 LawMind 天然有三条路，且都不需要额外调用：

| 路径      | 来源                     |
| --------- | ------------------------ |
| `keyword` | 关键词表（同步、零成本） |
| `model`   | 模型分类（本来就要调）   |
| `triage`  | 分诊规则（同步正则）     |

**「三条意见都是白拿的」**——这是这个设计的全部价值。

### 分歧怎么算

```text
kindAgreement = kinds.length <= 1
riskAgreement = riskLevels.length <= 1
isDivergent   = !kindAgreement || !riskAgreement
```

而注释里有一句关键的限定：

```text
只有 0 或 1 条 kind 意见时无从分歧 → 视为一致（不是「通过」，是「不可判」）。
```

**「不是通过，是不可判」**——这个区别很重要：只有一条意见时不能说「三条一致」，只能说「没法比」。

### 三种姿态

| 姿态                 | 行为                           |
| -------------------- | ------------------------------ |
| `off`                | 不记录                         |
| `shadow`（**默认**） | 只记录                         |
| `escalate`           | 记录并把分歧升级成「需要确认」 |

解析时有个优先级细节：

```text
!isRouteDivergenceShadowEnabled() → "off"     ← 主开关优先
```

**主开关（`LAWMIND_ROUTE_DIVERGENCE` / `policy.routeDivergenceShadow`）关掉时，姿态直接是 `off`**——即使姿态设成 `escalate` 也不生效。

### 记录的内容

```text
ROUTE_DIVERGENCE_REL = "lawmind/decision/route-divergence.jsonl"
divergenceKey = `k:${kinds.join(",")}|r:${riskLevels.join(",")}`
instructionHead = instruction.replace(/\s+/g," ").trim().slice(0, 120)
```

**`divergenceKey` 把「哪种分歧」编码成一个键**——所以能统计「最常见的是哪种分歧」（比如「keyword 判合同审查、model 判诉讼文书」出现了多少次）。

指令只留**前 120 字**——这是隐私与体积的双重考虑。

### 「永不抛」

`maybeRecordRouteDivergence` 整体包在 try/catch 里：

```text
分歧记录 + （按姿态）升级。永不抛
```

**记录分歧这件事不许影响路由**——姿态最轻的那个环节不能让主链路失败。

### 升级的方式

```text
escalation → 返回 { ...resolved, requiresConfirmation: true }
```

**升级只是把 `requiresConfirmation` 置真**——不是弹窗、不是拒绝，就是「让律师确认一下这个任务类型」。这是最轻的干预方式。

### 四条中文标签表

它还有四张标签表（`ROUTE_KIND_LABELS_ZH`、`ROUTE_RISK_LABELS_ZH`、`ROUTE_PATH_LABELS_ZH` 等），比如 `keyword → 关键词判断`、`model → 模型判断`、`triage → 分诊规则`。**这些是给界面显示用的**——所以律师看到的是「关键词判断和模型判断不一致」，而不是 `k:analyze.contract|r:medium`。

## 58.4 交付物类型：二十九个分支

`router/deliverable-meta.ts`（**没有头部注释**）是最长的判定函数：`detectDeliverableType(kind, instruction)`。它有二十多个分支，但结构是清楚的。

### 第一优先：显式代码

```text
/交付物类型代码\s*[:：]\s*(report\.compliance|report\.learning|ppt\.training|report\.esg|report\.general)/i
```

**律师可以在指令里直接写类型代码**，这时不猜。这是「显式胜过隐式」的落点。

### 按 kind 分四组

| kind               | 分支数 | 说明                              |
| ------------------ | ------ | --------------------------------- |
| 先判通用           | 1      | Word 改稿 → `contract.general`    |
| `analyze.contract` | 1      | → `contract.review`               |
| `draft.ppt`        | 1      | 培训类 → `ppt.training`，否则不判 |
| `research.*`       | 19     | 一堆 `EXPLICIT_*` 正则 → 各种类型 |
| `draft.word`       | 27     | 最密的一段                        |

### 几个「不能搞错」的顺序（都有注释）

**第一条注释**：

```text
// Compliance dossier before ESG heuristics — EU/NEV +「合规」must not become report.esg.
```

**「欧盟 + 新能源汽车 + 合规」不能被判成 ESG 报告**。所以 `COMPLIANCE_DOSSIER_RE` 要排在三个 ESG 正则之前。

**第二条注释**：

```text
// Outline HITL is asked after deep-research / draft gate persists an evidence outline —
// not at plan time (template-only outlines must not be rubber-stamped).
```

**这句话解释了「为什么大纲确认不在这个阶段做」**：模板级大纲不该被橡皮图章式地批准。所以 HITL 挪到大纲真正落盘之后（第 54.5 节）。

### 合同家族的细分顺序

在 `draft.word` 那一组里，函件与诉讼文书的判定顺序很讲究（我按代码顺序列）：

| 顺序  | 命中                                   | 类型                   |
| ----- | -------------------------------------- | ---------------------- |
| 1     | 房屋/住宅/商铺… × 租赁合同             | `contract.rental`      |
| 2     | 回函/答复函（且非合同协议）            | `letter.reply`         |
| 3     | 催款函/催告函/违约通知                 | `letter.demand`        |
| 4     | 律师函/通知函/告知函                   | `letter.counsel`       |
| 5     | 答辩状                                 | `litigation.answer`    |
| 6     | 代理词/辩护词                          | `litigation.brief`     |
| 7     | 起诉状（且非大纲提纲）                 | `litigation.complaint` |
| 8     | 诉讼大纲/提纲/要点                     | `litigation.outline`   |
| 9     | 法律意见书（且非「查一下/检索/法条」） | `memo.opinion`         |
| 10    | 内部备忘/工作备忘                      | `memo.internal`        |
| 11    | 时间线/大事记                          | `matter.timeline`      |
| 12    | 证据目录/清单                          | `matter.exhibit_list`  |
| 13    | 会议纪要/记录                          | `meeting.minutes`      |
| 14    | 保密协议/NDA                           | `contract.nda`         |
| 15    | 合规章宗类                             | `report.compliance`    |
| 16–18 | 三种 ESG 判定                          | `report.esg`           |
| 19    | 调研简报/学习简报                      | `report.learning`      |
| 20    | 研究报告/白皮书                        | `report.general`       |
| 21    | 合同/协议/授权书                       | `contract.general`     |
| 22    | 兜底                                   | `document.general`     |

**三条「且非」**：

- 起诉状要 `且非（大纲|提纲）`——「起诉状大纲」是提纲不是起诉状。
- 法律意见书要 `且非（查一下|检索|法条）`——「查一下法律意见」是检索任务。
- 回函要 `且非（合同|协议）`——「回这个合同的函」优先当合同相关。

**每一条「且非」对应一个曾经会搞错的组合。**

### 两个「锁定」判据

`isLockedResearchDeliverableType` 与 `enrichIntentWithDeliverableMeta` 里有个优先级判断：

```text
preset 优先 = baseIntent.deliverableType 已存在
             且（是锁定的研究类 || 是 report.esg || 是 report.general）
```

也就是：**这三类是「已经定好就别再猜」的**。

而 `analysis.table` 有两条特殊处理：

```text
next.riskLevel = "medium"
next.requiresConfirmation = false
```

**核算对照降成中风险且不要确认**——因为它是「算数」，不是「写法律意见」。

### 验收标准与澄清问题也在这

`acceptanceCriteriaFor(type)` 为每个类型返回中文验收标准（比如 `report.compliance` 那条含「不确定处标 `[VERIFY]`；新闻不得写成现行法」）。

`clarificationQuestionsFor(type, instruction)` 给九种类型产出澄清问题。

**这两张表是「类型 → 该怎么办」的权威**。它们和第 12 章的规格表有重叠但不完全一样——**规格表管「验收」，这里管「计划阶段的提示」**。

## 58.5 交办门：Soft Ask 与硬闸的同一段代码

`router/intake-gate.ts` 的两句话定义了它的全部：

```text
Intake clarification: Soft Ask by default; hard-gate only high-risk empty runs.
```

### 六条「直接跳过」的判据

`shouldSkipAllIntake` 的顺序：

```text
① 启发式被关（policy 或 LAWMIND_INTAKE=0/false/off/no）
② 文本长度 < 4
③ 命中「已填交办」标记（【交办】/【办件】/交付物类型：/交办要点：）
④ 命中「跳过澄清」（继续不澄清/直接做/别再问了…）
⑤ 是邮件短路径 / Word 改稿 / 命中钉选材料标记
⑥ 有 contextPins
```

**第 ③④ 条是「律师已经说了」和「律师说别问」两类**。第 ⑤⑥ 条是「材料已经在指令里了」——**材料给足就不该再问**。

第 ⑤ 条那个钉选正则很长，识别六种形式：

```text
contract_edit_baseline_path=    cases/<id>/mail/attachments/    contextPins
@file/@evidence/@clause/@playbook    钉选    附件路径    baselineRelativePath
LawMind 文件页
```

### 两个函数共用前四步

`resolveIntakeAdvisoryQuestions`（Soft Ask）与 `resolveIntakeClarificationQuestions`（硬闸）**前四步完全一样**：

```text
① 该跳过 → []
② 没有 deliverableType 或没有 questions → []
③ 案件记忆已经填过 → []
④ 是高风险空跑 → 【这里分道】
```

**第 ④ 步是唯一的分岔**：

| 函数     | 高风险空跑时                            |
| -------- | --------------------------------------- |
| Soft Ask | 返回 `[]`（**不做软问**，因为要转硬闸） |
| 硬闸     | 返回 questions（**做硬闸**）            |

**同一份输入，一个负责「不该软问」一个负责「该硬问」**。这样设计的好处是：两个函数可以独立调用，而行为必然互补——不会出现「软问也问、硬闸也问」或者「两个都不问」。

### 高风险空跑的七类白名单

```text
letter.demand  letter.counsel  letter.reply
litigation.outline  litigation.complaint  litigation.answer  litigation.brief
```

**全是「对外文书」**——函件和诉讼文书。因为这几类写错了代价最高（可能直接发出去或提交法院）。

### 案件记忆「已经填过」的判据

```text
text.length >= 40
且 hasParties（当事人|甲方|乙方|原告|被告|出租人|承租人|委托人）
且 hasType（有 deliverableType，或命中交付物/文书类型/合同审查/律师函/起诉状/租赁/ESG/意见书）
```

**两条同时成立才算填过**：光有当事人不够（还是得问要出什么），光有类型也不够（还是得问当事人）。

### Soft Ask 的提示块

`router/intake-craft.ts` 的正文**不是手写的**，而是读内置技能：

```ts
INTAKE_CRAFT_SKILL = readBuiltinSkillMarkdown("intake-required-inputs") ?? "…兜底一句…";
```

**「单一来源」在这里是字面意义的**：技能文件和 prompt 正文是同一份。

提示块的头两行固定：

```text
## 交办 Soft Ask（不冻结写工具）
下列信息若仍不确定，可在推进中向律师追问或标【待补充】；材料已钉选时优先推断并执行：
```

**「不冻结写工具」和「优先推断并执行」**——这两句是 Soft Ask 的全部要求：**问，但不拦**。

## 58.6 默认承办人：五级回落

`routing/defaults.ts` 管 `workspace/lawmind/routing/defaults.json`（版本 `1`）。

默认配置只有三条：

```text
byKind:            { "draft.word": contract_review, "contract.review": contract_review }
byDeliverableType: { "contract.review": contract_review }
forcePeerReview:   null
```

**默认只配了合同相关**——其他类型走「没有默认承办人」那条路。

### `source` 的五种取值

`ResolveDefaultAssigneeResult.source` 有五种：

| source        | 含义             |
| ------------- | ---------------- |
| `explicit`    | 调用方显式指定了 |
| `assistantId` | 按助手 id 命中   |
| `roleId`      | 按角色命中       |
| `fallback`    | 用了兜底         |
| `none`        | 谁都没有         |

**这个字段是排查的关键**：界面/日志能告诉你「为什么派给了他」。

### 三个审计事件

```text
routing.resolve_ok
routing.resolve_fallback         ← 带 reason: "no_assistant_for_role"
routing.resolve_failed
```

**「有角色但没助手承担」会单独记一条**（`no_assistant_for_role`）——这告诉运维「规则对了，但人没配」。

## 58.7 强制互审：六种跳过原因

`routing/peer-review-gate.ts` 的头部注释说明了它的行为边界：

```text
When force peer review is effective and the author has a peer, register a
pending delegation for peer review (does not auto-run an agent turn).
Caller still opens the lawyer queue; title should mention 互审 when applied.
```

**「does not auto-run」**：它只登记一条待办委派，不直接跑。**是否真的跑由律师决定**。

### 六种跳过原因（按判定顺序）

| 顺序 | 情况                 | reason        |
| ---- | -------------------- | ------------- |
| ①    | 版本没开这个功能     | `edition_off` |
| ②    | 没有作者             | `no_author`   |
| ③    | 作者没配互审对象     | `no_peer`     |
| ④    | 互审对象就是作者自己 | `self_peer`   |
| ⑤    | 互审对象查不到       | `no_peer`     |
| ⑥    | 出异常               | `error`       |

`no_author`、`no_peer`、`self_peer` 会记审计 `draft.peer_review_skipped`。`edition_off` 和 `error` 只返回原因，不写这条审计。

### 派发时的三件事

派出去的委派任务：

1. **优先级固定 `high`**
2. **任务头是固定的三行**（有案件时是四行）：

```text
【强制互审】请审阅草稿「<标题>」（任务 <taskId>）。
对照本所口径与作者角色职责，标出必须修改项与可放行项；完成后交律师签批。
案件：<matterId>          ← 仅当有案件
```

3. **记两条事件**：审计 `draft.peer_review_required` + 协作事件 `delegation.created`

那行「对照本所口径与作者角色职责」**同时点了两个参照**：——本所口径（`practice/`）和作者角色职责（`core/role.ts`）。所以互审不是泛泛地看，而是有明确比对对象。

## 58.8 分诊：五条规则与三档

`triage/` 只有四个文件，但它的规则表很有意思。

`types.ts` 定义了三个档：

```ts
TriageTier = "green" | "yellow" | "red";
```

而且有中文标签（注释写明是「Lawyer-facing Chinese label」）：

| tier     | 标签       |
| -------- | ---------- |
| `green`  | 可直接执行 |
| `yellow` | 需律师确认 |
| `red`    | 必须先澄清 |

### 五条规则（按定义顺序）

`rules.ts` 的注释说明了取用逻辑：

```text
Pure rule engine — highest tier wins; first matching rule of that tier keeps clarifications.
```

| id                       | tier    | 工作流        | 命中条件                                                                    |
| ------------------------ | ------- | ------------- | --------------------------------------------------------------------------- |
| `litigation-red`         | **red** | 诉讼材料分诊  | 含诉讼类词（起诉/应诉/开庭/仲裁/答辩状/代理词…）**且不含**「咨询/了解一下」 |
| `nda-yellow`             | yellow  | NDA 标准审查  | `hint === "contract.nda"` 或含 NDA/保密协议等                               |
| `contract-review-yellow` | yellow  | 中国合同审查  | hint 以 `contract` 开头，或含合同审查/审 MS A/SOW/采购合同                  |
| `demand-letter-yellow`   | yellow  | 催告/劳动催告 | `hint === "letter.demand"` 或含律师函/催告/违约通知                         |
| `simple-green`           | green   | 通用文书交办  | 非空、<400 字、且不含诉讼仲裁起诉                                           |

**`litigation-red` 的那个「且不含」是关键**：

```text
/起诉|应诉|开庭|诉讼|仲裁|强制执行|保全|答辩状|代理词/ && !/咨询|了解一下/
```

**「咨询一下起诉流程」不该被判成 red**。这条否定了「看到诉讼词就升级」的做法。

**`simple-green` 的三条限制**（非空、<400 字、不含诉讼）也很实际：**太长的描述说明它不简单**。

### 每条的澄清问题（原文）

`litigation-red` 三条（都 required）：

```text
各方当事人全称与诉讼地位？
最近法定期限或开庭日？
核心诉讼请求或答辩要点？
```

`nda-yellow` 两条：

```text
我方是披露方、接收方还是双方互惠？   ← required
期望保密义务期限？                    ← 可选
```

`contract-review-yellow` 一条（可选）：

```text
我方风险偏好（偏严 / 中性 / 促成交）？
```

`demand-letter-yellow` 两条（都 required）：

```text
主张金额或履行内容？
关键违约事实要点？
```

`simple-green` **没有澄清问题**——它是最轻的一档。

### 一条「空输入也要立案」的规则

空输入时不是返回空，而是返回一个 red：

```text
tier: red
reasons: ["未提供任务描述或材料摘要，无法分诊。"]
clarifications: [{ key: "brief", question: "请简述任务目标与关键材料。", required: true }]
matchedRuleIds: ["empty-input"]                      ← 专门一个 id
workflowId: general-deliverable
```

**`matchedRuleIds: ["empty-input"]` 这个专属 id 很有用**：它让「空输入」在统计里可区分。

### 兜底（没命中任何规则）

```text
id: "fallback-green", tier: "green"
reason: "未命中专项规则，按通用交办处理。"
```

**没命中就当 green**——因为「没命中」在这个规则集里意味着「没看到风险信号」。

### 理由的收集有个上限

```text
matched.filter(r => r.tier === bestTier || matched.length <= 2).map(r => r.reason)
```

**只有 ≤2 条命中时才全列**；命中的多时只列「最高档那些」。**这是防「理由一大堆」**。

### 分诊会话的开关

`storage.ts` 的 `triageBlocksHeavyExecute`（注释：`Heavy tools blocked until confirmed when tier is yellow/red.`）：

```text
没有会话 → false（不拦）
status === "confirmed" → false
否则 yellow 或 red → true
```

**`green` 不拦**——所以「可直接执行」真的是可直接执行。

而 `confirmTriageSession` 有一条硬门：

```text
tier 是 red 或 yellow 且 required 的澄清项没答 → 抛 `missing_clarification:<key>`
```

**注意它是逐个 key 报的**，所以界面能定位到是哪一项没答。

## 58.9 封闭十二类：合同分类

`contracts/closed-contract-type.ts` 的头部注释三句：

```text
Closed 12-type contract router for opinion/draft paths.
Independent of NC copilot copy. Never blocks. Mail/Word tracked redline do not use this.
```

**「Never blocks」和「邮件/Word 改稿不用」**都是边界。

### 十二类（含定义顺序）

| #   | id             | 标签       |
| --- | -------------- | ---------- |
| 1   | `sale`         | 买卖       |
| 2   | `lease`        | 租赁       |
| 3   | `service`      | 服务       |
| 4   | `ip`           | 知识产权   |
| 5   | `security`     | 担保       |
| 6   | `loan`         | 借贷赠与   |
| 7   | `internet`     | 互联网协议 |
| 8   | `family`       | 婚姻家事   |
| 9   | `employment`   | 劳动用工   |
| 10  | `real_estate`  | 房地产     |
| 11  | `construction` | 建设工程   |
| 12  | `investment`   | 公司投资   |

### 匹配顺序与定义顺序**不一样**

`RULES` 的顺序（**这就是优先级**）是：

```text
employment → construction → lease → loan → security → family
→ investment → internet → ip → real_estate → sale → service
```

**注意 `employment` 排第一，而 `sale` 排倒数第二**。

**为什么**：「劳动合同」里有「合同」，「服务合同」里有「服务」——如果把宽泛的规则放前面，会抢走具体的。`employment` 放第一是因为它的词最具体（竞业限制、劳务派遣）。

而 `service` 排最后：它是最宽的一类（服务合同/委托合同/顾问协议），作为「其他类合同」的近似兜底。

### 一条「不另起第 13 类」的纪律

`inferClosedContractType` 找不到匹配时**不返回空**，而是：

```text
默认 id: service（服务）
```

而输出文案里两处都强调了这条纪律：

```text
类型：<标签>。封闭 12 类，不另起第 13 类。
其他类型归入最接近的一类，不要另起第 13 类。
```

**「封闭集合」的意义**：如果允许「其他类」，那「其他」会变成垃圾桶，清单就没法维护了。

### 兼类的处理

命中多条时，第一条是主类，第二条是 `secondary`：

```text
类型：租赁（兼买卖）。封闭 12 类，不另起第 13 类。
```

### 宏观与中观：十二类各有一段

`MACRO_FOCUS`（宏观先核什么）与 `MESO_FOCUS`（中观先核什么）各 12 条。我举两条对比它的写法差异：

| 类             | 宏观                                                                   | 中观                                             |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| `sale`         | 主体签约权限、标的规格数量、价款与交货验收是否闭环、所有权与风险转移。 | 框架协议与订单、质量附件、交货计划是否互相打架。 |
| `construction` | 承包范围工期、价款变更签证、质量保修、分包与索赔。                     | 图纸、工程量清单、签证变更与施工合同是否打架。   |

**宏观是「结构上少了什么」，中观是「文件之间是否矛盾」**。这个二分很清晰。

### 两个格式化函数

```text
macro: 「类型：<标签>。宏观先核：<MACRO> 无全文时先列这几处待核，不要空白暂停。」
meso:  「中观先核：<MESO> 缺附件标【待核实】，仍给已读正文的意见。」
```

**两句都以「不要停下来」结尾**——「不要空白暂停」「仍给已读正文的意见」。

## 58.10 执业口径：三份可配置的标准

`practice/` 有六个文件，对应三种「律师可配的标准」：

| 文件                    | 配什么                                 | 存哪                             |
| ----------------------- | -------------------------------------- | -------------------------------- |
| `practice-playbook.ts`  | 总体口径（立场、争议解决、永不接受）   | `lawmind/practice-playbook.json` |
| `user-standards.ts`     | 具名标准（按合同类型/客户/关键词绑定） | `lawmind/standards/`             |
| `bilateral-review.ts`   | 纸侧与交易角色（推出来的，不存）       | —                                |
| `liability-cap.ts`      | 责任上限四位置（推出来的）             | —                                |
| `lpm-matter-columns.ts` | 办案周报等栏目（推出来的）             | —                                |

### 默认口径只有六个字段

`DEFAULT_PRACTICE_PLAYBOOK`：

```ts
{
  schemaVersion: 1,
  stanceDefault: "protect_instructing",
  governingLaw: "PRC",
  disputeForum: "写明有管辖权的人民法院或仲裁；反对仅约定对方所在地且对我方明显不利。",
  neverAccept: ["无限责任", "排除人身/故意/重大过失责任的条款不经提示", "仅对方所在地单方管辖"],
  notes: "",
}
```

**「永不接受」那三条与 `liability-cap.ts` 的 `NEVER_HINTS` 是同一组**——一处配置、一处判定。

### 三个立场

`practice-playbook-constants.ts` 单独存在，原因是注释写的：

```text
Browser-safe practice-playbook constants (no node:fs / node:path).
Disk I/O stays in practice-playbook.ts for engine / local API.
```

| id                    | 标签                         |
| --------------------- | ---------------------------- |
| `protect_instructing` | 中立偏委托方（**开箱默认**） |
| `our_paper`           | 偏己方纸                     |
| `neutral`             | 中立                         |

**默认是「中立偏委托方」**——不是纯中立。这个默认值表达了产品的立场：**系统站在委托方一侧，但不激进**。

### 三个上限

| 字段           | 上限    |
| -------------- | ------- |
| `notes`        | 2000 字 |
| `disputeForum` | 500 字  |
| `neverAccept`  | 20 条   |

### 两条注入边界

`shouldInjectPracticePlaybook`（注释：`Mail short path and Word tracked redline keep their frozen prompts.`）：

```text
没有绑定 → false
修订轨管线 → false
mail.contract → false
其他 → true
```

**「冻结提示的两条路不注入」**是反复出现的边界——那两条路有自己的口径，不能混。

### 具名标准：四条内置

`user-standards.ts` 的四条内置：

| id                              | 标题             | kind                | 绑定条件                                | 条目数 |
| ------------------------------- | ---------------- | ------------------- | --------------------------------------- | ------ |
| `builtin-contract-review`       | 通用合同审查口径 | `contract_review`   | 无（总是匹配）                          | 2      |
| `builtin-mail-triage`           | 每日邮件待回复   | `daily_triage`      | 关键词：请尽快/请确认/请回复/烦请       | 1      |
| `builtin-litigation-intake`     | 诉讼收案核对     | `litigation_intake` | 关键词：起诉状/谈话整理/收案…           | 3      |
| `builtin-cn-contract-checklist` | 中国合同审查清单 | `contract_review`   | 合同类型（除 service 的十一类）+ 关键词 | 4      |

**第一条「无绑定条件」的匹配规则**有个细节：

```text
!hasBind → standard.kind === "contract_review" || standard.kind === "daily_triage"
```

也就是：**无绑定条件的内置标准只在合同审查和每日分诊两个场景默认生效**。其他场景要显式绑。

### 三种条目标签（tone）

| tone           | 界面标签     |
| -------------- | ------------ |
| `check`        | 核对         |
| `never_accept` | 原则上不接受 |
| `must_rewrite` | 必须改写     |

**「必须改写」这一档很有用**：它不是「接受不接受」的问题，而是「这份稿子必须改这几个地方」。

### 学习来的标准默认不启用

`proposeLearnedStandard` 固定：

```text
kind: "contract_review"
source: "learned"
enabled: false          ← 关键
```

注释写明了：

```text
Learned candidates stay disabled until confirmed.
```

**这和第 6 章那条「未确认零写入」是同一个姿态**：学到的东西默认不生效，要律师确认。

### 内置标准删不掉

`deleteUserStandard` 对 `id.startsWith("builtin-")` 返回 false。

### 注入边界

`shouldInjectUserStandards` 的判据：

```text
没有绑定 → false
修订轨 或 mail.contract → false
id ∈ { contract.review, contract.draft, litigation.talk, litigation.draft } → true
```

**只在四类任务上注入具名标准**——它们都是「要按标准审/写」的场景。

### 纸侧与交易角色

`bilateral-review.ts` 的两套判定：

**纸侧**（三条正则可判）：

| 命中                                                | 纸侧          |
| --------------------------------------------------- | ------------- |
| 我方合同/模板/范本/我方起草/我方出具                | `our_paper`   |
| 对方合同/模板/范本/对方出具/甲方提供的合同/乙方模板 | `their_paper` |
| 其他                                                | `unknown`     |

**交易角色**（`inferDealRole`，有序）：

```text
① 我方采购/作为买方/采购合同/购销 → buy
② 我方销售/作为卖方/销售合同/供货方立场 → sell
③ 封闭类型是 sale 时再判：含销售不含采购 → sell；含采购或供货 → buy
④ 其他 → unknown
```

**第 ③ 层是「只在确认是买卖合同族时才用宽词」**——这是防止「销售」二字在别的语境里误判。

提示块里最实用的是那三条「未写明时怎么办」：

```text
未写明纸侧：按对方稿审（中立偏委托方），不要停下来三问
未写明买卖角色：按封闭类型的交易结构审，责任上限四个位置都要看
```

**「不要停下来三问」**——这是第 1 章那条「中间步骤不打断律师」在提示词层面的落点。

还有一行标准写法：

```text
标准：直接损失有上限；间接/可得利益默认排除；人身/故意/重大过失/知识产权/数据泄露作 carve-out。
可接受回退：上限金额可谈；管辖可改为双方所在地或约定仲裁。
```

**这就是 `contract-playbook-review` 那份技能的三档结构**（标准 / 可接受回退 / 永不接受），在这里落成具体条文。

### 责任上限：四个位置 + 破局条款

`liability-cap.ts` 的头部注释点了它的来源：

```text
责任上限四个位置 + 破局条款. Anthropic playbook structure, independent copy.
```

**「independent copy」**：借鉴结构，文案自己写。这是第 1 章那条「吸收而非套壳」的落地。

四个位置的抽取规则（每个都有「交办写了就用，没写给默认」的分支）：

| 位置          | 有信号时                         | 无信号时                             |
| ------------- | -------------------------------- | ------------------------------------ |
| 直接损失上限  | 命中断言「无限责任」时给警告文案 | 默认应有上限                         |
| 间接/可得利益 | 交办点名时「按排除或单独限额核」 | 默认排除                             |
| carve-out     | （固定文案）                     | 人身/故意/重大过失/知识产权/数据泄露 |
| 基数定义      | 交办写了合同总额/已收价款        | 标【待补充】                         |
| 破局条款      | （固定文案）                     | 付款/验收闭环、单方解除、争议解决    |

**注意「基数」那条的文案**：

```text
基数：【待补充】已收价款或合同总额；金额不是唯一位置。
```

**末尾那句「金额不是唯一位置」在纠正一个常见误解**：责任上限不只是一个金额数字，基数定义同样关键。

### 「永不接受」的三条正则

```ts
NEVER_HINTS = [
  { re: /无限责任|不设上限|责任不受限制/, label: "无限责任" },
  { re: /排除人身损害责任|免除故意或重大过失/, label: "排除人身/故意/重大过失责任" },
  { re: /仅约定对方所在地(?:人民法院|管辖)/, label: "仅对方所在地单方管辖" },
];
```

命中后会有一段落地要求（原文）：

```text
永不接受命中：<列表>。落地：改这几个字，不要只写「存在风险」。
```

**「改这几个字，不要只写存在风险」**——它直接把「只提风险不给改法」这种退化挡掉了。

### LPM 栏目：八种内部分栏

`lpm-matter-columns.ts` 的头部注释有四句，其中一句是**产品边界**：

```text
飞书/日历写入不是交件；本稿只出内部口径。
```

也就是：**LPM 备忘是内部文档，不承担「写入外部系统」的职责**。

八种 kind 的判定顺序（注释：`More specific kinds are inferred first.`）：

```text
local_counsel → resource_plan → stakeholder_comms → issuance_list
→ collab_platform → close → scope_change → status
```

**`status`（周报）排最后**——因为它最宽。如果它排前面，「本地顾问对接」这类具体类型的描述里只要出现「办案」就会被抢走。

每种 kind 有自己的章节组。举两组对比：

| kind             | 章节                                                            |
| ---------------- | --------------------------------------------------------------- |
| `status`（周报） | 事项 / 进度 / 期限 / 范围 / 风险与已决 / **置信** / 结论 / 待办 |
| `close`（结案）  | 事项 / 已交付 / 未了结 / 范围回顾 / **可复用** / 结论 / 待办    |
| `scope_change`   | 事项 / 原范围 / 新出现 / **已排除** / 结论 / 待办               |

**周报多一个「置信」节**，而结案多「可复用」、范围变更多「已排除」——**每种 memo 都有自己的特有栏目**。

那个「置信」节的固定四行值得一提：

```text
【材料里写明的事实】
【未写明但可从附件推出】
【执业常识，非正式依据】
【冲突两说并列，不自动消解】
```

**四级置信度**，而且最后一级明说「不自动消解」——把冲突摆着，不替律师选。

## 58.11 模板：十个内置与占位符

`templates/index.ts`（**无头部注释**）管两个来源：内置与上传。

**上传已退役**：路由侧 `POST /api/templates/scan|register|enabled` 与 `DELETE /api/templates/uploaded` 一律 405（`lawmind-server-route-templates.ts`），工具侧 `register_template` / `set_template_enabled` 保留名字但调用一律拒绝（`engine-template-tools.ts`：「保留工具名以免旧会话报『未知工具』」）。下面 `registerUploadedTemplate` 的校验链仍留在代码里，供已上传旧模板的注册表读取与渲染兼容（`resolveTemplateForDraft` 仍会按注册表找旧上传模板），但产品路径已没有入口能调到它。

### 十个内置模板

| id                               | 格式 | 标签                     | 变体                | 分类       |
| -------------------------------- | ---- | ------------------------ | ------------------- | ---------- |
| `word/legal-memo-default`        | docx | Legal Memo               | `legalMemo`         | internal   |
| `word/contract-default`          | docx | Contract Review          | `contractReview`    | contracts  |
| `word/demand-letter-default`     | docx | Demand Letter            | `demandLetter`      | client     |
| `ppt/client-brief-default`       | pptx | Client Brief             | `clientBrief`       | client     |
| `ppt/evidence-timeline-default`  | pptx | Evidence Timeline        | `evidenceTimeline`  | litigation |
| `ppt/hearing-strategy-default`   | pptx | Hearing Strategy         | `hearingStrategy`   | litigation |
| `ppt/training-cle-default`       | pptx | Training CLE             | `trainingCle`       | client     |
| `ppt/crossborder-matrix-default` | pptx | Cross-border Matrix      | `crossborderMatrix` | client     |
| `ppt/internal-knowledge-default` | pptx | Internal Knowledge Share | `internalKnowledge` | internal   |
| `ppt/case-clinic-default`        | pptx | Case Clinic Training     | `caseClinic`        | litigation |

四个分类（`BuiltInTemplateCategory`）：`contracts` / `litigation` / `client` / `internal`，注释说是「用于 UI 分组与扩展清单」。

**两种格式的默认模板**：

```text
docx → word/legal-memo-default
pptx → ppt/client-brief-default
```

### 上传模板的六个校验

`registerUploadedTemplate` 依次查：

| #   | 检查                                            | 错误                                                      |
| --- | ----------------------------------------------- | --------------------------------------------------------- |
| ①   | id 匹配 `/^upload\/[a-z0-9][a-z0-9._-]{1,63}$/` | `template id must match upload/<name>`                    |
| ②   | label 非空                                      | `template label is required`                              |
| ③   | sourcePath 非空                                 | `template source path is required`                        |
| ④   | 扩展名与 format 匹配                            | `template extension <ext> does not match format <format>` |
| ⑤   | 文件可访问（`fs.access`）                       | 抛 fs 错                                                  |
| ⑥   | docx 且没给 placeholderMap → 自动扫             | —                                                         |

**第 ⑥ 步是自动推断**：`scanDocxPlaceholders` + `suggestPlaceholderFieldPaths`（下一节）。

版本号是 `(existing?.version ?? 0) + 1`，文件名是 `${safeName}_v${version}${ext}`（`safeName` 把 `/` 换成 `_`）。

### 解析模板的四条分支

`resolveTemplateForDraft({ workspaceDir, draft })` 顺序：

| #   | 情况                     | source     | 说明                                                    |
| --- | ------------------------ | ---------- | ------------------------------------------------------- |
| ①   | 是内置 id 且格式一致     | `built-in` | —                                                       |
| ②   | 是上传 id 但**格式不符** | `fallback` | reason: `uploaded template format mismatch: <a> vs <b>` |
| ③   | 上传件**被禁用**         | `fallback` | reason: `uploaded template disabled`                    |
| ④   | 上传件**文件丢了**       | `fallback` | reason: `uploaded template file missing`                |
| ⑤   | 其他                     | `fallback` | reason: `unknown template id`                           |

**四种 fallback 都会回落成该格式的默认模板**，而且**每种都带 reason**。所以审计里能查出「为什么没用上传的模板」。

### 稳定 pin：三种格式

`templateResolvedPin` 的头部注释把三种格式讲清了：

```text
- 上传模板：`{id}@{registry.version}`
- 内置：`built-in:{resolvedId}`
- 回退：`fallback:{resolvedId}|{简短原因}`
```

原因会 `replace(/\s+/g," ").slice(0, 120)`——**截断但保留可读性**。

**pin 的用途**（注释）：写进草稿/任务与审计，便于「交付复现与版本对照」。也就是：半年后你能知道「这份稿是用模板的第几版出的」。

### 占位符扫描：一条正则与一个文件名单

`docx-template-fill.ts` 的两条规则：

```text
PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g
XML_PARTS = /^(word\/document\.xml|word\/(header|footer|endnotes|footnotes|comments)\d*\.xml)$/
```

**占位符名的规则**：以字母开头，后接字母/数字/下划线。**所以 &#123;&#123;甲方名称&#125;&#125; 不支持**——中文占位符扫不到。

**扫描范围只有六类 XML 部件**：正文、页眉、页脚、尾注、脚注、批注。其他 zip 条目跳过。

**一条重要限制**（头部注释）：

```text
占位符需与 Word 中连续文本一致（同一段 w:t 内最稳妥）。
```

**为什么**：Word 会把一段文字拆成多个 `w:t` 节点（比如改过格式之后）。跨节点的 &#123;&#123;name&#125;&#125; 在 XML 里会被拆成 &#123;&#123;na 与 me&#125;&#125; 两段，正则匹配不到。

**这是一个必须让律师知道的限制**——否则他会遇到「明明写了占位符却填不进去」。

### 填充时的两条处理

```text
key 校验：/^[a-zA-Z][a-zA-Z0-9_]*$/，不匹配就跳过这个 key
值转义：& → &amp;  < → &lt;  > → &gt;  " → &quot;
```

**转义是必须的**——不然值里有个 `&` 就会让 XML 崩掉。

而且**写副本不改源文件**（注释：「将占位符值写入副本并保存到 outputPath（不修改源文件）」）。

### 字段映射：一张表与三种特例

`draft-template-values.ts` 把草稿字段映射到占位符值。基础映射是「小写归一后查表」：

| 占位符（小写）                         | 取值                     |
| -------------------------------------- | ------------------------ |
| `title`                                | `draft.title`            |
| `summary`                              | `draft.summary`          |
| `matterid` / `matter_id`               | `draft.matterId`         |
| `taskid` / `task_id`                   | `draft.taskId`           |
| `audience`                             | `draft.audience`         |
| `output`                               | `draft.output`           |
| `templateid` / `template_id`           | `draft.templateId`       |
| `deliverabletype` / `deliverable_type` | `draft.deliverableType`  |
| `reviewnotes` / `review_notes`         | `reviewNotes.join("\n")` |
| `sections` / `all_sections`            | 所有章节拼成多段         |
| `sections.<n>.heading` / `.body`       | 第 n 节的标题/正文       |

**三种特例**：

1. **两种命名风格都认**（`matterId` 和 `matter_id`）——容忍律师的写法。
2. **`sections_N_heading` 也认**（正则 `/^sections_(\d+)_(heading|body)$/i`）——因为 Word 里下划线比点更好打。
3. **越界返回空串**（不是报错）。

**每条多行值都用 `\n` 连接**（`reviewNotes` 和 `sections`）——因为 Word 里换行是有意义的。

### 自动推断：十一种映射

`suggestPlaceholderFieldPaths` 在登记上传模板时自动填 `placeholderMap`。它认十一种名字（与上表基本一致）。

没认出来的**不会出现在结果里**，注释也说明了：

```text
未识别的名字不会出现在结果中，可在 `lawmind/templates/index.json` 中手改补全。
```

**「可以手改补全」**——这就是为什么要有 `placeholderMap` 这个显式字段。

## 58.12 已知坑（本章相关）

- **关键词表是三十二条有序规则，第一个命中即取。** 顺序不能随意调。
- **第 23 条的负向先行断言不能删**（否则函件会被判成合同审查）。
- **第 30 条必须排在泛化检索之前**（否则「合规卷宗」会被「调研」抢走）。
- **起草类算高风险。** `requiresConfirmation` 因此为真。
- **模型路由只能加严不能放松 `requiresConfirmation`。**
- **三路分歧不是概率，是「不一致」。**
- **只有 0 或 1 条意见时不算「一致」**，算「不可判」。
- **分歧记录「永不抛」。**
- **升级分歧只是把 `requiresConfirmation` 置真**，不弹窗不拒绝。
- **`deliverable-meta` 里那三处「且非」都是踩过坑的。**
- **`COMPLIANCE_DOSSIER_RE` 必须排在三个 ESG 正则之前。**
- **显式类型代码优先于一切推断。**
- **Soft Ask 与硬闸共用前四步，只在第 ④ 步分岔。** 改一处要看另一处。
- **高风险空跑只有七类**（全是对外文书）。
- **`intake-craft` 的正文来自内置技能文件**（单一来源）。
- **默认承办人只配了合同相关**，其他走 `fallback` / `none`。
- **`no_assistant_for_role` 说明「规则对但人没配」。**
- **强制互审只登记待办，不自动跑。**
- **互审任务头同时点「本所口径」和「作者角色职责」。**
- **分诊的 `litigation-red` 要排除「咨询/了解一下」。**
- **分诊空输入给 `matchedRuleIds: ["empty-input"]`**（便于统计）。
- **`green` 不拦重活工具。**
- **`confirmTriageSession` 逐个 key 报缺哪一项。**
- **封闭十二类的匹配顺序与定义顺序不同**（employment 第一、service 最后）。
- **不许「另起第 13 类」。** 找不到就归最接近的。
- **纸侧的「未写明」分支明说「不要停下来三问」。**
- **`practice` 的默认立场是「中立偏委托方」。**
- **学习来的标准默认 `enabled: false`。**
- **修订轨与 `mail.contract` 永远不注入 practice 与 standards。**
- **`liability-cap` 要求「改这几个字」，不许只写「存在风险」。**
- **LPM 备忘不负责写入飞书/日历。**
- **周报类模板判定排最后**（因为它最宽）。
- **占位符不支持中文名**（正则只认字母数字下划线）。
- **占位符必须与 Word 中的连续文本一致**（跨 `w:t` 节点扫不到）。
- **内置模板删不掉**；四种模板回退都带 reason。
