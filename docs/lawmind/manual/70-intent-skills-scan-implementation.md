# 第 70 章 实现精读：意图编译、技能、历史扫描

这三个模块从来没进过手册：

```text
intent/            13 个文件、3434 行   把律师的话编译成一个能力绑定
skills/            9 个 .ts + 37 份 md  能力注册表与技能运行时
historical-scan/    8 个文件、1177 行   扫历史材料、挖习惯
```

第 4 章从产品角度讲了意图，第 11 章讲了技能机制，第 20 章列了 37 份技能。这一章讲**实现**。

## 70.1 意图编译：七级的书面顺序

`compile-intent.ts` 760 行。它的头注释是整个模块的骨架：

```text
Intent compiler — Signal Extractor + ranker.

Precedence (do not flatten into one regex):
 1. Hard nails: 办件 lock, mail short-path, Word 改稿 lock
 2. High-precision specialized text (劳动金额、期限、发票、传票…)
 3. Joint file-genre × verb  ← accuracy core
 4. Keyword / deliverable-type fallback (legacy router)
 5. Session continuation
 6. Matter kind as TIE-BREAK only (never overrides 2–3)
 7. Genre default when materials exist but the utterance is vague

Fatal misbind pair: contract.review ↔ litigation.draft.
File pleading headers beat "合同" tokens in the body.
```

**五处值得单独说**：

1. **「do not flatten into one regex」**——这句是写给未来维护者的。**它明确禁止「把七级压成一条大正则」这个看起来很诱人的简化**。
2. **第 3 级标了「accuracy core」**——准确性主要来自「文件类型 × 动词」这个联合判断。
3. **第 6 级标了「TIE-BREAK only（never overrides 2–3）」**——案件类型只能打破平局，不能推翻前两级。
4. **「Fatal misbind pair」**——有一对绑定错误是致命的：合同审查 ↔ 诉讼文书。
5. **「File pleading headers beat 合同 tokens in the body」**——因为**起诉状里到处都在引用合同**。

### 但实际求值顺序与书面顺序不同

书面是七级，代码里实际是**十七个 return 分支**。差异最明显的有两处：

| 书面顺序            | 实际位置                                                 |
| ------------------- | -------------------------------------------------------- |
| 第 7 级（类型默认） | **在**第 6 级（案件类型打破平局）**之前**                |
| 第 2 级（专用信号） | 中间还有四个「守卫」分支（公开网页、无任务、问候、纠正） |

**「类型默认」先于「案件类型」**这个顺序是对的：**有材料说明是什么类型时，比「本案是诉讼门类」更具体**。

### 十七个分支（按实际顺序）

| #   | 条件                              | 绑到             | source          | 置信        |
| --- | --------------------------------- | ---------------- | --------------- | ----------- |
| 1   | 有能力锁                          | 锁定的那个       | `lock`          | high        |
| 2   | 邮件短路径                        | `mail.contract`  | `short_path`    | high        |
| 3   | Word 改稿                         | 按信号选三个之一 | `word_revision` | high        |
| 4   | 公开网页事实                      | —                | `unbound`       | —           |
| 5   | 无任务话                          | —                | `unbound`       | —           |
| 6   | 问候 / 纠正 / 太短（且无材料）    | —                | `unbound`       | —           |
| 7   | 专用信号（且不是 research/quick） | 专用表           | `specialized`   | high        |
| 8   | 合同+诉状混料且要审               | 二选一           | `joint`         | medium/high |
| 9   | research 且含法条类词             | `research.memo`  | `specialized`   | high        |
| 10  | joint + 弱专用（quick/research）  | joint 的         | `joint`         | high        |
| 11  | joint（文件类型 × 动词）          | joint 的         | `joint`         | 算出        |
| 12  | 只有专用信号                      | 专用表           | `specialized`   | medium/high |
| 13  | 关键词 / 交付物类型回落           | 回落             | `keyword`       | medium      |
| 14  | 会话续作                          | 上轮能力         | `continue`      | medium      |
| 15  | **类型默认（有材料）**            | 类型默认表       | `genre_default` | medium      |
| 16  | **案件类型打破平局**              | 按案件门类       | `matter`        | low         |
| 17  | 兜底                              | —                | `unbound`       | low         |

**第 1–3 步是「硬钉子」**——它们不做任何推断，直接绑。

而第 3 步（Word 改稿）还带三个覆盖：

```text
pipelineOverride: "tracked_redline"
skillIdsOverride: 该能力对应的两个技能
pipelineHintOverride: WORD_REVISION_HINT
```

**三个覆盖一起给**——所以这条绑定不只换能力，还换流水线和注入的技能。

那句话是：

```text
拷贝原 Word → `apply_surgical_edits` → `render_tracked_draft` 写入源文件同目录（原名_日期_01）。
可以在对话里说明改了什么。禁止 `render_document` 重建，不要准备外发邮件。
核法条可用检索。空修订不得导出。
```

**五句**：怎么做、能说什么、不许做什么、可以做什么、什么情况不能导出。

### 两张表：专用信号与类型默认

**专用信号表**（20 项，全表）：

| 信号                                      | 能力                    |
| ----------------------------------------- | ----------------------- |
| `labor`                                   | `labor.calc`            |
| `period`                                  | `period.calc`           |
| `invoice`                                 | `ops.invoice`           |
| `court_sms`                               | `ops.court_sms`         |
| `ip`                                      | `ip.dispute`            |
| `ma`                                      | `deal.ma`               |
| `data`                                    | `compliance.data`       |
| `ads`                                     | `compliance.ads`        |
| `status`                                  | `matter.status`         |
| `family`                                  | `family.matter`         |
| `capital`                                 | `capital.markets`       |
| `governance`                              | `corp.governance`       |
| `civil_stage` / `bankruptcy` / `criminal` | 都是 `litigation.draft` |
| `intake`                                  | `matter.intake`         |
| `talk`                                    | `litigation.talk`       |
| `quick`                                   | `analysis.quick`        |
| `compute_table`                           | `materials.draft`       |
| `research`                                | `research.memo`         |

**三项共用一个能力**（诉讼阶段 / 破产 / 刑事都绑 `litigation.draft`）——因为它们产出的都是**诉讼文书**，只是适用程序不同（那由技能层去区分，第 70.11 节那张 `litigationPrimary` 表）。

**类型默认表**（11 项）：

```text
contract → contract.review      pleading → litigation.draft
letter → letter.draft           invoice → ops.invoice
court_notice → ops.court_sms    talk → litigation.talk
privacy → compliance.data       ma → deal.ma
capital → capital.markets       evidence → litigation.draft
spreadsheet → materials.draft
```

**`pleading` 与 `evidence` 都默认到 `litigation.draft`**——所以「给一堆证据」会被当成诉讼文书任务。这符合直觉：**证据是用来起诉或答辩的**。

### 十种 source

```text
lock           能力锁（律师显式指定）
short_path     邮件短路径
word_revision  Word 改稿
specialized    专用信号
joint          文件类型 × 动词
keyword        关键词回落
continue       会话续作
matter         案件门类
genre_default  类型默认
unbound        没绑上
```

**十个值里五个是「硬/半硬」（lock / short_path / word_revision / specialized / joint）**，四个是「软」（keyword / continue / genre_default / matter）。

而**只有前五个可能注入技能正文**（第 70.9 节那个门）。

### 防止「看看」把审查绑死

`softenReadFirstBind` 做一件事：**把「只是想看看」误绑成高置信审查时，降一档**。

它跳过的三种情况：

```text
source 是 lock / short_path / word_revision  → 不降（那是律师显式指定的）
pipelineOverride === "tracked_redline"        → 不降
```

触发条件：

```text
isLookOnlyUtterance(instruction) 或 instructionLooksLikeLetterQa(instruction)
且 confidence === "high"
→ 降到 medium，并重算 lawyerSummary
```

**「看看这份合同」与「审查这份合同」不该得到同一个置信度**——所以降一档，让后面的「理解优先」门不给它注入技能正文（第 70.9 节）。

### 混料二选一

`silentMixedPaperPick` 处理「合同和诉状都在，且律师说要审」：

```text
要合同 且 动词含 review 且 有文件是 contract 类型 → contract.review
否则 → litigation.draft
```

**默认偏向诉状**——因为「有诉状在场」通常意味着这是个诉讼案子。

### 那条「律师排除了合同审查」的证据

