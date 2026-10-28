# 规则级 all-pass 夹具（合成）

这组夹具回答一个问题：**给定 12 条 playbook 规则中的某 6 条，一次规则级审查是否把每一条都判对了。**

它**不**回答"律师会不会用"、"合同写得好不好"。判对与否的口径，就是 `src/lawmind/skills/builtin/contract-playbook-review.md` 的三档描述。

## 诚实边界（先读这段）

- 这里是**合成夹具**：句子按规则原文措辞构造，缺陷也是显式植入的。它的价值是校验夹具格式、覆盖完整性与评分器接线，**不是模型质量的证据**。
- `pnpm lawmind:allpass` 默认**不调用任何模型**，输出 `SKIP`，不给准确率。
- `--arm oracle` 用期望值回放，只能证明"评分器能判对已知答案"，20/20 是自检通过的标志，不是产品指标。
- `--arm deepseek` 会真的调模型（走生产 `draft_worker` review 路径），但**分数仍只说明"流程能否驱动模型按规则结构判定"**；合成夹具上的分数不得作为真实合同准确性证据对外引用。
- 真实脱敏合同请放 `fixtures/lawmind-true-manuscript/`，两者不要混用。

## 结构

```
cases.json          # 索引：20 个用例 + 期望判定
README.md
```

`cases.json`：

```jsonc
{
  "schemaVersion": 1,
  "playbookId": "cn-sales-v0",
  "note": "合成夹具，仅校验接线",
  "cases": [
    {
      "caseId": "s01",
      "paper": "counterparty", // own | counterparty
      "title": "买卖合同·全项合规", // 可选
      "clauses": ["第一条 …", "…"], // 数组按行拼接成合同正文；≥200 字
      "expected": {
        "liability.cap.counterparty": "compliant",
        // 必须覆盖该纸别下全部 6 条规则，不多不少
      },
    },
  ],
}
```

`expected` 的取值只能是五态之一：`compliant` / `acceptable_deviation` / `unacceptable` / `absent` / `needs_human`。

## 覆盖要求（夹具会因此校验失败）

1. `expected` 必须**恰好**覆盖 `paper` 适用的规则：漏一条 → 夹具问题（会让 all-pass 变松）；多一条 → 夹具问题（会让 all-pass 不可能通过）。
2. 正文 ≥ 200 字；`caseId` 唯一；`paper` 合法。
3. 五态要有多样性。当前 20 例覆盖 `compliant` / `acceptable_deviation` / `unacceptable` / `absent`，没有 `needs_human`（需要真实歧义，合成夹具不假装能造出来）。

## 当前 20 例

| 组           | 用例    | 覆盖点                                                                   |
| ------------ | ------- | ------------------------------------------------------------------------ |
| 买卖合同     | s01–s12 | 全合规、六类单缺陷、双缺陷、两处可接受偏离、两处条款缺失、四处缺陷混合   |
| 技术保密协议 | n01–n08 | 全合规、保密/知识产权/责任/管辖/终止单缺陷、两处条款缺失、三处可接受偏离 |

## 命令

```bash
pnpm lawmind:allpass --validate      # 只校验夹具（CI 可用）
pnpm lawmind:allpass                 # 校验 + 诚实 SKIP（默认不跑模型）
pnpm lawmind:allpass --arm oracle    # 评分器自检：应 20/20
pnpm lawmind:allpass --workspace ./workspace   # 报告另存 lawmind/metrics/
LAWMIND_REQUIRE_ALLPASS=1 pnpm lawmind:allpass # nightly：非 pass 即非零退出

# 真实模型臂（需要 key）
export DEEPSEEK_API_KEY=sk-...
pnpm lawmind:allpass --arm deepseek --max-cases 2 --concurrency 3
pnpm lawmind:allpass --arm deepseek --model deepseek-reasoner --json
```

## 真实模型臂

`--arm deepseek` 走的是**生产 `draft_worker` review 路径**（`role: "review"` + `rule_id`），
不是另写一套 prompt。每条规则 → 一次 worker 调用 → `classification` → `scoreRuleAllPassCase`。

| 参数                   | 作用                           |
| ---------------------- | ------------------------------ |
| `--model <id>`         | 上游模型，默认 `deepseek-chat` |
| `--max-cases N`        | 只跑前 N 例（预算护栏）        |
| `--concurrency N`      | 并行规则数，默认 3             |
| `LAWMIND_ALLPASS_SEED` | 可复现种子（上游支持时才发）   |

行为约定：

