# 第 4 章 意图编译与能力绑定

第 3 章讲了一个回合怎么跑；本章回答「这个回合该怎么跑」——律师说一句话，系统如何决定用哪一个能力。

> 这一章讲**产品面**（律师会看到什么、边界在哪）。逐文件的实现精读在**第 70.1–70.9 节**：书面七级顺序与实际十七个分支的差别、19 项专用信号、73 个金标用例、交件意图、文件类型判定、短话分类。这一章里凡是涉及「哪个文件、哪个函数」的段落，都在那里有更完整的版本。

## 4.1 定位：不选办件，直接说事

LawMind 的默认路径里**没有办件菜单**，也没有「改路由」按钮。律师丢材料或说一句话就能交办，分类由**隐式意图编译**完成，编译器自行择一，不向律师提问分类。这条设计的判定口径是：审查 ↔ 诉讼这类**致命误绑**必须可测，所以编译器用**确定性信号抽取**（文本动词 × 文件形态 × 案件 / 邮件语境），而不是让模型自由发挥。

## 4.2 怎么用：状态条与两种覆盖

- **状态条**：对话顶部只显示一行「本轮按××处理」（`LawmindIntentStatusBar.tsx`）。它是状态，不是选择器。
- **`$skill` 显式覆盖**：在指令里写 `$skill contract.review …` 会强制绑定该能力，绕过隐式判定。
- **办件锁定**：一旦进入某个办件，后续回合保持锁定，直到律师改口或换材料；也可用「【办件】能力：」形式显式指定。
- **多意图**：一句话里含多个诉求时，编译器输出 `chain` 并预填两步清单。
- **看依据**：`intent` 事件带 `capabilityId`、`lawyerSummary`、`confidence`、`source`、`alternatives`、`chain`，用于排查「为什么被判成这个」。

> 事件里还有一个 `softAsk` 字段，但**它永远是空的**（代码里从没给它赋过值，两处测试显式断言它是 `undefined`）。「系统会追问一次」这件事是真的，但走的不是这个字段——见下一节。

## 4.3 边界：什么时候会问律师

编译器默认**不问**。唯一会软问的场景是**高风险空跑**——要动手，但输入明显不足（材料/信息不够）。**材料齐备时不冻写、不追问**。

这条软问由 `src/lawmind/agent/turn-orchestrator-shortcuts.ts` 的 `tryIntakeClarificationShortcut` 落地，用 `resolveIntakeClarificationQuestions` 生成问题，对应 `intake-required-inputs` 技能。

**为什么只在这一种情况下问**：因为这是「问了有用」的情况——继续做下去大概率白做。其他情况问了只是打断。

> **一处容易搞错的地方**：这条软问和第 4.2 节提到的 `CompiledIntent.softAsk` **不是一回事**。前者是回合编排层的一条短路（真的会问），后者是意图编译器类型上的一个**从未启用的字段**（永远是 `undefined`）。别把两者混起来读。

三类**硬钉**优先于一切隐式判定，且不可被材料内容翻案：

1. 办件锁定；
2. 邮件合同短路径（邮箱来件）；
3. Word 改稿锁定（明示「改这份 Word」）。

## 4.4 判定分七层（以及实际不止七层）

`src/lawmind/intent/compile-intent.ts` 是**叶子编译器**：不碰文件系统，渲染进程可直接调用。它只做「信号抽取 + 排序」，源码注释里明确要求**不要压成一条正则**，并给出七层从高到低：

1. **硬钉**：办件锁定、邮件短路径、Word 改稿锁定。
2. **高精度专用文本**：劳动金额、期限、发票、传票等。
3. **文件形态 × 动词联合判定** ← 准确率核心。
4. 关键词 / 交付物类型回落（历史上 router 的路径）。
5. 会话延续。
6. **案件门类只作平局裁定**，绝不覆盖第 2–3 层。
7. 有材料但语句含糊时，用文件形态的默认能力。

**但这七条是「优先级说明」，不是代码里的执行顺序。** 实际求值有**十七个分支**，其中最明显的两处差别是：四个守卫（公开网页事实、无任务话、问候、纠正）插在第 2 层之前；「类型默认」排在「案件门类」**之前**。完整对照见第 70.1 节。

致命误绑对是 `contract.review` ↔ `litigation.draft`：**诉状头压过正文里的「合同」二字**（起诉状里到处引用合同，所以正文出现「合同」说明不了任何事）。