```text
if (text.rejectsContractReview && id !== "contract.review")
  → evidence detail: "律师排除合同审查"
```

**所以即使绑对了，也要在证据里记一笔「律师说过不是合同审查」**——这是给律师看的推理依据。

### 两个摘要模板

```text
本轮初步判断「<能力名>」<来源短语>；以律师原话为准<dropBit>
本轮按「<能力名>」处理<来源短语><dropBit>
```

`via`（来源短语）两种：

```text
（按你的指定）        ← source 是 lock
（<文件位>）          ← 有文件证据
```

`dropBit` 是：

```text
；勿续上轮合同审查或改稿清单
```

**这个 `dropBit` 是个很细的设计**：当绑定**覆盖**了上一轮的合同时，摘要里必须说一句「别接着上一轮的清单办」——否则模型可能真的接着改。

而**低置信的来源才用「初步判断」**：

```text
假设类来源（keyword / matter / genre_default / continue / 低置信 joint）→ 初步判断
其他 → 按「…」处理
```

**「初步判断」与「按…处理」的差别是承诺强度**。

### 那个「从没被赋值」的字段

`types.ts` 里有：

```ts
export type IntentSoftAsk = {
  question: string;
  options: Array<{ id: LawyerCapabilityId; label: string }>;
};
```

而 `CompiledIntent.softAsk?` 也声明了。**但 `compile-intent.ts` 从头到尾没有一处给它赋值。**

唯一的读取点是 `agent/turn-orchestrator.ts`：

```text
...(compiledIntent.softAsk ? { softAsk } : {})
```

而两处测试**显式断言它是 `undefined`**。

**所以「软问」是一个已经建好管道但从没启用的能力。** 第 4.2、4.3 节现在把它讲清了：**「系统会追问一次」这件事是真的，但走的是回合编排层的一条短路，不是这个字段。**

**这个字段留着是有用的**（未来要做时管道已经通了），但读到这里的人应该知道它现在是空的。

### 多意图链

`chainFor` 只加两种后续：

```text
绑 contract.review 且（要函件 或 动词含 letter）→ 追加 letter.draft
绑 litigation.draft 且 专用信号是 talk        → 追加 litigation.talk
```

而 `finish` 会去重（`[...new Set(chain)]`），**没有链就用 `[自己]`**。

**链的顺序有意义**：**主能力在前**。

## 70.2 能力目录：23 条与它的 8000 字上限

`catalog.ts` 95 行，头注释说明了它什么时候被注入：

```text
Codex-style capability catalog: name + description for implicit match,
plus when/notWhen boundaries. Injected on unbound turns and on soft
keyword/matter/genre hypotheses. Hard binds still dump lean Skill bodies.
```

**「未绑上时注入目录；硬绑时注入技能正文」**——这就是渐进披露的两档。

### 三个数

```text
条目数        23
索引上限      8000 字（CAPABILITY_CATALOG_MAX_CHARS）
隐藏          1 个（mail.contract）
```

`allowImplicit: id !== "mail.contract"`——**所以目录里只有 22 条**。

**为什么把 `mail.contract` 藏起来**：它的触发条件是「指令已带邮件短路径标记」。**如果它出现在隐式目录里，模型可能自己决定走这条短路径**——那就绕过了「路径已钉选」这个前提。

### 目录的开头两行

```text
## 可用能力（隐式选用；律师不必点选）
先按律师本轮原话判断要做什么。需要某条能力的质量规范时调用 `read_skill`。
多条适用时取最小充分集。邮件合同短路径仅在指令已带短路径标记时使用。
```

**「隐式选用；律师不必点选」**——把产品姿态写进了提示词。

而最后一句是**在目录里再重申一次那个前提**——所以即使目录没列它，模型也知道它存在但有条件。

### 那些描述里的「不要」

23 条描述里，**十几条都带「不要」**。举几个最典型的：

```text
contract.review：…不要把「看看」或已附合同当成已经锁定审查。不要用于起诉状、从零起草或劳动金额计算。
letter.draft：…已有函要核对应先读材料指出对错，不要未读就另起一稿。不要当成合同审查。
ip.dispute：专利/商标/著作权侵权路径。不要套普通民事起诉状。
family.matter：离婚/抚养/继承。不要套买卖合同审查。
compliance.ads：广告用语/产品标签合规。不要改成数据出境或合同审查。
corp.governance：股东会/董事会决议与治理备忘。不要改成章程 Word 红线。
capital.markets：招股/信息披露核对。不编未披露数字。
research.memo：…娱乐事实不要用。
analysis.quick：…正式文书不要走这里。
```

**「不要」比「要」更有价值**——因为相邻能力之间最容易混。而这些「不要」精确指出了**该往哪个邻居走**：

| 描述                                   | 该往哪走            |
| -------------------------------------- | ------------------- |
| contract.review 不要用于「从零起草」   | → `contract.draft`  |
| ip.dispute 不要套普通民事起诉状        | → 知产那条路        |
| compliance.ads 不要改成数据出境        | → `compliance.data` |
| corp.governance 不要改成章程 Word 红线 | → 章程改稿那条      |
| analysis.quick 正式文书不要走这里      | → `materials.draft` |

### 七种「触发」词

好几条描述里带「触发：」：

```text
触发：审查、审阅、风险、已附合同且律师要审
触发：起草、拟定一份合同
触发：写函、催告、催款
触发：查一下、检索、类案
触发：起诉状、答辩状，或已附诉状
触发：谈话记录、客户说了
触发：违法吗、能不能告
触发：N+1、2N、违法解除赔偿
触发：时间线、大事记
触发：整理案卷、建立案件目录
触发：期限计算、上诉期届满
触发：整理发票，或已附发票
触发：12368、传票、开庭通知
触发：数据合规、隐私政策
```

**每条的触发词都是律师会说的原话**——不是抽象描述。

### 那个「像不像法律工作」的判定

`looksLikeLegalWork` 三步：

```text
有材料 → 真
文本长度 < 4 → 假
否则测 /合同|协议|起诉|答辩|函|法|案|审查|起草|检索|条款|诉讼|合规|尽调|发票|传票|文件夹|目录/
```

**「有材料就算法律工作」**——因为律师不会没事丢一堆文件进来。

**长度 < 4 直接假**——把「嗯」「好的」这类先挡掉。

## 70.3 金标集：73 行剧本与那一对致命组合

`gold-set.ts` 375 行。头注释两句：

```text
Routing gold set for the intent compiler (P0 measurement).
Each row is a lawyer-shaped utterance ± files. Fatal pair:
contract.review ↔ litigation.draft must not invert.
```

**「P0 measurement」**——它是最优先级的度量。

### 73 个用例与那一对

```text
73 个用例
致命组合一对：["contract.review", "litigation.draft"]
```

**只登记了一对致命组合**——因为这一对搞错的后果最重：**把起诉状当合同审，或把合同当诉状写**。

### 六个代表性用例（都是真在防某件具体的事）

| 用例名                           | 输入                                                                  | 期望               |
| -------------------------------- | --------------------------------------------------------------------- | ------------------ |
| `complaint-peek-quotes-contract` | 摘要里含「民事起诉状 / 原告 / 被告 / 诉讼请求：解除合同并支付违约金」 | `litigation.draft` |
| `review-words-on-complaint`      | 指令「请审查这份采购合同」+ **诉状** pin                              | `litigation.draft` |
| `mixed-files-review-contract`    | 合同 + 诉状两个 pin                                                   | `contract.review`  |
| `labor-beats-contract-file`      | 劳动计算类 + 合同文件                                                 | 劳动计算           |
| `correction-clears-continue`     | 「不对」+ 上轮是审查                                                  | **不绑**           |
| `web-fact` / `web-fact-bare`     | 赛事事实类                                                            | **不绑**           |

**第二与第三个用例是互补的一对**：

- 第二个：**律师嘴上说「审查合同」，但附的是诉状** → 跟文件走（诉状）。
- 第三个：**两个都附了，律师说要审** → 跟话走（合同）。

**这两条一起，就把「话与文件冲突时听谁」这件事定死了。**

**第四个用例名字很长但意思简单**：`labor-beats-contract-file`——**劳动计算的专用信号要压过「附了合同文件」这个事实**。

而 `correction-clears-continue` 防的是第 70.7 节那条：**一句「不对」要能清掉上轮的续作**。

### 两个「交付物」字段

