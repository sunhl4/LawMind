# LawMind 律师可观测性指标

`src/lawmind/metrics/` 提供**基于已落地事件的真实口径指标**，不输出无法验证的「安全分」「质量分」。

## 模块职责

- `runtime-events.ts` / `product-metrics.ts`：事件真相源（runtime 事件与派生产品指标）。
- `lint-escape-candidates.ts`：lint 逃逸飞轮的写入端与**读取端**（`escape-candidates` / `escape-corpus` / `escape-stance`）。
- `decision-samples.ts`：**决策语料导出**——把上述信号归一成可编译语料 + 数据体检报告（第二十期 P0）。
- `unescalated-delivery.ts`：**未升级交付的外生验收信号**——把「律师对本次交付的态度」从 runtime 事件折出，喂给 `delivery/judgement-ratchet.ts`。见下。
- `firm-calibrator.ts`：**firm-specific 校准器**（第二十期 P3）——特征抽取 + 标签派生 + 确定性 logistic 拟合。**目标是「这位律师会不会动手改」这个行为学问题，不是法律正确性**；样本不足时诚实拒绝产出。见下。- `north-star.ts`：全工作区 north-star 比率（一次过率、lint 逃逸率等）。
- `team-growth-dashboard.ts`：团队内测指标表（Wave A–D DoD）。
- `lawyer-dashboard.ts`：律师可观测性仪表盘——**案件级**真实指标与 **LawmindDesk** 汇总。

## 未升级交付的外生验收信号（第二十期 G2）

`deriveCleanDeliveryByTask(workspaceDir)` / `collectJudgementSeriesInput(workspaceDir, ...)`

**为什么存在**：`delivery/judgement-ratchet.ts` 的「测量换信任」判据需要两样输入——
哪一项报过（`guardian/item-outcome.ts` 产出）、以及报过的那几次**律师最后认可了吗**。
第二项曾一度被写成「本任务没有任何项报项」，结果是 `firedClean` 恒为 0、误报率恒为 0，
**每一项都会被判可升 blocking**。详见计划文档 §4.1b。

**三条不得违反的口径**：

1. **外生性（SEAL 原理）**：批准必须**来自律师**。系统自动交付写下的
   `reviewStatus="approved"`（`reviewedBy` 以 `system:` 开头）**不算验收信号**——
   那是判定器给自己判卷。arXiv 2607.24300 的结论是：可靠自改进
   **需要一个 agent 无法控制、无法观察的接受/拒绝信号**。
2. **三态而非布尔**：`humanAcceptance` 有 `unknown` 一档且必须存在。
   律师还没审核时，把它当「不干净」会让每项都被记成真报项（误报率虚低 → 乱升级）；
   当「干净」则相反。**信号未到的任务整条不产出**。
3. **0 ≠ null**：`decidedRatio` 为 `0` 表示「有交付但全部无法判定」，
   为 `null` 表示「连交付事件都没有」。两者处置完全不同。

**体检**：`summarizeExternalSignalCoverage()` 回答一个在 Doctor 上看起来一样、
但处置完全不同的问题——「棘轮没有可升级项」到底是**规则质量不够**，
还是**信号通路没接通**？`unknownReasons` 直接指出卡在哪一环。

## 决策语料导出（第二十期）

`collectDecisionSamples(workspaceDir)` → `decision-samples.jsonl` + 数据体检报告。

**为什么存在**：`lint-escape-candidates.ts` 自第十四期起就在写逃逸文件，但**全仓没有任何一处读它们**——
飞轮有写入端、没有读取端。本模块提供读取端，并把其余既有信号（产品指标 / 运行时事件 / 质量快照 /
拍板记录）归一进来，作为「把 LLM 退到编译期」的原料。

**三条不得违反的口径**：

1. **缺来源 → `present: false`，绝不产出 0。** 参照 `north-star.ts` 的
   「Missing samples stay null — do not invent a 0% story」。把「没有数据」显示成「没有漏网」
   是这类报告最危险的失败模式。
2. **截断显式。** 事件文件读窗口超限时标 `truncated` 并给出 `totalLines`。
3. **`collect` 纯读取**，写盘只在 `writeDecisionSamples()`。

**第四条（2026-09-21 补）：演练必须自证。** 工作区根有 `.lawmind-drill.json`
（`pnpm lawmind:round` 写的）时，报告标 `drill: true`、`sources[]` 加一条具名的 `drill` 来源，
并加一条 warning。**标记内容坏掉也按演练处理**（fail-closed）——反过来刚好会在「标记写坏」
时把演练数据静默放行成真实分布。理由：那个工作区里的 JSONL 与真实飞轮**同形**，
「跑了 50 轮」与「真实办了 50 件」在报表上本来长得一模一样。

