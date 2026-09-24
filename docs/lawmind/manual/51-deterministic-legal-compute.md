# 第 51 章 实现精读：确定性法律计算与机械核对

这一章讲三类「**必须算对**」的模块：劳动与期限计算、诉讼费计算、条款解析与 lint。

它们和第 23 章的 `calculate` 工具是两层关系：`calculate` 是**调度器**，真正的算法在这些领域模块里。

## 51.1 为什么这些模块值得单独讲

因为这个产品里，**「模型会写」和「系统会算」必须分开**。

第 20 章讲过两份技能都把这条写成了硬要求：

```text
labor-compensation-calc：N/N+1/2N、加班、双倍工资按规则算并写出公式；必须调用 calculate，口算不算完成。
legal-period-calc：上诉、答辩、仲裁申请、再审、执行期间用规则引擎算届满日；不要口算。
```

第 21 章把这条落进了验收标准：

```text
labor.calc：金额必须带来源公式；缺流水标缺口，不得口算假数。
period.calc：届满日必须有公式；中断顺延标缺口。
```

**而这一章的模块，就是「公式从哪来」的答案。**

## 51.2 三个设计约束（贯穿全章）

看这些模块的代码，会发现同三条约束反复出现。

### 约束一：结果必须带公式

每个计算函数返回的不只是数字，还有 `formula` 字符串。

`EconomicCompensationResult` 的字段：`kind`、`nMonths`、`cappedWageYuan`、`amountYuan`、**`formula`**、**`notes`**。

`LegalPeriodResult`：`kind`、`start`、`expires`、**`formula`**、**`notes`**。

`ExactFee`：`kind`、`amountYuan`、**`formula`**、**`breakdown`**。

**为什么**：因为「律师能复核」是这类计算的价值前提。一个只给数字的结果，律师没法判断对错，只能选择信或不信。

### 约束二：参数必须带出处与生效日

`statute-params.ts` 的每一行都是这个形状：

```ts
{
  id, value, unit: "ratio" | "years" | "months" | "rate" | "periods",
  effectiveFrom: "2021-01-01",
  source: "民法典第586条",
  noteZh: "...",
}
```

而且这份表有版本号：`STATUTE_PARAMS_VERSION = 3`。

**为什么要 `effectiveFrom` 和 `source`**：法条参数会变（比如民间借贷利率上限定过好几次）。**一个不带生效日的参数表，两年后会变成错的而且没人知道。**

### 约束三：算不动就写缺口，不猜

`PRIVATE_LENDING_LPR_MULTIPLE` 的 `noteZh` 里有一句很典型的话：

```text
利率上限为合同成立时一年期贷款市场报价利率的四倍（LPR 序列待补）
```

**「LPR 序列待补」**——参数表里有这个规则，但具体数值序列没接。所以引擎知道规则，但**不知道当期数字**，这一条要律师提供（`calculate-lib.ts` 的头部注释写明了「LPR / 牌价 must be supplied by the lawyer — never invented」）。

## 51.3 劳动：三块计算

### 经济补偿（N / N+1 / 2N）

`labor/economic-compensation.ts`，核心是一个小函数：

```ts
export function compensationMonthsFromYears(yearsOfService: number): number {
  if (!Number.isFinite(yearsOfService) || yearsOfService <= 0) return 0;
  const whole = Math.floor(yearsOfService);
  const frac = yearsOfService - whole;
  if (frac < 0.5) {
    return whole + (frac > 0 ? 0.5 : 0);
  }
  return whole + 1;
}
```

读一下它的规则：

| 工作年限 | 月数                  |
| -------- | --------------------- |
| 3.0 年   | 3                     |
| 3.2 年   | 3.5（不满半年按半年） |
| 3.5 年   | 4（满半年按一年）     |
| 3.7 年   | 4                     |
| 0.3 年   | 0.5                   |
| 0 或负数 | 0                     |

**注意 `frac > 0 ? 0.5 : 0` 这个细节**：如果正好是 3.0 年，返回 3 而不是 3.5。整数年不能多算半个月。