用例里还有两个可选的期望字段（注释原文）：

```text
/** When set, compiled delivery.artifactShape must match. */
deliveryShape?
/** When set, compiled delivery.outputPath must match. */
deliveryPlace?
```

**所以金标集不只测「绑哪个能力」，还测「交件形态与落盘位置」**——这是第 70.4 节那一层的回归锁。

三个相关用例：

```text
opinion-memo-desktop-preserve-source     形态 opinion_memo、位置 desktop
plain-review-stays-unspecified-delivery  形态 unspecified
fast-lane-word-pin-stays-unspecified-delivery  形态 unspecified
```

**后两个用例名里的「stays」是关键词**——它们在防「默认值乱冒出来」。

## 70.4 交件意图：与能力正交的那一层

`delivery-intent.ts` 229 行。头注释是一段很清楚的定位：

```text
Delivery constraints — orthogonal to capability bind.

Capability answers *what job* (合同审查 vs 诉讼). Delivery answers *how to hand it
over*: new opinion memo vs tracked copy of the source, whether the original may
be mutated, and a lawyer-named place (桌面 / 下载 / 文稿).

This layer exists so pipeline *defaults* (成套交件, Word 改稿 lock, workspace-only
writes) cannot contradict an instruction the model already understands. It does
**not** freeze the tool table. Tools stay available; the compiler only removes
contradictory completion conditions, honors named places, and forbids overwriting
the source file. Feature families, not one frozen phrase. Leaf (no fs).
```

**四层信息**：

1. **能力答「什么活」，交件答「怎么交」**——两个正交的维度。
2. **它存在的理由**：让流水线默认值**不能与指令冲突**。
3. **「It does not freeze the tool table」**——它只做三件事：去掉矛盾的完成条件、尊重点名位置、禁止覆盖源文件。
4. **「Feature families, not one frozen phrase」**——用**特征族**判定，不是匹配某一句固定话。

### 四种交件形态

```text
opinion_memo      一份新的意见书
tracked_source    带痕的修订稿副本
unspecified       没指定
```

### 三个「怎么判」的细节

**① `BOTH_DELIVERABLES_RE` 一命中就 `unspecified`**：

```text
/意见.{0,6}(?:和|加|及|并).{0,6}(?:修订|红线|审阅痕迹)|(?:修订|红线).{0,6}(?:和|加|及|并).{0,6}意见/
```

**「两种都要」时不给形态**——因为那是「成套交件」的正常行为，不需要特殊处理。

**② 只说红线不说意见 → `tracked_source`**：

```text
redlineObject && !opinionObject → tracked_source
```

**③ 那个「弱意见」条件**：

```text
opinionObject
或 （弱意见词「意见」 且 有 sidecar 线索 且 没有红线词）
或 （（要保留原件 或 要新文件）且 有审查 且 没有红线词）
```

**「弱意见」是只含「意见」两个字的情况**——它单独不够，要有 sidecar 线索配合。

而 `mutateSource` 有四种判定，其中一条很直白：

```text
/覆盖原件|直接改原件/ → "allow"
```

**「覆盖原件」是唯一会说 allow 的写法**——所以律师要明说要覆盖，系统才允许。

### 「客户端镜像」与那个强制回落

```text
chatMirror = 形态是 opinion_memo ? "required" : "unspecified"
```

**意见书必须在会话里写出完整内容**（不能只给文件路径）——所以 `chatMirror` 是 required。

而 `resolveTurnDeliveryIntent` 有一条强制回落：

```text
若 要保留原件 或 有 Word pin，且 是快速合同审查 → 强制 unspecified + unspecified
```

**「不要跟成套交件打架」**——注释写的就是这个意思。

### 那两段提示词块

**意见书那段**（六句）：

```text
## 本轮交件形态（律师已指定）
- 交付物是一份**新的意见书 Word**（默认 `.docx`）。正文只有审查意见与修改建议，不要拷贝原合同再改。
- 原文件只读，不得覆盖。不要把完成条件理解成必须出审阅痕迹修订稿。
- 会话里写出完整意见（结论、风险、建议），不能只给文件路径。
- 优先 `draft_document` → `render_document`。工具表不收窄；若律师随后要红线，仍可改稿。
```

**第一条那句「不要拷贝原合同再改」是重点**——它防的是模型把「出意见书」当成「改合同的另一说法」。

**修订稿那段**：

```text
- 交付物是带审阅痕迹的修订稿副本，不是意见书重建稿。
- 原文件只读，不要覆盖原稿。
```

**两段都用同一个手法：说清是什么，同时说清不是什么。**

**落盘位置三句**（都一样的形式）：

```text
落盘：系统桌面（引擎写入；不要改用工作区 artifacts 代替律师点名的位置）。
落盘：系统下载文件夹（引擎写入）。
落盘：系统文稿文件夹（引擎写入）。
```

**「不要改用工作区 artifacts 代替」**——这句防的正是「默认写工作区」那个默认值。

**函件核对那段**（两句话，注释说是「交付是会话意见，不是另起一稿」）：

```text
- 交付物是会话里的核对意见：逐点对错、引用文件夹/函件出处、必要时给出建议改法。
- 不要另起一封律师函 Word，不要出审阅痕迹稿，不要按合同审查成套交件。
```

**第二条连禁三样**——因为这三样都是模型在这个场景下的「自然反应」。

## 70.5 文本特征：动词与对象分开

`text-intent.ts` 227 行。头注释三句话，把设计讲清了：

```text
Text-side intent features. Deterministic; no model.

Verbs are the ACTION. Objects / domain words are the FIELD.
Joint routing (file genre × verb) is what makes "帮我看看" + 合同.docx
a review, and the same words + 起诉状.docx a pleading job.
```

**「动词是动作，对象是领域」**——所以两者分开提。而第三个例子完美说明了为什么必须联合：**同一句「帮我看看」，换个文件就是另一件事**。

### 八个动词

```text
review    redline   draft   research
ask       letter    continue   vague
```

### 五条正则

```text
review   /审查|审阅|看看|帮我看|帮忙看|看一下|风险|条款问题|意见书|合同审查/
redline  /改稿|红线|审阅痕迹|出修订|修订稿|修改这份|改一下|改合同|修改合同/
draft    /起草|拟定|拟写|撰写|写一份|拟一份|出一份稿|从零/
letter   /律师函|催告函|催款函|通知函|回函|答复函|demand letter/
对象——合同  /合同|协议|条款|NDA|保密协议/
对象——诉状  /起诉状|答辩状|上诉状|代理词|辩护词|诉讼文书|诉请/
```

**`review` 那条包含「看看」「看一下」**——所以「看看」确实算审查动词。**但第 70.1 节那个 `softenReadFirstBind` 会把它降档**，所以它有动词但拿不到高置信。

### 「模糊」的三层判定

```text
① 非问候 且 无专用信号 且 无动词 且 文本长度 > 0 且 <= 24
② 或 无动词 且 无专用信号 且 含 /看|帮|处理|这个|这份/
最终 vague = 含 vague 且 不含 review 且 不含 draft
```

**第 ③ 步的「不含 review 与 draft」是关键**：**模糊只在不明确的时候才算模糊**。如果同一句里有「审查」，那就不是模糊，是审查。

### 专用信号的二十级顺序

`specializedOf` 是「先匹配先返回」的二十条：

```text
labor → period → invoice → court_sms → ip → ma → data → ads
→ status → family → capital → governance
→ civil_stage → bankruptcy → criminal
→ intake → talk → compute_table → quick → research
```

**这个顺序有两处讲究**：

1. **`labor` 在 `period` 前**——因为劳动计算里常提到期限。
2. **`court_sms` 用 «或» 连了两个正则**（`COURT_SMS_RE || LEGAL_EVENT_RE`）——所以「传票」与「法院短信」归到同一类。
3. **`civil_stage` / `bankruptcy` / `criminal` 三个位置相邻**——它们都绑同一个能力，所以内部顺序无所谓，但都排在 `quick` 与 `research` 之前（那两个是兜底）。

### 那两处「版本剥离」

```text
wantsContract 测的是「剥掉否定短语后」的文本
wantsPleading 测的是「原始文本」
rejectsContractReview 单独算
```

**`wantsContract` 要先剥否定**——因为「**不是**合同审查」里含「合同」，不剥就会误判。

**而 `wantsPleading` 不用剥**——因为没有人会说「不是诉状」。