专用识别有一张映射表（19 项，节选）：劳动金额 → `labor.calc`、期限 → `period.calc`、发票 → `ops.invoice`、传票/12368 → `ops.court_sms`、知产 → `ip.dispute`、并购 → `deal.ma`、数据/广告合规 → `compliance.data` / `compliance.ads`、办案周报 → `matter.status`、家事 → `family.matter`、招股 → `capital.markets`、治理 → `corp.governance`、民事/破产/刑事阶段 → `litigation.draft`、案卷归位 → `matter.intake`、谈话 → `litigation.talk`、快问 → `analysis.quick`、表格汇总 → `materials.draft`、检索备忘 → `research.memo`。

文件形态的默认能力表（11 项，节选）：合同 → `contract.review`，诉状 → `litigation.draft`，函件 → `letter.draft`。

## 4.5 服务端编译与文件形态

`src/lawmind/intent/compile-turn-intent.ts` 是服务端版本：先 **peek 钉选文档**（文件名 + 正文前段）并查案件门类，再委托给叶子编译器。它是 `runTurn` 与 `POST /api/intent/compile` 的**同源**实现——**状态条显示的和实际执行的绑的是同一次编译结果**。

peek 有两个上限：最多 4 份文件、每份 8000 字。它只在「文件名判不出类型」时才用来升级判定。

文件形态的判定在 `src/lawmind/intent/document-genre.ts`，十三条文件名规则**顺序不可换**（发票排最前、诉状排在合同之前）。实现细节见第 70.6 节。

## 4.6 能力目录与渐进披露

未绑定（或只有软假设）时，系统注入**能力目录**：为每个能力给出 `label`、`description`（含「触发」与「不要用于」两类边界）、`allowImplicit`。上限 **8000 字**。

- 23 个能力里**只有 22 个进目录**——`mail.contract` 的 `allowImplicit = false`：邮件短路径不得隐式抢走对话里的合同审查。
- 目录里每人一条「不要用于」正是致命误绑的护栏，例如 `contract.review` 明写「不要用于起诉状、从零起草或劳动金额计算」。
- 已硬绑定时**不注入目录**，只注入技能正文（见 4.7）。

三档披露：目录（未绑定时）→ 最多两份技能正文（硬绑定时）→ 按需 `read_skill`。

## 4.7 能力锁定与注入预算

- **能力仓库**：`src/lawmind/skills/lawyer-capabilities.ts`、`capability-patterns.ts`、`lawyer-capability-lock.ts`。
- **注入预算**：`skill-prompt-budget.ts` 规定「最多 2 份主阶段正文，其余只给索引」——避免把整本技能书塞进系统提示。而且主技能**只能在能力声明的技能集合里挑**，防两张表漂移。
- **技能选择**：`skill-match.ts` 按三个权重打分（工作流 +10 / 交付物 +4 / 文本 +2）；`read_skill` 让模型按需读某份正文。

细节见第 70.9–70.11 节。

## 4.8 金标集

`src/lawmind/intent/gold-set.ts` 有 **73 个用例**，每条是「律师口吻的句子 ± 材料」+ 期望结果（含 `unbound` / `pipeline` / `deliveryShape` / `deliveryPlace` 四种期望）。它登记了**一对致命误绑**：`contract.review` ↔ `litigation.draft` 不得翻转。

用例形状与几个典型样本见第 4.11 节；逐条清单见第 70.3 节。

## 4.9 关键文件

| 关注点             | 文件                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 叶子编译器         | `src/lawmind/intent/compile-intent.ts`                                                                                                         |
| 服务端编译（peek） | `src/lawmind/intent/compile-turn-intent.ts`、`peek-pinned-documents.ts`                                                                        |
| 能力目录           | `src/lawmind/intent/catalog.ts`                                                                                                                |
| 文件形态           | `src/lawmind/intent/document-genre.ts`                                                                                                         |
| 文本意图与话术判定 | `src/lawmind/intent/text-intent.ts`、`utterance-kind.ts`                                                                                       |
| 交付意图           | `src/lawmind/intent/delivery-intent.ts`                                                                                                        |
| 金标集             | `src/lawmind/intent/gold-set.ts`                                                                                                               |
| 类型               | `src/lawmind/intent/types.ts`                                                                                                                  |
| 能力与锁定         | `src/lawmind/skills/lawyer-capability-lock.ts`、`lawyer-capabilities.ts`、`capability-patterns.ts`、`skill-match.ts`、`skill-prompt-budget.ts` |
| HTTP               | `apps/lawmind-desktop/server/lawmind-server-route-intent.ts`（`POST /api/intent/compile`）                                                     |
| UI                 | `apps/lawmind-desktop/src/renderer/LawmindIntentStatusBar.tsx`、`lawmind-intent-*`                                                             |

## 4.10 已知坑