然后是三条叠加规则：

| 规则     | 条件                  | 效果                           |
| -------- | --------------------- | ------------------------------ |
| 三倍封顶 | 月工资 > 当地社平 × 3 | 按三倍计，**且年限最高 12 年** |
| 代通知金 | `kind === "N+1"`      | 加 1 个月                      |
| 违法解除 | `kind === "2N"`       | 月数 × 2                       |

**「封顶同时触发年限封顶」这个联动容易漏**——代码里是一起做的（`cappedWage = avg * 3; nMonths = Math.min(nMonths, 12);`），而且往 `notes` 里写了一句说明：「月工资高于当地社平三倍：按三倍计，年限最高十二年。」

公式字符串也按类型分三种写法：

```text
N+1  → "20000 × (3 + 1)"
2N   → "20000 × 3 × 2"
N    → "20000 × 3"
```

**注意 `N+1` 的写法**：`(3 + 1)` 而不是 `4`。因为它要表达「3 个月补偿 + 1 个月代通知金」这个结构——**公式是给律师看的，不是给计算器看的。**

### 加班费

`labor/overtime-pay.ts`，三种倍率：

| 类型                | 倍率 | 注释里的提醒                         |
| ------------------- | ---- | ------------------------------------ |
| `weekday`           | 1.5  | —                                    |
| `rest_day`          | 2    | 「已依法安排补休的，不要再叠加班费」 |
| `statutory_holiday` | 3    | 「不因补休免除」                     |

时薪的口径写在文件头：「月工资 ÷ 21.75 ÷ 8 unless overridden」。21.75 是月计薪天数，`workdaysPerMonth` 参数可以覆盖。

**两条 `notes`**：休息日和法定节假日对「补休」的处理**不一样**——休息日补休了就不给加班费，法定节假日补休也照给。这是实践中常被搞混的地方，代码把它写进了备注。

### 法定期限（六种）

`labor/legal-period.ts`，`LEGAL_PERIOD_KINDS` 六种：

| kind                      | 场景               |
| ------------------------- | ------------------ |
| `civil_appeal`            | 民事上诉期         |
| `civil_answer`            | 民事答辩期         |
| `labor_award_sue`         | 劳动仲裁裁决起诉期 |
| `labor_arbitration_apply` | 劳动仲裁申请期     |
| `civil_retrial`           | 民事再审申请期     |
| `execution`               | 申请执行期         |

返回 `{ kind, start, expires, formula, notes }`。

配套两个日期工具：`addCalendarDays`、`addCalendarMonths`。**「日历月」与「天」是两回事**——「三个月内」不是「90 天」，所以需要 `addCalendarMonths`。

## 51.4 诉讼费：一张带版本的费率表

`litigation/litigation-fee.ts` 是这一章最值得细看的一个，因为它的做法可以推广。

### 先声明来源

```ts
export const LITIGATION_FEE_SOURCE = "诉讼费用交纳办法（国务院令第481号）";
export const LITIGATION_FEE_EFFECTIVE_FROM = "2007-04-01";
export const LITIGATION_FEE_VERSION = 1;
```

**三件事一起声明：依据什么、什么时候生效、这份表第几版。**

### 财产案件受理费：十档

`PROPERTY_ACCEPTANCE_TIERS` 每一档都带 `note`（原文照抄，可以直接给律师看）：

| 区间上限（元）   | 费率    | 说明                                      |
| ---------------- | ------- | ----------------------------------------- |
| 10,000           | 定额 50 | 不超过 1 万元的，每件交纳 50 元           |
| 100,000          | 2.5%    | 超过 1 万元至 10 万元的部分，按 2.5%      |
| 200,000          | 2%      | 超过 10 万元至 20 万元的部分，按 2%       |
| 500,000          | 1.5%    | 超过 20 万元至 50 万元的部分，按 1.5%     |
| 1,000,000        | 1%      | 超过 50 万元至 100 万元的部分，按 1%      |
| 2,000,000        | 0.9%    | 超过 100 万元至 200 万元的部分，按 0.9%   |
| 5,000,000        | 0.8%    | 超过 200 万元至 500 万元的部分，按 0.8%   |
| 10,000,000       | 0.7%    | 超过 500 万元至 1000 万元的部分，按 0.7%  |
| 20,000,000       | 0.6%    | 超过 1000 万元至 2000 万元的部分，按 0.6% |
| `null`（无上限） | 0.5%    | 超过 2000 万元的部分，按 0.5%             |