## 70.6 文件类型：十三条规则与一份粘性排名

`document-genre.ts` 182 行。头注释是四条「准确性规则」：

```text
Deterministic document-genre classifier.

Accuracy rules (do not invert):
1. Filename of a pleading beats contract-like clauses in the body
   (起诉状 quotes 合同 all the time).
2. Pleading headers in the peek (诉讼请求 / 原告 / 被告) beat a
   generic *协议.docx filename.
3. Sticky genres (pleading, invoice, court notice, letter, talk) win
   over a pile of unknown attachments when the instruction is vague.
4. Never use a lone 合同/协议 token in peek to override a pleading.
```

**四条都在讲同一件事的两个方向**：

| 规则 | 方向                             |
| ---- | -------------------------------- |
| ①②④  | **诉状压过合同**（文件名或正文） |
| ③    | **粘性类型压过一堆未知附件**     |

**第 1 条那个括注最有说服力**：`起诉状 quotes 合同 all the time`——**起诉状里引用合同引用得太多，所以正文里出现「合同」完全不能说明这是合同文件。**

### 十三个类型

```text
contract  pleading  letter  invoice  court_notice  talk
evidence  privacy   ma      capital  spreadsheet
identity  unknown
```

### 文件名规则的顺序（不可换）

```text
① 发票      发票|增值税专用|进项|销项|invoice
② 传票      传票|开庭通知|开庭传票|12368|缴费通知|应诉通知
③ 谈话      谈话记录|谈话笔录|会议纪要|客户口述|intake notes
④ 证件      身份证|营业执照|统一社会信用|执照|护照|户口本
⑤ 函件      律师函|催告函|催款函|通知函|demand letter
⑥ 诉状      起诉状|起诉书|答辩状|上诉状|代理词|辩护词|执行异议|执行复议|立案材料|民事起诉|仲裁申请
⑦ 隐私      隐私政策|个人信息保护|数据出境|PIPL|隐私条款
⑧ 并购      尽调|尽职调查|交割清单|股权收购|资产收购|SPA
⑨ 发行      招股说明书|募集说明书|信息披露|再融资
⑩ 证据      证据目录|证据清单|书证|证人证言
⑪ 合同      买卖合同|采购合同|租赁合同|服务合同|保密协议|框架协议|补充协议|劳动合同|NDA|合同|协议
```

**诉状（⑥）排在合同（⑪）前面**——这就是第一条准确性规则的实现。

**而发票（①）排最前**——因为「发票」这个词在文件名里出现，几乎不可能是别的东西。

### 正文规则只在「文件名判不出来」时才用

```text
peek 只在 fromName === "unknown" 时才升级类型
```

**「文件名优先于正文」**——因为文件名是律师起的，通常更准。

**而正文截取 8000 字**（`peek.slice(0, 8000)`）——与目录的 8000 字上限是同一个数。

七个正文正则：

```text
诉状头  (民事起诉状|行政起诉状|刑事自诉状|答辩状|上诉状|诉讼请求|事实与理由|原告[：:]|被告[：:]|上诉人[：:]|被上诉人[：:])
合同结构  (甲方|乙方).{0,40}(甲方|乙方)|(鉴于|违约责任|合同编号|协议编号)
函件    (律师函|催告函|此致[\s\S]{0,40}律师事务所|敬启者)
发票    (增值税专用发票|发票代码|发票号码|价税合计)
传票    (开庭传票|传票|12368|定于.{0,20}开庭|应到庭)
谈话    (谈话记录|客户口述|会议纪要|整理如下)
隐私    (个人信息保护|处理者|数据出境|隐私政策)
```

**合同结构那条要求「甲方乙方成对出现」或用「鉴于/违约责任/合同编号/协议编号」**——它**刻意不要一个孤零零的「合同」或「协议」**（这就是第 4 条规则那个「Never use a lone token」）。

### 粘性排名

```text
传票 90   发票 85   诉状 80   函件 70   谈话 65
证件 60   隐私 55   并购 50   发行 50   证据 45
合同 40   表格 30   未知 0
```

`dominantDocumentGenre` 的规则：

```text
排名 >= 45 的粘性类型里取最高的
否则按数量，同数量按排名
```

**「>= 45」这条线意味着前十个类型是粘性的**（证据 45 刚好在线上）——**而合同（40）与表格（30）不粘**。

**为什么合同不粘**：因为一堆材料里出现一份合同很常见（合同是办案最常见的附件），所以它不该「一出现就主导」。

## 70.7 短话分类：一句「k」不许重跑整条流水线

`utterance-kind.ts` 201 行。头注释一句定位：

```text
Short utterance kinds shared by the intent compiler and the renderer-safe
turn-plan pruner. Keep this file free of capability catalogs and Node builtins.
```

**「Keep this file free of capability catalogs」**——所以它只判话，不判能力（避免与目录模块形成环）。

### 那条最重要的注释

```text
明确续作指令：只有这类原话才允许沿用上一轮清单继续办本件。
纯确认（好的 / 嗯 / 可以 / k / ok …）**不算**续作——它们是「无任务」，
否则一句 `k` 会顺着上一轮的上下文把整条改稿流水线再跑一遍。
```

**「否则一句 k 会顺着上一轮的上下文把整条改稿流水线再跑一遍」**——这是一个非常具体的后果。

**为什么这在产品上很严重**：律师回一个「嗯」本来只是**确认收到了**，结果系统重跑一遍改稿。**这不只是浪费，还会产生一份律师没要的稿。**

所以续作词表很窄：

```text
继续|接着|再改一下|再改|导出|出稿|打开结果|加上…|补充…|同样|按这个
```

而「嗯 / 好的 / 可以 / k / ok / 收到 / 1 / 👌」全在**无任务**那一类。

### 四组判定互相排斥

| 判定     | 触发                                                                  | 优先级 |
| -------- | --------------------------------------------------------------------- | ------ |
| 纠正     | `^(不对\|不是这样\|搞错了\|错了\|不是\|别这样)$` 或短句以「不对」开头 | 高     |
| 任务切换 | 含「不是合同审核」类短语，或「我要你做的不是…」                       | 高     |
| 到期续作 | 续作词表                                                              | 中     |
| 无任务   | 其他短话 + 纯确认                                                     | 低     |

而 `isNoTaskUtterance` 的实现顺序很关键：

```text
空 → 真
显式续作 / 纠正 / 任务切换 → 假
长度 < 2 或 纯确认 → 真
```

**「显式续作 → 假」排在前面**——所以「继续」不会被当成无任务。

### 那五个「我不懂」的判定

**① `isGreetingOnly`**——13 个问候词（含「你是谁」「你是什么模型」「你叫什么」）。

**② `isSystemBracketMarker`**——判断方括号里的东西是不是系统标记：

```text
^(交办|办件|邮件|用户在|用户将|从检查点继续)  或  含「短路径」「能力：」
```

**③ `namedBracketFolders`**——取出真正的文件夹名：

```text
【([^】]+)】 且 名字长度 >= 4 且 不是系统标记
```

**这两条一起保证了「【办件】能力：contract.review」不会被当成一个文件夹名。**

**④ `instructionLooksLikeLetterQa`**——要**两个条件同时成立**：

```text
含函件对象词（律师函|催告函|通知函|回函）
且 含核对词（有误|核对|是否有误|是否正确|有没有错|对不对|核对我起草|看我起草）
```

**「这两个一起」是关键**：只说「写一封律师函」不是核对，只说「帮我核对一下」也未必是函件。**两个都说了才是「核对已起草的函」**。

**⑤ `stripRejectedContractReviewPhrases`** 那七条短语，注释说明了边界：

```text
「不是合同审核，是看律师函」must not bind contract.review just because 合同 appears
in the negation. Keep this list phrase-level; do not strip every 不是.
```

**「do not strip every 不是」**——所以是**短语级**剥离，不是把「不是」当关键词。因为「不是这个合同，是那个」里的「不是」不该剥。

### `shouldRequireFolderExplore`

五种情况返回假：

```text
Word 改稿回合
邮件合同回合
续作
无任务
律师说要「收进/导入到/放进/归档到」
```

否则看：**提到文件夹** 或 **钉了目录** → 真。

**最后那条那个例外很实际**：「帮我把这个文件夹收进案件」**不需要先看清树**——直接导入就行。这与第 70.8 节那句提示词是一致的。

## 70.8 任务书与「理解优先」

