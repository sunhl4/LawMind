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