- **无 key** → 明确报错 + 退出码 2，**不落 fail 报告**（配置缺失不是零分）。
- **鉴权/配置错**（401/403/unauthorized）→ 立刻停止，不烧完预算。
- **单规则超时** → 该规则记 missing，其余照常。
- 事后在 `--workspace` 目录会落 `allpass-report.json` / `.md`，含逐例漏判与错判明细。

## 还缺什么

模型臂已接线（上面那段）。仍然缺的是**真实合同上的证据**：

1. 律师提供脱敏真稿 → `fixtures/lawmind-true-manuscript/`；
2. 在真稿上跑同一套规则与评分，才有资格谈"真实准确性"；
3. 在此之前，合成夹具上的任何分数——无论 20/20 还是别的——都只说明接线正确。

另外缺 `needs_human` 类用例：它需要真实歧义，合成夹具造不出来，所以当前四态而不是五态。

---

## 实测记录（2026-10-23，deepseek-flash）—— 当前口径

判定路径：**每个 criterion 单独一次调用，只答 true/false**；档位由
`decideVerdict` 确定性映射。这是被证据选出来的形态，不是设计时的首选。

| 方案                                     | all-pass         | 采样不一致      |
| ---------------------------------------- | ---------------- | --------------- |
| 档位直选（模型自己选五档）               | 55%（11/20）     | 12%（14/120）   |
| 原子题**批量**作答（一次交 4–5 题 JSON） | 0%（0/6）        | 39–53%          |
| **原子题逐题作答 + 先问条款是否存在**    | **90%（18/20）** | **2%（3/120）** |

结论：**问题不在「选档」，在「批量作答」。** 同一批 criteria：

- 一次交 4–5 题 → 缺陷题全答 true，档位几乎全判 unacceptable（s01 全项合规样本上三条缺陷题全答 true）
- 每题单独问 → s01/s02 上 12/12 档位与期望一致

### 定位过程（可复现）

`scripts/lawmind/lawmind-polarity-probe.ts` 是这次取证用的探针，三个轴各一组对照：

| 对照                                           | 结果                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| 中性框架，正向题 vs 反向题（同一事实两种问法） | 矛盾 0/6                                                                          |
| 审查子工框架，同上                             | 矛盾 0/6（排除「找问题」角色导致偏 true）                                         |
| 生产 criteria 逐题单问                         | s01 答对 28/29；经 `decideVerdict` 还原 **12/12** 档位（s01 全合规 + s02 单缺陷） |

三轮都指向同一件事：模型读得懂极性，也读得懂我的题面；把 4–5 道题塞进一个
JSON 响应才塌陷。

```bash
# 复现（需要 DEEPSEEK_API_KEY）
node --import tsx scripts/lawmind/lawmind-polarity-probe.ts --cases s01 --trials 1
node --import tsx scripts/lawmind/lawmind-polarity-probe.ts --cases s01 --frame reviewer
node --import tsx scripts/lawmind/lawmind-polarity-probe.ts --cases s01,s02 --use-criteria
```

### 顺带修掉的三个真 bug

| Bug                           | 表现                                                           | 修法                                                                      |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `clausePresent` 硬编码为 true | `absent` 永远不可能成立；s10/s11/s12 被判成偏离而非缺失        | 每条规则先单独问一次「是否就此事作出约定」；答 false 直接短路，不再逐题问 |
| 报告取错 rationale            | 把 needs_human 的理由挂在 compliant 判定上，把诊断引向错误方向 | 只取「与多数票一致」的样本理由                                            |
| criterion 塞两个条件          | 「限于商业秘密，**并**明确排除已公开信息」无法二值回答         | 拆成单一条件（「限于商业秘密」本身已排除公开信息）                        |

另修一条规则设计缺陷：`one_sided_termination` 原措辞没有「且不承担任何补偿」，
导致「不对称但充分补偿」被误判为不可接受，吞掉了 acceptable 那一档。

### 仍然待办（诚实标注）

- **合成夹具，不能当法律能力证据。** 90% 只说明「管道与量规自洽」，真实准确性要
  律师提供脱敏真稿后另跑。
- **`needs_human` 类用例仍缺。** 需要真实歧义，合成夹具造不出。
- **成本**：逐题单问把调用数从 6 次/例 提到 ~29 次/例。20 例 × 3 采样 =
  1740 次调用、约 22 分钟。生产上若走这条路径，必须配缓存与并发预算。

---

## 实测记录（2026-10-22，deepseek-flash）