### `working-brief.ts`：四个字段与一个 80 字上限

头注释：

```text
Utterance-grounded working brief (Codex update_plan analogue).
Restates the latest lawyer line; does not bind a capability pipeline.
```

**「Restates the latest lawyer line」**——它就是**把律师那句原话拆成四段**。

四个字段（代码里的标签）：

```text
要做      goal
不要做    notGoal
材料      materials
完成标准  done
```

**三条默认值都在防「自行缩小范围」**：

```text
notGoal    以律师原话里的否定为准；未排除的不要自行缩小范围
materials  以原话与钉选为准
done       按原话交付；未读材料不得改稿
```

**第一条那个「不要自行缩小范围」**——这是这类系统最常见的坏行为：模型自己加限制。

**`done` 有三级判定**：

| 情况                 | 完成标准                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| 函件核对             | 在会话给出核对意见（对错、出处、建议改法）；**不要另起一封律师函或红线稿** |
| 含「有误」或「核对」 | 对照材料指出具体对错并引用出处；未读材料不得改稿或声称已完成               |
| 其他                 | 按原话交付；未读材料不得改稿                                               |

**三句都带「未读材料」这个约束**（第二三句明写，第一句隐含）——**所以「没读就别说办完了」这句话在三个地方都出现了**。

**`FIELD_MAX = 80`** 且超了追加 `…`——**所以这是四条一句话，不是四段话**。

### `understand-first.ts`：54 行的三道门

头注释：

```text
Codex-style turn order: understand the latest utterance before caging the
model with a keyword-bound Skill dump. Hard binds (lock / mail / Word 改稿 /
specialized / high-confidence joint with an explicit action) still inject
lean Skill bodies. Look-only lines and sticky 继续 stay hypotheses.
```

**「before caging the model with a keyword-bound Skill dump」**——**「用关键词绑的技能堆把模型关进笼子」**。这个说法很形象：先注入一大堆技能正文，模型就只会照着技能走，不会再想「律师到底要什么」。

**五个硬绑来源仍然注入**：

```text
lock            能力锁
short_path      邮件短路径
word_revision   Word 改稿
specialized 且 置信 high
joint 且 置信 high
```

**其余一律不注入**——包括 keyword / matter / genre_default / continue / 低置信 joint。

**这个名单与「source 的软硬划分」完全吻合**（第 70.1 节那十种 source）。

### 那五句提示词

```text
律师最新一条原话是本轮任务定义，原样保留，不要改写成另一句 hidden prompt。
先判断要做什么、明确不要做什么、材料在哪，再调用工具。
系统给出的能力绑定或上轮清单只是启发式；与原话冲突时以原话为准
  （律师用 `$skill` / `【办件】` 指定、邮件短路径、文件页「改这份 Word」除外）。
提到文件夹时先 `explore_folder`（写入 goal / not_goal / path）看清树再阅读文件，
  不要未读材料就 `apply_surgical_edits` / `render_tracked_draft`。
若律师要的是把文件或文件夹收进案件，直接 `import_host_file`（相对路径即可，案件可用展示名），不要先通读。
```

**第一句是全段的核心**：**「本行原话是本轮任务定义，不要改写成另一句 hidden prompt」**。

**第三句给了三个例外**——就是那三个硬钉子的来源。**所以「以原话为准」不是绝对的**：律师显式指定的（锁、短路径、改稿）优先于他的原话。

**第四句给了一个具体的顺序**（先 `explore_folder` 写三个字段，再读文件），**并说明了违反的后果**（未读就改稿）。

**第五句与第四句是一条反向规则**：要收进案件**不用**先看树。

## 70.9 能力：23 个与它们的技能集

### `lawyer-capability-lock.ts`：23 个 id 与一张「办事清单」

头注释：

```text
Leaf: 办件流程锁（隐式编译 + 显式覆盖）。
律师主路径不必选列表；`$skill` / `【办件】能力：` 可覆盖误绑。
Safe for desktop renderer (no fs).
```

**「主路径不必选列表，但有两条显式覆盖的路」**——这就是「隐式为主、显式为辅」。

### 两条覆盖的正则

```text
LOCK_RE        /【办件】\s*能力\s*[：:]\s*([a-z]+(?:\.[a-z]+)+)/i
SKILL_DOLLAR_RE  /\$skill\s+([^\s】]+)/i
```

**`parseCapabilityLock` 先试前者再试后者**——所以方括号形式优先。

而 `normalizeCapabilityToken` 还会**按办事清单的中文标签匹配**：

```text
去掉反引号、转小写、按 id 或按标签匹配
```

**所以律师打「合同审查」也能锁上 `contract.review`**。

### 那张 23 行的办事清单（节选最有说法的几条）

| 标签         | 提示（原文）                             |
| ------------ | ---------------------------------------- |
| 合同审查     | 按已附合同走审查流水线                   |
| 函件起草     | 按已附事实起草函件                       |
| 检索研究     | 按已附问题检索并出备忘                   |
| 诉讼文书     | 按已附案情起草诉讼材料                   |
| 谈话整理     | 谈话记录整理成需求、案由和证据缺口       |
| 写材料       | 意见书 / 备忘等，可填表锁结构            |
| 邮件合同审阅 | 邮箱来件走同一套审查门禁                 |
| 法律快问     | 一句话问题直接给结论和依据               |
| 劳动计算     | 经济补偿、加班、双倍工资按公式算         |
| 时间轴       | 从材料抽出日期事件并去重                 |
| 整理案卷     | 把已附材料归位并抽出当事人案由           |
| 期限计算     | 上诉、答辩、仲裁、执行期间按规则算届满日 |
| 整理发票     | 发票归类、合计入卷                       |
| 法院短信     | 抽出案号、开庭时间和待办                 |
| 知产争议     | 权利基础、被控侵权和程序路径             |
| 并购尽调     | 股权/资产尽调提纲和交割清单              |
| 数据合规     | 个保法/数安法栏目，缺的标待核实          |
| 广告产品合规 | 广告用语和标签核对，给出可替换措辞       |
| 办案周报     | 阶段、期限、范围；本地顾问和人力也走这里 |
| 家事继承     | 离婚、抚养、继承按家事程序写             |
| 资本市场     | 发行和信息披露核对，不编未披露数字       |
| 公司治理     | 决议和治理备忘，不走章程 Word 改稿       |

**二十三条提示里有四条带「不做什么」**：

```text
资本市场    不编未披露数字
公司治理    不走章程 Word 改稿
数据合规    缺的标待核实
广告产品合规  给出可替换措辞（而不是只说「不合规」）
```

而 `testId` 也在这张表里（23 个，如 `lm-desk-work-contract`）——**所以界面上的按钮与这张表共用一份真相源**。

### `lawyer-capabilities.ts`：23 个能力各自的技能集

这个文件 500 行，主体是 23 条记录。每条有：

```text
id  label  pipeline  skillIds  pipelineHint  deliverableType
```

**三种流水线**：

```text
execute_workflow      走工作流
research_then_draft   先检索再起草
tracked_redline       改稿落痕
```

**只有 `mail.contract` 是 `tracked_redline`**（因为它是唯一必须落痕的）。

**而 `research_then_draft` 有四个**：`research.memo`、`analysis.quick`、`compliance.data`、`compliance.ads`。

### 技能集的规模差异很大

| 能力               | 技能数    |
| ------------------ | --------- |
| `litigation.draft` | **13 个** |
| `matter.status`    | 5         |
| 多数               | 4–6       |
| `ops.invoice`      | 2         |
| `period.calc`      | 3         |

**诉讼文书要 13 个技能**——因为它覆盖的程序类型最多（普通民事 / 刑事 / 破产 / 知产 / 家事各有一套）。

而那个共用的 `OPEN_TOOLS_HINT` 出现在多数提示里：

```text
未锁时本轮已配置工具都可用，按任务选用（常走 `draft_document`；`execute_workflow` 可选）。
不要为走管线丢掉判断。锁路径按本轮工具表。
```

**「不要为走管线丢掉判断」**——这句话在整个仓库里出现了至少四次（第 68.18 节那两条指令里也有同款）。

### 五条最硬的提示

有几条提示里带明确的「必须调工具」：