**关键语义**：`rule_miss` / `rule_hit` 描述的是**逃逸候选文件里那次审核的规则命中与否**，
不是「编译器漏没漏实体缺陷」：

- `rule_miss` = 该次审核**没有产生任何规则命中**（`ruleIds` 为 `[]`，空数组本身就是信号）；
- `rule_hit` = 规则命中了（`ruleIds` 非空）。

**不要再按「`lawyer_edit` ⟹ `rule_miss`」去读**：本模块**不做这个映射**（见
`decision-samples.ts` 模块头「不再把 `lawyer_edit` 映射成 `rule_miss`」）——那会把两个
不同的东西混成一个名字，而且 lint 读的是改后文本，原稿缺陷可能已被改掉。详见下节
「飞轮的真实口径」。

**报告里的 `warnings`** 是数据缺口自述（缺来源、截断、无正文片段、无已结论拍板…）。
**`warnings` 为空不代表数据充足**，只代表本次没发现缺口。

### 飞轮的**真实口径**（2026-09-21 由一轮真实办件修正）

`engine/reviewing.ts` lint 的是**审核时传入的 draft**，即**律师改完后提交的那一版文本**：

| outcome         | 精确含义                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `lint_findings` | **最终稿**仍有 blocker/warning                                                                  |
| `lawyer_edit`   | **最终稿机械干净**，且该稿有改稿幅度（`rewriteAmplitude.absCharDelta + absParagraphDelta > 0`） |

**因此有一个必须记住的局限**：

> 飞轮**看不见**「agent 原稿有缺陷、律师在提交前改掉」这一类——lint 读的是改后文本，
> 缺陷已被改掉。所以 `rule_miss` **只表示**「最终稿无机械缺陷但仍被改过」（可能只是口径/风格），
> **不等于**「编译器漏掉了实体缺陷」。要测真实盲区必须在**改稿前**另 lint 一次原稿
> ——见 `scripts/lawmind/lawmind-round.ts`（它同时 lint 原稿与改后稿）。

两条后决条件：**零命中 + 无改稿幅度 ⟹ 什么都不写**（不是 `lawyer_edit`）。
另有：**linter 的输入是 `title + summary + heading + body` 拼起来的全文**，
不只是正文——所以摘要措辞会影响判定。

口径由 `escape-flywheel-semantics.test.ts`（7 例）锁定；改变即测试变红。

## 改稿范例（素材通道）

`src/lawmind/learning/edit-examples.ts` —— 把律师改稿的 **(改前, 改后) 完整对照**存成可检索范例。

**为什么要有它**：飞轮（上面的 `escape-*`）记的是「哪条规则没命中」；
偏好通道记的是「压成 ≤160 字的一句话」。**完整对照在压缩时丢了**——
而一句话只能告诉模型「要这样写」，教不会「这种场合长这样」。

```
范例（保留）：「…保留解除合同及要求赔偿损失的权利」
             → 「…现要求贵司于 2026 年 10 月 5 日前完成全部交付…」
             能看出场合、力度、落款规矩
偏好（压缩）：「催告函要有明确期限和解除后果」
             场合没了、示范没了
```

**四条设计约束**（都有测试锁定）：

1. **与 `golden/` 分开存**。`golden/` 是「律师**判定**这条是典范」；改稿只是「律师动过手」
   ——很多改稿在**修缺陷**，不是示范。混存会让坏例子挤掉好例子。
2. **存得宽、注入得省**（存 600 字/侧、注入 220 字/侧）。实测：600 字原样入 prompt
   会在块中间被截断，把「律师说明」挤掉。修法含**把最短最值钱的字段放最前面**。
3. **只加不改**。原偏好通道（≤160 字 → 待确认 → `LAWYER_PROFILE`）行为完全未动。
4. **素材，不是闸**。注入文案有测试断言**不得出现**「必须 / 一律 / 禁止 / 不得」；
   检索不到 → 整块不注入；写入失败不影响偏好通道。

**检索与黄金范例同权**（共用 `scorePayloadAgainstQuery`），否则「哪条更相关」
在两处给出不同答案，无法解释。

```bash
pnpm lawmind:decision-samples -- --dry-run   # 打印范例库规模与将注入的块
```

## 派生事实（第二类：该算的算好）

`src/lawmind/reasoning/derived-facts.ts` —— 把**该算的算好**，作为素材喂给模型。

**起因**：真实采购合同的定金 310,000 / 标的额 1,032,000 = **30.04%**，超民法典第 586 条的
20% 上限——而规则 `statutory.deposit_cap` **静默放过**，因为它只匹配 `定金…(\d+)%`
这种**显式百分比**写法，真实合同只写金额。**模型失败的往往不是判断，是算术。**