**「超额累进」的分档表有个通用结构**：每档是「上限 + 该档费率」，最后一份上限是 `null`。这样遍历时只要「找到金额落在哪一档，然后逐档累加」——不会有边界遗漏。

### 保全费：三段 + 封顶

四个常量：

| 常量                     | 值     | 含义             |
| ------------------------ | ------ | ---------------- |
| `PRESERVATION_FLAT_YUAN` | 30     | 1 千元以下的定额 |
| `PRESERVATION_RATE_MID`  | 0.01   | 1 千–10 万部分   |
| `PRESERVATION_RATE_HIGH` | 0.005  | 超 10 万部分     |
| `PRESERVATION_MID_YUAN`  | 100000 | 中段分界         |
| `PRESERVATION_CAP_YUAN`  | 5000   | **上限**         |

公式是**分两段写的**（不是简单套分档）：

```text
≤1000        → "30 元（≤1000 元或不涉及财产数额）"
1000–100000  → "(金额 − 1000) × 1% = X 元"
>100000      → "(100000 − 1000) × 1% + (金额 − 100000) × 0.5% = X 元"
```

超过上限时**在公式后面追加一句**：

```text
；超过上限，按 5000 元计
```

**这个「追加一句说明」的做法很好**：律师看到的是「按公式算是 X，但受上限约束按 5000 计」，而不是一个 5000 让人怀疑是不是算错了。

### 执行费：五档

`EXECUTION_TIERS` 五档（50 元定额、1.5%、1%、0.5%、0.1%），以及一个破产案件上限常量 `BANKRUPTCY_FEE_CAP_YUAN = 300000`。

### 减半：两条，都带出处

`applyAcceptanceReductions` 处理两种减半，返回 `FeeReduction[]`：

| 情形           | 出处                             |
| -------------- | -------------------------------- |
| 调解结案或撤诉 | 「诉讼费用交纳办法」**第十五条** |
| 适用简易程序   | 「诉讼费用交纳办法」**第十六条** |

每条都带 `reason`、`source`、`amountYuan`、`originalYuan`。

**注意它返回的是数组而不是一个结果**：因为两种减半可能同时适用（简易程序 + 调解结案），那时应该有两条记录，而不是一个被覆盖的值。

### 金额解析

`litigation/claim-amount.ts` 有 `parseChineseAmount` / `parseClaimAmount`——从自由文本里解析标的额。

**为什么需要它**：标的额在诉讼材料里经常写成「约 200 万元」「人民币壹佰万元整」这种形式，而不是纯数字。所以有一个专门的解析器。

## 51.5 条款解析：`clause/`

`clause/` 有一套独立的小体系，目标是**把合同解析成结构，而不是正则扫**。

### 五个文件的分工

| 文件         | 职责                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `ast.ts`     | 数据结构：`Clause`、`ClauseDoc`、`Reference`、`SourceRange`，加上 JSON 序列化                                                     |
| `pattern.ts` | 模式引擎：`ClausePattern`、`ClauseTrigger`、`matchesTrigger`、`extractCaptureBody`                                                |
| `dsl.ts`     | 用来看得懂的方式定义模式：`defineClause`、`definitions`、`obligations`、`rights`、`liability`、`dispute`、`defaultClausePatterns` |
| `extract.ts` | `extractClauses(docText, patterns?)`                                                                                              |
| `lint.ts`    | `runClauseLint` → 转成 `LegalLintFinding`                                                                                         |

**`ClauseType` 是封闭集合**：`definition`、`obligation`、`right`、`liability`、`dispute`、`general`（从 `CLAUSE_TYPES` 看）。