```text
劳动计算：金额必须调用 `calculate`（economic_compensation / overtime_pay / double_wage）。
        模型只填槽，不得口算交差。缺流水仍交付已能确定的段。
期限计算：届满日必须调用 `calculate`（legal_period）。模型只填起算日和期间种类。
整理发票：归类列表入卷；合计用 `calculate`。缺号码仍列出已有项。
法院短信：抽出案号与开庭时间；能算的期限用 `calculate`。不要编尚未出现的文书。
```

**四句都是「必须调 calculate」**——因为**口算会错**，而这几类的数字是要写进文书的。

**而每条后面都跟一句「缺什么也照办」**：缺流水仍交付、缺号码仍列出、不要编尚未出现的。**所以「算不准」不是「不办」的理由。**

### 那条最长的提示

`matter.status` 的提示：

```text
阶段、期限、范围变更、置信。范围变更须含变更内容/触发/对预算期限影响/状态（无变更也要明写）；
预算与工时对照缺台账标缺口。本地顾问工作包、人力安排、沟通计划走同一办件。冲突两说并列。
```

**五句里有三句是「缺什么怎么办」**：

```text
无变更也要明写
缺台账标缺口
冲突两说并列
```

**「冲突两说并列」**是最有意思的一条——**两种说法冲突时不要选一个，要两个都写出来。**

## 70.10 技能运行时：签名与三种密钥来源

`skill-runtime.ts` 197 行。头注释一行：

```text
Skills E7 — local SKILL.md discovery + HMAC-style signature check.
```

### 六个签名字段

从 frontmatter 读出来的字段：

```text
id  name  version  description
workflows?  逗号分隔（可中英文逗号）
tags?       逗号分隔
tools?      逗号分隔
```

**`tools` 那条注释说明了它的作用**：

```text
/** Comma-separated in frontmatter `tools:` — disclosed when the skill is enabled. */
```

**「技能启用时披露这些工具」**——所以 `tools` 字段是一个**工具披露的开关**。

**而 37 份内置技能里只有 11 份带 `tools:`**——所以多数技能不额外披露工具。

### 签名算法

```text
signSkillBody = HMAC-SHA256(secret, body) 的 hex
```

三个校验结果：

```text
空签名     → { ok: false, error: "missing_signature" }
不匹配     → { ok: false, error: "signature_mismatch" }
匹配       → { ok: true }
```

### 那段关于「是不是真秘密」的注释

这是整个技能体系里最重要的一段：

```text
签名密钥的来源。调用方（尤其是签名 CLI 与打包版）需要知道**这是不是一个真秘密**。

- `env`：`LAWMIND_SKILL_SIGNING_SECRET`。**生产必须走这条**——密钥不进工作区、不进仓库。
- `file`：`<workspace>/lawmind/skills/.signing-secret`。单机便利档；该文件永不入库。
- `derived`：按工作区路径派生的兜底值。**它不是秘密**——算法公开、路径通常可知，
  任何人据此都能伪造一对 `SKILL.md` + `SKILL.sig` 通过校验。仅限本地开发，
  不构成信任锚；打包版应 fail-closed（见 `docs/lawmind/LAWMIND-SKILLS-SIGNING.md`）。
```

**三层信息**：

1. **三种来源 + 哪一种生产必须走**。
2. **`derived` 明说「它不是秘密」**，并解释为什么（算法公开 + 路径可知）。
3. **「打包版应 fail-closed」**——所以派生值不构成信任锚。

派生算法是：

```text
sha256(`lawmind-skill:${workspaceDir}`) 的 hex，取前 32 位
```

**32 位 hex = 128 位**——所以它不是完整强度的密钥。

### 三个文件

```text
<工作区>/lawmind/skills/<id>/SKILL.md     技能正文（带 frontmatter）
<工作区>/lawmind/skills/<id>/SKILL.sig    签名
<工作区>/lawmind/skills/enabled.json      启用名单 { enabled: string[] }
```

而 `listLocalSkills` 的启用逻辑是**两条与**：

```text
enabledDefault = enabledSet 不存在 ? 验签通过 : 名单里有它
enabled        = enabledDefault && 验签通过
```

**「验签不过就一律不启用」**——即使名单里写了它。**所以名单不能绕过签名。**

## 70.11 注入预算：最多两份正文

`skill-prompt-budget.ts` 101 行。头注释一行：

```text
Lean skill injection: dump up to 2 primary stage bodies, index the rest.
```

**「最多 2 份正文，其余进索引」**——这就是 8000 字目录之外的那一层。

### `PRIMARY_BY_CAPABILITY` 的 22 条

每个能力最多两个「主技能」：

| 能力              | 主技能                                              |
| ----------------- | --------------------------------------------------- |
| `contract.review` | `contract-review-layers` + `contract-redline-craft` |
| `contract.draft`  | `contract-drafting-route` + `practice-defaults`     |
| `mail.contract`   | `contract-review-layers` + `citation-grounding`     |
| `research.memo`   | `research-query-matrix` + `citation-grounding`      |
| `letter.draft`    | `delivery-language` + `legal-element-extraction`    |
| `labor.calc`      | `labor-compensation-calc`（**只有一个**）           |
| `period.calc`     | `legal-period-calc`（只有一个）                     |
| `ops.invoice`     | `invoice-organizer`（只有一个）                     |
| `matter.status`   | `matter-status-report`（只有一个）                  |

**四个「只有一个」的能力都是「算」或「整理」类**——它们的技能足够专，不需要第二份。

### `litigation.draft` 的六路选择

诉讼文书是唯一需要按子类型选的：

| 命中                                     | 主技能                                               |
| ---------------------------------------- | ---------------------------------------------------- |
| 家事类词                                 | `family-matter-route` + `legal-element-extraction`   |
| 刑事类词                                 | （刑事那条）                                         |
| 破产类词                                 | （破产那条）                                         |
| 知产类词                                 | `ip-dispute-route` + `evidence-argument-chain`       |
| 交付物是起诉状 或 含「起诉状」           | （起诉状那条）                                       |
| 含「上诉状」「执行异议」「立案材料清单」 | （阶段那条）                                         |
| 都不中                                   | `litigation-stage-route` + `complaint-elements-fill` |

**六路匹配有严格顺序**——家事 → 刑事 → 破产 → 知产 → 起诉状 → 阶段。**越具体的先判。**

### 那个「必须在允许集合内」的约束

```text
候选先按 bound.skillIds 过滤，再取前 2
兜底是 bound.skillIds 的前 2 个
```

**所以主技能表不能凭空引入能力没声明的技能**——它只能在能力给的集合里挑前两个。

**这个约束防的是「主技能表与能力表漂移」**——如果表里写了一个能力没有的技能，它会被过滤掉，而不是被注入。

## 70.12 播种：35 个 id 与那两份没进名单的

`ensure-builtin-skill-seeds.ts` 133 行。

### 升级规则四步

```text
① 源文件缺失 → skipped
② 已有 SKILL.md 但不像内置（不含 source: lawmind-builtin）→ skipped（永不覆盖用户写的）
③ 内容相同且签名文件在 → skipped
④ 已有版本号 > 源版本号 → skipped
⑤ （都不中）→ 重写 SKILL.md + SKILL.sig，记 upgraded
⑥ 本来没有 → 写两个文件，记 created
```

**第 ② 步是最要紧的一条**：**「永不覆盖非内置文件」**。所以律师自己写的技能不会被播种覆盖。

**第 ④ 步「已有版本更高就跳过」**——所以手改过的（版本号调大了）也能保住。

### 那段「调用顺序」的注释

```text
签名密钥。**调用方应显式传入**（在加载完 `.env.lawmind` 之后解析出来的那个），
否则本函数只能自己 `skillSignatureSecret()`——若调用顺序早于 env 加载，就会签下
`derived` 兜底值，随后消费方用 env 密钥验签必然不通过，Skill 静默失效。
```

**「静默失效」**——这是个很典型的坑：**播种用 A 密钥签名，验证用 B 密钥**，结果技能全部验证失败，但**没有任何报错**（因为「验签失败」在界面上的表现就是「技能没启用」）。

**解法是「调用方显式传密钥」**——所以顺序问题变成类型问题（漏传参就编译/运行不过）。

### 那两份「能读但不播种」的技能

这是一个**读代码才能发现的事实**。

```text
src/lawmind/skills/builtin/ 里有 37 份 .md
BUILTIN_SKILL_SEED_IDS 只有 35 个 id
```

差的两份是：

```text
client-talk-intake.md
legal-event-extract.md
```

而**它们被能力表引用了**：