> **最新一轮（判定改为原子题作答）结果是反向的：0% all-pass、39–53% 采样不一致。**
> 原因不是架构，是 `deepseek-flash` 对否定型 yes-no 问题系统性答 true
> （s01 全项合规样本上三条缺陷题全答「存在」）。详见
> `docs/lawmind/LAWMIND-RULE-VERDICT-CONVERGENCE-PLAN.md` 的「实测结果」。
> 下面的 55% / 12% 来自**档位直选**那一版，不是当前代码。

这是**校准过程**，不是成绩单。每一次分数变化都对应一次规则/夹具修改，不能据此说模型变好或变差。

| 轮次 | 改动                                             | all-pass         | 关键观察                                                                               |
| ---- | ------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------- |
| 1    | 初始规则 + 夹具                                  | 15%（3/20）      | 21 次 `compliant → acceptable_deviation`：规则缺"合规充分条件"，模型按自己更严的标准判 |
| 2    | 规则加 `compliantWhen`；修悬空附件引用、缺失声明 | 45%（9/20）      | 责任上限、付款验收达 100%；`ip.data`/`confidentiality` 仍因条款不完整被降档            |
| 3    | 补数据用途、公知信息例外；补偿改为可判定         | 75%（15/20）     | 四条规则 100%                                                                          |
| 4    | prompt 加"判定顺序"                              | 50%（10/20）     | **反而更差**：acceptable 一档吸走了本该 compliant 的判定                               |
| 最终 | 判定顺序 + `--trials 3` 多数票                   | **55%（11/20）** | 4 条规则 100%；**12% 的规则三次采样不一致**                                            |

### 决定性发现：单次采样不可引用

同一份代码、同一模型、同一夹具，连跑两次：

```
run A: s01 通过；s02 错 1 条；s03 错 1 条
run B: s01 错 2 条；s02 错 2 条；s03 错 1 条
```

`deepseek-flash` 在 `temperature: 0` 下判定仍会翻转。所以：

- 单次 all-pass 数字**必须**当噪声，不得作为结论；
- `--trials N` 取多数票，平票取更保守一档，报告会列出所有 `stable: false` 的规则；
- 3 次采样下不一致率 **12%（14/120）**，这就是该模型在该口径下的稳定性上限。

### 仍然弱的两条

| 规则                         | 准确率 | 原因                                                                                                    |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `ip.data`                    | 65%    | 规则要求"数据使用限于合同目的"，与"未涉及数据交付视为满足"两条路径冲突，模型时判 absent 时判 acceptable |
| `confidentiality.noncompete` | 80%    | 三年/五年的期限边界、公知信息例外仍靠文字理解                                                           |

### 结论

**五态判定不该由模型直接给。** 四轮改 prompt 的结果是 15→45→75→50，来回摆动、不收敛。正确方向是让模型回答**可判定的子问题**（每个 `compliantWhen` 条目 yes/no + 证据句），五态由确定性代码映射。这也是 `compliantWhen` 这个字段真正的用途——不是喂给模型读，而是拆成判断题。

在做到那一步之前，这些数字只证明"管道通了"，不证明任何法律判断能力。

---

## 这不是 Benchmark（边界声明）

按 `GOALS.md` 铁律 4「先复用，后自研」，需要说清本目录的定位：

| 事实                                              | 含义                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 公司级评测资产是 **`../LawMind-Bench`**（独立仓） | 它已有六分册、`private/held-out`（24 题冻结集）、`ANTI-GAMING.md`、`JUDGE-PROTOCOL.md` |
| 本目录只有 6 条规则 × 26 份合成合同               | 规模、口径、裁判协议都不具备对外发版权威性                                             |
| 本目录的用例由工程撰写，非律师签字                | 与 bench 里 `authoredBy: engineering-draft` 同级，**不得升为 blocking**                |

因此：

- **`lawmind:allpass` 的分数不得对外引用、不得作为发版 headline。** 发版 headline 只认
  LawMind-Bench 的 `allPassRate`。
- 本目录的唯一用途是：在**引擎层**验证「规则能否被结构化表达、答案能否确定性映射、
  夹具本身是否自洽」。这是 `decideVerdict` / `verdict-oracle` / `fixture-integrity`
  的测试夹具，不是质量标尺。
- 真要回答「模型在合同审查上有多准」，走 LawMind-Bench，并把真稿放进
  `fixtures/lawmind-manuscript/`（`../LawMind-Bench` 与产品仓各自的路径）。
- 若未来 bench 已能覆盖同一口径，本目录应删除而不是继续扩张。