七类事实：

| kind                        | 算什么                                                   |
| --------------------------- | -------------------------------------------------------- |
| `deliverable_scope`         | 交付物体裁（函件 / 合同文本 / 审查意见书 / 诉讼文书）    |
| `deposit_cap_ratio`         | 定金占标的额的真实比例 vs 法定上限                       |
| `payment_sum`               | 付款分项**金额**合计 vs 合同标的额                       |
| `unit_price_times_quantity` | 单价 × 数量 vs 合同标的额                                |
| `total_inconsistent`        | 同一「标的额」标记出现多个**不同值**                     |
| `payment_ratio_sum`         | 付款**比例**合计 vs 100%                                 |
| `penalty_asymmetry`         | 逾期违约金两侧的费率与基数（**只述可比性，不判不公平**） |

**`limit` 的截断顺序＝注册顺序**（`COMPUTERS` 即优先级），越靠前越不会被丢。

**明确不做**：4×LPR —— `lint/statute-params.ts` 写明「LPR 序列尚未入库」，
没有值就算不出上限，按第 3 条约束不做。

**日期类两类**（期间值取自参数库，不是硬编码）：

| kind                  | 算什么                                                                |
| --------------------- | --------------------------------------------------------------------- |
| `deadline`            | 显式日期 + 紧随的期间 → 到期日（按民法期间规则**夹取月末日**）        |
| `limitation_deadline` | 诉讼时效届满日 = 起算日 + 3 年（`DEFAULT_LIMITATION`，民法典第188条） |

两条**不产出的边界**（"算不出来就不说"）：

- **工作日不折算** —— 需节假日表，本仓没有，不猜；
- **无显式日期不产出** —— 「收到本函之日起十日内」没有起点，算不出。

**日期遮蔽是必需的**：`11 月` / `30 日` 既是日期的一部分、又长得像期间表述。
不遮蔽的话 `2026 年 11 月 30 日前` 会被读成「11 个月」+「30 日」，算出不存在的期限。

**三条硬约束**（有测试锁定）：

1. **事实，不是结论。** 只说数字与出处。有测试断言产出里**不得出现**
   「违反 / 无效 / 必须 / 不产生定金效力」。
2. **必须给算式。** `arithmetic` 字段写出中间步骤——**这是「素材」与「神谕」的分界**：
   模型看到 `310000 ÷ 1032000 = 0.3004` 才能自己判断；只给「30.04%」它只能照抄。
3. **算不出来就什么都不说。** 找不到明确的标的额标记时**不猜**——
   猜错一个标的额会产出看起来权威的错误数字，比没有更糟。

**与门禁的关系：无。** 只作 `memory_hit` 素材；异常一律吞掉；算不出就是空数组。

**prompt 预算是真实约束**：这个块约 445 tokens（CJK 约 1 token/字），
而 `memory_hit` 默认 capTokens 只有 200 —— 不显式放宽就会被腰斩在事实中间。
见 `DERIVED_FACTS_CAP_TOKENS` 与 `turn-orchestrator-prompt.ts` 的接线注释。

## 素材块合并（D10）

`src/lawmind/agent/material-blocks.ts` —— 三个素材通道收进**一个**受预算约束的片段。

| 通道     | 来源                          |
| -------- | ----------------------------- |
| 派生事实 | `reasoning/derived-facts.ts`  |
| 改稿范例 | `learning/edit-examples.ts`   |
| 黄金范例 | `evaluation/golden-recall.ts` |

**为什么合并**：此前三者各自 `queue("memory_hit", ...)`、各自 cap、各自优先级，
实测撞了两次「prompt 打包器在**块中间**截断」——被腰斩的素材比没有更糟，
因为看起来像一句完整的话。

合并后的三条性质：

1. **整块取舍**：超预算时**整条丢弃**，绝不在通道内部拦腰截断；
2. **顺序即优先级**：派生事实（代码算的）> 改稿范例（本所独有）> 黄金范例（块内已给 `read_workspace_file` 指路）；
3. **丢弃具名**：被丢的通道**指名说明**，否则「没看到」与「本来就没有」无法区分。

### 丢弃可测（不只是写在文案里）

`recordMaterialBlockEvent()` 在**真实 prompt 路径**里记录每次合成结果，
`summarizeMaterialBlockHealth()` 汇总各通道的丢弃情况。

**为什么必须可测**：丢弃此前只体现在 prompt 文案里——**律师看得见，系统看不见**。
于是无法回答「某个通道是不是长期被丢」。如果黄金范例 80% 的回合都被丢，
要么预算太小，要么这个通道不值得留——**这需要数字，不是印象**。