```text
litigation.talk 的 skillIds 里含 client-talk-intake
ops.court_sms   的 skillIds 里含 legal-event-extract
```

**所以它们不是废弃文件。**

### 两条路径的差别

| 函数                       | 读哪里                                  | 用途                 |
| -------------------------- | --------------------------------------- | -------------------- |
| `readBuiltinSkillMarkdown` | **仓库源目录** `skills/builtin/<id>.md` | 注入提示词（兜底）   |
| `ensureBuiltinSkillSeeds`  | 同样从仓库读，但只播 35 个              | 播到工作区供律师编辑 |

而 `readSkillPromptBodies` 的顺序是：

```text
① 优先工作区本地技能（enabled && signatureOk）
② 用内置正文覆盖 contract-redline-craft（特殊）
③ 回落到仓库内置 md
```

**结论：这两份技能永远走第 ③ 步（回落）。**

**三个可观察的后果**：

1. **它们不会出现在工作区**，所以律师**改不了**。
2. **它们不会出现在 `listLocalSkills` 里**（因为那里读的是工作区）。
3. **它们不出现在「技能」设置页**（同理）。

**所以「37 份技能」这个说法要分两层**：**35 份是「可编辑的技能」，2 份是「只读内置正文」。** 第 20 章那份 37 份清单没有区分这件事。

**这是不是 bug**，从代码上看不出来（没有任何注释提到）。但它是一个**值得知道的事实**：如果你要改 `client-talk-intake` 的行为，改仓库文件即可生效，但**它在设置页里看不见**。

## 70.13 包清单：只有 SHA-256，没有远程

`bundle-manifest.ts` 107 行。头注释两句：

```text
法律模板 / 技能包清单与 SHA-256 校验（本地信任根：不执行远程市场下载）。

清单放在 workspace 内，例如 `workspace/lawmind/bundles/my-firm.json`。
```

**「本地信任根：不执行远程市场下载」**——这句话是个产品姿态：**没有插件市场**。

### 清单形状

```text
schemaVersion: 1
bundleId  version  generatedAt
entries: [{ path, sha256, role }]
```

而 `role` 三种：`template` / `skill` / `doc`。

**`path` 那行注释**：`/** 相对 workspace 根的路径，禁止含 .. */`

### 校验五步

```text
① 路径安全（非空、无 ..、非绝对）→ "unsafe path: <路径>"
② 解析后仍在根内 → "escapes workspace: <路径>"
③ 文件存在且是文件 → "missing file: <路径>"
④ sha256 匹配（大小写不敏感）→ "sha256 mismatch: <路径> (expected <期望>, got <实际>)"
⑤ 全部通过 → { ok: errors.length === 0, errors }
```

**第 ④ 步那条错误把期望值与实际值都印出来了**——所以对不上时能直接看出是哪边的问题。

**注意它不做任何执行、不下载**——只校验清单里列的文件。

## 70.14 那三个「不许漂移」的正则表

`capability-patterns.ts` 只有 76 行，但它的头注释解释了它为什么必须存在：

```text
Shared instruction matchers for 办件 bind / keyword route / deliverable meta.
Leaf module (no fs). One regex per scene so the three routers cannot drift.
```

**「三个路由不能漂移」**——这三个路由分别是：

```text
① 意图编译（compile-intent）
② 关键词路由（老的 router）
③ 交付物元信息（deliverable meta）
```

**如果每个路由各写一份正则，它们迟早会不一致**。所以抽成一张表：

```text
Twenty-crime 一张表 = 每个场景一条正则
```

而注释里还有一条**关于顺序的提醒**：

```text
/** Kind/deliverable routing only — do not steal generic 查一下审查起诉. */
```

**「不要抢走泛化的『查一下审查起诉』」**——所以那条刑事路由的正则**只匹配很具体的刑事动作**（取保候审、会见申请、审查起诉意见、刑事辩护提纲、死刑复核、侦查阶段），不含「审查起诉」这四个字。

**这就是「顺序敏感」在正则层面的体现**：宽的正则会抢走窄的该管的事。

### 那张表里最有意思的三条

**① `PUBLIC_WEB_FACT_RE` 与 `LEGAL_LOOKUP_RE` 是一对**

```text
公开事实词：总冠军|冠军是谁|谁赢了|新说唱|选秀节目|综艺节目|热搜榜|票房冠军|比分是多少
法律线索词：（很长一串，含《…》、第X条、常见法律名…）
```

而那两段拒绝话：

```text
这是公开网页事实（不是法律备忘）。请在对话栏把「联网」改成开启后调用 web_search。
deep_research / research_task / list_more_tools 都不能代替该开关。不要凭记忆填写冠军或获奖者。
```

```text
这是公开网页事实，请直接调用 web_search（不要 deep_research / research_task）。
引用须带 URL；查不到就如实说，不要猜。
```

**第二句「引用须带 URL」**，**第一句「不要凭记忆填写冠军」**——两句都在防「模型自己编一个答案」。

**而第一句那句「list_more_tools 都不能代替该开关」**与第 61.1 节那条是同一个意思。

**② `COMPUTE_TABLE_PACK_RE` 比 `COMPUTE_INTENT_RE` 少了裸 `.xlsx`**

注释说明了原因：

```text
/** 路由到核算对照交件；不含裸 .xlsx，避免抢走合同审查。 */
```

**所以「我有个 .xlsx」不会触发核算交件**——因为律师可能只是附了一份表格让审合同。

**③ `TALK_INTAKE_RE` 与 `MATTER_INTAKE_RE` 的分工**

```text
谈话整理：谈话整理|谈话记录|会议纪要|客户口述|客户说了|把这段谈话|整理案情谈话
整理案卷：整理案卷|整理…案件材料|新建案件|建立案件|案件目录|归位材料|补卷宗|按这个文件夹|按里面的材料
```

**前者是「把一段话整理成需求」，后者是「把一堆文件归位」**——对象不同。

## 70.15 技能匹配：三个权重

`skill-match.ts` 只有 49 行，但打分规则很具体：

| 匹配                                                  | 加分    |
| ----------------------------------------------------- | ------- |
| 推荐工作流 id 与该技能的 `workflowIds` 或 `tags` 相交 | **+10** |
| 交付物类型提示与 tags 相交                            | **+4**  |
| 文本与描述里的词（长于 2 字）或 tags 相交             | **+2**  |

**三个权重差了一个量级**（10 / 4 / 2）——所以「工作流对上了」几乎决定了排序。

**而它只考虑 `enabled && signatureOk` 的技能**——所以没验过签的技能根本进不了候选。

排序是 `分降序 → id 升序`（同分按 id 稳定排序）。

## 70.16 历史扫描：八个文件

`historical-scan/` 1177 行。**八个文件全部没有头注释**——这在引擎里是少见的。

### 五个常量（在 `types.ts` 里）

```text
HISTORICAL_SCAN_SCHEMA = 1
MAX_SCAN_ROOTS   = 3        最多 3 个根目录
MAX_SCAN_FILES   = 2_000    最多 2000 个文件
MAX_SCAN_DEPTH   = 8        最多 8 层
HABIT_MIN_OCCURRENCES = 5   习惯要出现 5 次才算
```

### 四个类型与它们的用途

```text
HistoricalDocKind    五种：contract / litigation / evidence / correspondence / other
HistoricalLayout     两种：organized / messy
HistoricalCatalogItem 一项：rootId / relPath / fileName / ext / size / mtimeMs
                             / kind / layout / proposedMatterLabel?
HistoricalHabitCandidate 一条习惯：clauseType / preferredLanguage / occurrences
                             / latestMtimeMs / conflictResolved / samplePaths / matterIds
```

那个 `matterIds` 的注释：

```text
/** 贡献接受 hunk 的不同案件（由 draft 文件解析），供立场证据跨案件门槛使用。 */
```

**「跨案件门槛」**——所以这个字段是为「同一改法在几个案子里都出现过」这个判据准备的。**在多个案子里都这么改，才更像是一条真习惯。**

### 跑一次扫描的九步

```text
① listScanRoots（按 rootIds 过滤）
② readLatestScanJob（拿上一次）
③ incremental = 显式给的值 ?? （上次有任务）
④ 增量时读 cursor
⑤ 逐根 walkScanRoot（累计 truncated）
⑥ classifyWalkedItems（增量时拿 cursor 比）
⑦ 增量时 mergeCatalog（未变的沿用旧条目）
⑧ extractHabitsFromRedlines（从 drafts/*.redline.json 挖）
⑨ hashCatalogFingerprint
⑩ 写任务文件（status: complete）
⑪ 为知识与每条习惯各挂一条记忆采纳建议
⑫ 写新 cursor
```