- 编译器**不许**退化成一条大正则；新增能力必须同时补目录描述、共享叶子正则与金标集用例，否则三处会漂。
- 案件门类（matter kind）只允许做平局裁定，一旦让它覆盖文件形态判定，就会出现「把起诉状当合同审」。
- 邮件短路径必须保持 `allowImplicit = false`；一旦允许隐式匹配，对话里附了合同附件时会被邮件路径抢走。

## 4.11 补充：金标集长什么样

`gold-set.ts` 里的用例是「律师口吻的句子 ± 材料」+ 期望结果。几种典型的：

| 用例 id                                     | 输入                                          | 期望                          |
| ------------------------------------------- | --------------------------------------------- | ----------------------------- |
| `review-nl`                                 | 「请审查这份采购合同的违约责任」              | `contract.review`             |
| `letter-nl`                                 | 「写一封催款律师函」                          | `letter.draft`                |
| `skill-dollar-override`                     | 「`$skill contract.review` 帮我看看这份材料」 | `contract.review`（覆盖生效） |
| `research-nl`                               | 「查一下民法典违约责任」                      | `research.memo`               |
| `web-fact`                                  | 「查一下 2026 年新说唱总冠军」                | **不绑定**（`unbound: true`） |
| （带 `pipeline: "tracked_redline"` 的）     | 明示「改这份 Word」                           | 走修订轨                      |
| （带 `deliveryShape` / `deliveryPlace` 的） | 说了「只出意见书」「放桌面」                  | 交付形态与落点匹配            |

**两条契约**：

1. **`contract.review` ↔ `litigation.draft` 不得翻转。** 这是那对致命误绑。
2. **娱乐事实类必须不绑定。** 那条 `web-fact` 用例说明系统要能识别「这不是法律任务」。

`unbound` 这个期望值很有价值：**它约束的是「不许乱绑」**，不只是「要绑对」。

## 4.12 补充：一句话同时含多个诉求怎么办

编译器的输出里有 `chain` 字段，用于多意图。

处理方式：

1. 编译器识别出主能力 + 后续步骤。
2. `chain` 里列出顺序。
3. **预填两步清单**（不是让你选，是把顺序摆出来）。

比如「帮我审一下这份合同，然后写个给客户的说明函」——主能力是合同审查，chain 里跟着函件起草。

**链不是工作流**。链是「同一轮里可能要连做几件事」的提示；工作流是「多个助手分步执行」（第 16 章）。

**只有两种后续会被追加**：绑合同审查且提到函件 → 追函件起草；绑诉讼文书且信号是「谈话」→ 追谈话整理。**主能力永远在链首。**

## 4.13 补充：「不要压成一条大正则」是什么意思

源码注释里那句 `Precedence (do not flatten into one regex)` 防的是三种后果：

- 硬钉（办件锁、邮件短路径、Word 改稿）和软信号会互相干扰。
- 出现误判时**无法定位是哪条规则赢的**。
- 加一条新信号可能**悄悄改掉旧行为**。

分层之后每层可以单独测、单独调。这也是为什么它输出 `source` 字段——**告诉你这一轮是哪个来源赢的**。

## 4.14 补充：`source` 的取值

排查「为什么这一轮被判成这个能力」时，**先看 `source`**。十种值分三档：

| 档   | source                                               | 含义                     |
| ---- | ---------------------------------------------------- | ------------------------ |
| 硬   | 能力锁 / 邮件短路径 / Word 改稿                      | 律师显式指定或场景已钉死 |
| 半硬 | 专用信号 / 文件形态×动词                             | 判出来的，置信度可高可中 |
| 软   | 关键词回落 / 会话延续 / 案件门类 / 形态默认 / 没绑上 | 兜底                     |

**只有前两档里的高置信情况会注入技能正文**——软档只给能力目录。这条界线在 `understand-first.ts` 里，见第 70.8 节。

## 4.15 补充：新增一个能力要动几处

第 18 章讲了流程。这里补充「为什么这几处必须一起改」：

| 要动                                                        | 漏了会怎样                 |
| ----------------------------------------------------------- | -------------------------- |
| 能力定义（`LAWYER_CAPABILITIES` + `LAWYER_CAPABILITY_IDS`） | 编译出来也没有对应实现     |
| 能力目录描述（`catalog.ts`）                                | 未绑定时模型看不到这个能力 |
| 共享叶子正则（`capability-patterns.ts`）                    | 三处判定会漂               |
| 主阶段技能映射（`PRIMARY_BY_CAPABILITY`）                   | 模型不会默认看到对应技能   |
| 金标集用例                                                  | 没有回归保护               |
| 桌面端条目（`LAWYER_CAPABILITY_DESK_ITEMS`）                | 界面上没有入口             |

**六处**。这就是为什么加能力比加工具麻烦——它牵涉判定、提示、界面三层的对齐。