| 口径                                  | 说明                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `presentCount = 纳入 + 丢弃`          | **只有「本来有内容」的回合进分母**；本来没内容不算「被丢」                        |
| `dropRate` 在 `presentCount === 0` 时 | **`null`**，不编造 0%                                                             |
| `worstChannel`                        | 需样本 ≥ `MATERIAL_HEALTH_MIN_SAMPLES_PER_CHANNEL`(5) 才给，否则只报 `anyDropped` |

产品指标 kind `material_block`，`meta` 携带 `included` / `dropped` / `droppedCount` / `chars`
（用逗号连接的名字而非数组——`meta` 类型不含数组，不为一个观测字段放宽共享类型）。

**`lawmind:round` 里看不到这个指标是正常的**：它走 engine 管线（`createLawMindEngine`），
而素材注入在 **agent turn**。CLI 会如实说「尚无观测数据」，不折算成 0。

```bash
pnpm lawmind:decision-samples -- --dry-run          # 只看报告
pnpm lawmind:decision-samples                        # 写入 workspace/lawmind/decision/
pnpm lawmind:decision-samples -- --json | jq .warnings
```

## firm-specific 校准器（第二十期 P3）

`buildCalibrationDataset()` → `fitFirmCalibrator()` → `predictEditProbability()`。

**目标函数是行为学的**：预测「这位律师会不会动手改」，**不是「法律上对不对」**。
理由：前者有干净标签（`firstPassApproved` / `reviewStatus` / `first_pass_*` / `ReviewLabel`），
且正好是拍板门禁要判的东西；后者不可测。**不要把它当质量模型。**

**冷启动必须诚实**：样本量 < 40 或任一类别 < 5 时返回 `status: "insufficient"`，
并且 `predictEditProbability` 返回 `undefined`——**不返回「大概 0.5」**。
给一个默认概率会让调用方以为有信号，那是最危险的失败模式。

**确定性**：固定初始值与步数、无随机。同一份数据两次拟合得到完全相同的参数
（权重 / 截距 / 均值 / 标准差），可写进审计并在事后复现。

**两条偏置声明写进产物本身**（不只是文档）：

1. `trainMetrics` 是训练集表现，**不是泛化估计**；
2. 标签只来自走到拍板/审核的动作，**被静默放行的样本不在训练集中**，
   模型在「明显无需干预」的稿子上会偏高估风险。

`FEATURE_VERSION` 与 `lint/statute-params.ts` 的 `effectiveFrom` 是同一思路：
**特征是模型的一部分**——改了特征定义，旧拟合结果就不再有意义。

## 案件级指标口径（`buildMatterHealthMetrics`）

输入：一个案件的 `runtime-events`、`product-metrics`、签批/队列/期限数据。
输出：

| 指标               | 计算口径                                                                                                                          | 律师语言                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `lintCoverageRate` | 已触发机械核对规则数 / 已注册相关规则数。未传入外部规则集时，分母使用引擎内置 `LEGAL_LINT_RULES + CITATION_VALIDITY_RULE_COUNT`。 | 已核对 X% 的机械规则          |
| `editRate`         | `lawyer_edit` 中 `outcome === "modified"` 的事件 / 全部 `lawyer_edit` 事件。                                                      | AI 建议后被律师实质修改的比例 |
| `firstPassRate`    | `deliver` 事件中 `firstPass === true` 的比例。                                                                                    | 首次交付无需修改的比例        |
| `pendingApprovals` | 案件签批记录中 `status === "pending"` 的数量。                                                                                    | 待拍板数                      |
| `overdueTasks`     | 案件期限记录中 `status === "open"` 且 `dueAt` 已过当前时间的数量。                                                                | 逾期任务数                    |
| `lastActivityAt`   | 所有 runtime/product/签批/队列/期限事件中的最新时间戳。                                                                           | 最近活动时间                  |
| `phase`            | 按「待签批 → 待改稿 → 可交付 → 交办」推导的当前阶段。                                                                             | 当前阶段                      |

注意：无样本时，所有比率返回 `null`，不会编造 `0%` 或 `100%`。

## 全工作区汇总（`buildLawyerDeskDashboard`）

- 遍历工作区下所有案件，计算每个案件的 `MatterHealthMetrics`。
- 按 `lastActivityAt` 倒序排列。
- 输出：
  - `totalPendingApprovals`：全工作区待拍板总数。
  - `totalOverdueTasks`：全工作区逾期任务总数。
  - `todayActivityCount`：今日（本地 0 点起）runtime 事件总数。
  - `thisWeekFirstPassCount`：近 7 天内 `firstPass === true` 的交付事件数。