**第 ③ 步那个默认值有意思**：`incremental` 的默认是**「上次有任务就增量」**——所以第二次扫描自动变增量，不用律师选。

**第 ⑦ 步「未变的沿用旧条目」**——所以没变的文件不会重新分类。

### 增量判定只看两个数

```text
mtimeMs 相同 且 size 相同 → 未变
否则 → 变
```

**两个数都一样才算没变**。这个判据很粗，但很可靠（内容变了 mtime 一定变）。

### 走盘的六条跳过规则

```text
① truncated 或 depth > 8 → 停
② 读不了的目录 → 跳过
③ 符号链接 → 跳过
④ 目录名以 . 开头 或在跳过名单里 → 跳过
⑤ 目录 realpath 出界 → 跳过
⑥ 非文件 → 跳过
```

跳过名单七项：

```text
node_modules  .git  .svn  dist  release  __pycache__  .lawmind
```

**注意 `.lawmind` 在里面**——所以它自己的运行时数据不会被扫。

### 分类的三个函数

**① 文档类型**（看文件名，转小写）：

```text
合同类词 → contract
诉讼类词 → litigation
证据类词 → evidence
函/邮件类词 → correspondence
其他 → other
```

**② 目录布局**：

```text
目录名是「杂项类」（桌面/下载/未分类/杂项/temp/tmp）或 文件数 < 2 → messy
否则 → organized
```

**「文件数 < 2 就是 messy」**——因为一个文件夹里只有一个文件，说明没整理过。

**③ 建议案卷名**：只有 `organized` 的目录才给名字（取目录名，除非它是杂项类）。

**所以「已整理的文件夹」会被建议建案，「杂烩」不会。** 这就是那段知识文档里那两栏的由来：

```text
## 已整理文件夹（建议建案）
## 未分类（杂烩）
- <N> 份，不自动建案。
```

**「不自动建案」**——它明确说了不会动作。

### 挖习惯：五条规则

```text
① 只看 status === "accepted" 的 hunk
② 文本 = heading + before + after 拼起来
③ 条款类型用 clause/ 模块的分类器
④ 偏好的表述 = after 归一化（压空白、去首尾、截 240 字）
⑤ 类型与表述都缺就跳过
```

**累加规则**：

```text
occurrences += 1
samplePaths 去重（上限 5）
matterIds 去重（上限 10）
表述不同且 mtime 更新 → 替换 preferredLanguage
否则 mtime 更新 → 只更新 latestMtimeMs
```

**「表述不同且更新 → 替换」**——所以习惯会跟着最新改法走。**这正是那句「已取最新改法」的由来。**

### 那条习惯建议的文本

```text
审查「<条款类型>」条款时，默认采用：<偏好表述>（<次数> 次，已取最新改法）
```

**三段**：什么条款、用什么表述、**几次 + 已取最新**。

**「（5 次，已取最新改法）」**——把依据与口径都报出来了。

### 挖习惯的输入从哪来

```text
<工作区>/drafts/*.redline.json
```

而案件 id 是从**同名的草稿文件**里读的：

```text
<名>.redline.json → <名>.json，读它的 matterId
```

**所以改稿文件本身不带案件 id，得回查草稿。** 这个设计让红线文件保持简单（只存 hunks）。

### 那两份知识采纳

```text
kind: historical.knowledge     来源标记 historical_scan
kind: lawyer.habit_pattern     来源标记 habit_min_5
```

**而「历史知识」有一条 `!knowledgeUnchanged` 的条件**——所以增量扫描且目录指纹没变时**不重复挂建议**。

**这防的是「每次扫描都挂一批一模一样的建议」**——那会让待确认记忆里堆满重复项。

## 70.17 已知坑（本章相关）

- **意图编译的书面七级与实际十七分支顺序不同**（类型默认在案件门类之前）。
- **头注释明写「不要把七级压成一条大正则」。**
- **`softAsk` 字段有类型、有读取点、有测试断言但它永远是 `undefined`**——「软问」在代码层面不会发生。
- **`mail.contract` 不在隐式能力目录里**（22 条可见，23 条存在）。
- **`softenReadFirstBind` 会把「只是看看」的绑定从 high 降到 medium**。
- **那对致命误绑只有一对**（合同审查 ↔ 诉讼文书）。
- **金标集里有两个互补用例**（话与文件冲突时，一个跟话、一个跟文件）。
- **交件意图与能力绑定是两个正交维度**；交件层「不锁工具表」。
- **「两种交件都要」时交件形态是 `unspecified`**（不特殊处理）。
- **`mutateSource` 只有明写「覆盖原件」才会 allow。**
- **意见书必须 `chatMirror: required`**（会话里要写完整内容，不能只给路径）。
- **快速合同审查 + Word pin 会强制交件形态为 unspecified**（不与成套交件打架）。
- **`wantsContract` 测的是剥掉否定短语后的文本，`wantsPleading` 测原文。**
- **「模糊」的最终判定要求同时不含 review 与 draft 动词。**
- **文件名优先于正文类型**；正文只在文件名判不出来时用。
- **`合同` / `表格` 不是粘性类型**（排名 40 / 30，低于 45 的线）。
- **起诉状正文里到处引用合同**，所以正文里出现「合同」不能说明是合同文件。
- **纯确认（好的 / 嗯 / k / ok）是「无任务」，不是「续作」**——否则一句 `k` 会重跑整条流水线。
- **方括号系统标记不会被当成文件夹名。**
- **函件核对要「函件词 + 核对词」两个同时成立。**
- **否定短语是短语级剥离，不是把「不是」当关键词。**
- **「把文件夹收进案件」不需要先 explore_folder。**
- **任务书四个字段各上限 80 字**（是四条一句话，不是四段话）。
- **技能正文只在前五个硬来源下注入**（lock / short_path / word_revision / 高置信 specialized / 高置信 joint）。
- **`readSkillPromptBodies` 会优先用工作区本地技能**（enabled + 验签通过）。
- **签名三种来源里 `derived` 不是秘密**（算法公开、路径可知），打包版应 fail-closed。
- **`enabled.json` 不能绕过签名**（启用是「名单里有」与「验签通过」两条与）。
- **播种永不覆盖非内置技能文件**（看 `source: lawmind-builtin`）。
- **播种的密钥必须显式传入**，否则可能签下 `derived` 值导致技能**静默失效**。
- **`builtin/` 有 37 份 md，播种名单只有 35 个**——`client-talk-intake` 与 `legal-event-extract` 能被读取但不会进工作区。
- **所以那两份技能改不了、在「技能」设置页也看不见**（但被能力表引用着，功能是正常的）。
- **主技能表只能在能力声明的技能集合里挑**（防两张表漂移）。
- **诉讼文书的主技能要按六路子类型选**（家事 → 刑事 → 破产 → 知产 → 起诉状 → 阶段）。
- **包清单只做 SHA-256 校验，不做远程下载**（没有插件市场）。
- **正则表单独成文件是为了让三个路由不漂移。**
- **`COMPUTE_TABLE_PACK_RE` 刻意不含裸 `.xlsx`**（避免抢走合同审查）。
- **刑事路由正则不含「审查起诉」四个字**（否则会抢走泛化的检索请求）。
- **公开网页事实会被明确拒绝**，并指向那个联网开关。
- **技能匹配的三个权重差一个量级**（10 / 4 / 2）。
- **历史扫描的 `incremental` 默认是「上次有任务就增量」**（不用律师选）。
- **增量判定只看 mtime + size 两个数。**
- **走盘跳过名单含 `.lawmind`**（不扫自己的运行时数据）。
- **文件数 < 2 的目录算「杂烩」**。
- **「杂烩」目录不会被建议建案**，且明说「不自动建案」。
- **习惯至少出现 5 次才算**，而且要在多个案子里出现过（`matterIds`）。
- **`samplePaths` 上限 5、`matterIds` 上限 10、表述截 240 字。**
- **改稿文件不带案件 id**，要从同名草稿文件回查。
- **增量扫描且目录指纹没变时不重复挂知识建议**（防待确认列表堆重复项）。