**为什么要有 AST 而不是直接正则匹配**：因为「这条是定义条款还是义务条款」需要上下文。有了 AST，模式可以引用「先找到的定义」。

### 共享的关键词表

`clause-type-keywords.ts` 导出 `CLAUSE_TYPE_KEYWORDS`、`detectClauseTypeKeyword`、`clauseTypeMentionedIn`、`FORUM_MENTION_RE`。

文件存在的理由是**修一次不一致**（第 6 章提过的那条注释）：早先 `stance/self-check.ts`、`habit-extract`、`stance/capture` 各有一份条款关键词表，互相不一致。现在都从这一个文件取。

**这是一条通用的工程教训**：同一套判断标准出现在三个地方，早晚会漂。收成一处之后，三处自动一致。

### 一个已知的误报（写在 README 里）

`clause/README.md` 明确记了一个问题：**`clause.dispute_missing` 有已知误报**——同一行里写争议解决条款时，会被先分类成义务条款。

因为这个问题，这套 clause lint **没有被接进 `guardian/machine-verifiers.ts`**（也就是没进硬门禁）。

**这个处理方式值得学**：新能力有已知误报时，先不接到硬门禁上，而是在 README 里写明「为什么暂不接」。这比「接了但大家开始忽略它的告警」要好。

## 51.6 机械核对：`lint/`

`lint/` 是「机械一致性核对」。有两句话定义了它的定位：

**第一句**（来自 `LAWMIND-ARCHITECTURE.md`）：lint 是 **advisory**（建议性）——**通过 ≠ 法律正确**。

**第二句**（来自验收标准）：机械 blocker 会翻 `ok: false` 并收窄重试。

所以它有双重身份：**有些规则只是提醒，有些是硬拦**。

### 规则的组织

| 文件                       | 规则数 | 管什么                                 |
| -------------------------- | ------ | -------------------------------------- |
| `general.ts`               | 12     | 通用规则（`GENERAL_EXTRA_LINT_RULES`） |
| `families/sale.ts`         | 8      | 买卖                                   |
| `families/loan.ts`         | 8      | 借款                                   |
| `families/lease.ts`        | 9      | 租赁                                   |
| `families/employment.ts`   | 10     | 劳动/用工                              |
| `families/equity.ts`       | 8      | 股权                                   |
| `families/construction.ts` | 9      | 建设工程                               |
| `citation-validity.ts`     | 3      | 引用有效性                             |

**六个族各有自己的 `*FamilyApplies` 判定**（`saleFamilyApplies` 等），加上 `family-gate.ts` 的 `familyDeliverableMatches`——**先判断「这份文书属不属于这个族」，再跑该族的规则**。

**为什么分族**：买卖合同里「没写验收标准」是问题，但同样的规则套到离婚协议上就是噪音。分族能让规则只在合适的场景生效。

### 法条参数表（`statute-params.ts`）

第 51.2 节讲了它的形状。十条具体参数（下面列主要的）：

| id                                | 值    | 依据                 |
| --------------------------------- | ----- | -------------------- |
| `deposit.cap`                     | 0.2   | 民法典第 586 条      |
| `limitation.ordinary`             | 3 年  | 民法典第 188 条      |
| `private_lending.lpr_multiple`    | 4 倍  | 民间借贷规定第 25 条 |
| `lease.term_max_years`            | 20 年 | 民法典第 705 条      |
| `employment.probation_max_months` | 6 月  | 劳动合同法第 19 条   |
| `employment.noncompete_max_years` | 2 年  | 劳动合同法第 24 条   |

还有三个建设工程的保修期参数（屋面、机电、供暖）。

**`unit` 有五种**：`ratio`、`years`、`months`、`rate`、`periods`。单位显式化是为了让规则能通用地比较（「合同写了 25 年租期」vs「上限 20 年」）。

### 定金比例是单独一个坑

`rules.ts` 里有两个专门的东西：`DepositPercentHit`、`findDepositPercents`。

**为什么要单独处理百分比**：合同里写「定金 30%」这种表述，要先算出「30% 是多少」再和 20% 的上限比。而且中文数字（「三成」「百分之三十」）也要能识别——所以有 `chinese-numeral.ts`（`parseChineseInteger`、`parseChineseDecimal`、`formatChineseInteger`）。

### 引用有效性（3 条规则）

`citation-validity.ts` 的 `lintCitationValidity` 配一个正则：

```text
/《([^》]{1,40})》\s*第\s*([0-9一二三四五六七八九十百]+)\s*条/g
```

它抓出文书里所有的「《法名》第 X 条」，然后交给 `live-citation-hits.ts` 的 `fetchLiveCitationHits` 去查真源（第 10 章的检索层）。

**这是「引用可回溯」在 lint 层的落点**：不是看格式对不对，而是**看这条引用能不能查到**。查不到就报——这正是「不编条号」的机械保障。

### 自修订（`self-revise.ts`）

导出 `previewSelfRevise`、`runSelfRevise`、`applySelfReviseToDraft`、`classifyResidual`、`SelfReviseProposal` / `SelfReviseResult` / `SelfReviseApplied`。

**流程是「提案 → 应用」两段**（和 `workspace-file-ops` 的「解算 → 应用」同一模式）。而且 `classifyResidual` 处理「改不掉的残余」——**改不掉的要被分类记录，而不是无声丢弃**。

### 导出前门禁（`export-lint-gate.ts`）

`runExportLintGate` / `runExportLintGateForDraft` / `deliverableNeedsExportLint`。

**不是所有交付物都要过这个门**——`deliverableNeedsExportLint` 说了哪些要。这是「高风险才硬拦」的落地。

## 51.7 四条可推广的做法

这章的模块里有四条做法，放到别的项目也好用。

### 做法一：算法返回值带公式和输入

不是 `{ amount: 45000 }`，而是 `{ amount, formula: "15000 × 3", notes: [...] }`。

**收益**：律师能复核；测试能断言公式；审计留痕里有可读依据。

### 做法二：参数表带 `source` + `effectiveFrom` + 版本号

法条会改。**参数表的价值取决于它能不能被正确地淘汰**——没有生效日和出处的表，改的时候不知道改哪一行，不改的时候不知道错在哪。

### 做法三：分档用统一结构

十档受理费、五档执行费、两段保全费都用一个 `FeeTier` 结构（上限 + 费率 + 定额 + 说明）。**统一结构让「加一档」变成加一行，而不是改一段逻辑。**

### 做法四：有已知误报的能力先别硬拦

`clause.dispute_missing` 有误报 → 不接进硬门禁，在 README 写明原因。这比「接了然后大家学会忽略告警」理性得多。

## 51.8 已知坑（本章相关）

- **`calculate` 是调度器，算法在领域模块。** 找算法别在工具层找。
- **LPR / 牌价必须律师提供。** 参数表里有规则但没有当期数值（注释写着「LPR 序列待补」）。
- **三倍封顶与 12 年上限是联动的**，改一处要改另一处。
- **`N+1` 的公式写成 `(n + 1)` 而不是 `n+1` 的结果**，这是有意为之。
- **休息日补休可免加班费，法定节假日补休不免。** 这条在 `notes` 里。
- **「日历月」与「天」不同。** 用 `addCalendarMonths`。
- **诉讼费表带版本号与生效日。** 改费率要抬 `LITIGATION_FEE_VERSION`。
- **减半返回数组**（两种减半可能同时适用）。
- **保全费超过上限时在公式后追加说明**，不是直接换个数字。
- **定金比例要处理中文数字。**
- **`clause/lint` 有已知误报，未接硬门禁。** 别以为接上就能用。
- **条款关键词表已收成一处**（`clause-type-keywords.ts`），别在别处再写一份。
- **lint 是 advisory，通过 ≠ 法律正确。** 但部分规则会翻 `ok: false`——两者要分清。
- **引用有效性靠查真源，不是格式检查。**
