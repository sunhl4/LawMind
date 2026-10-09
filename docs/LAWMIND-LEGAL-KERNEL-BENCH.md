# 律师向因子内核评测

工程复测手册。不是律师界面。夹具分数不是官方榜，也不是真稿胜利。官方全量在文末，那是零样本直调，不是交件回合。无律师脱敏真稿时，六类缺陷不得写成已在真实交件上解决。

对照：[docs/LAWMIND-FORWARD-AGENT.md](./LAWMIND-FORWARD-AGENT.md) §9.3 / §9.6 / §9.7；影子回放分层见 [src/lawmind/evaluation/README.md](../src/lawmind/evaluation/README.md)。

## 分层（以后复测先认层）

| 层              | 跑什么                                                                                                                                                          | 模型                      | 能证明什么                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 内核套件        | `factor-state*.test.ts`、行业夹具与消融、`skeleton-tree.test.ts`、`factor-conformal.test.ts`、`offline-diagonal-simulator.test.ts`、`retrieval-amplify.test.ts` | 无                        | 指针基、1-hop、金额 exact match、span 包含、§9.3 消融、骨架树、保形门、离线三方对照（相位不进产品）、检索乘性加权 |
| 真循环 cassette | `turn-orchestrator-cassettes.test.ts`                                                                                                                           | 假 JSON/SSE，真 `runTurn` | 下一轮请求体、工具表、零写入                                                                                      |
| 影子回放        | `src/lawmind/evaluation/`                                                                                                                                       | 脚本或真模型              | 交件 lint 召回；与编排准入分开                                                                                    |
| 真稿 / 人类基准 | `fixtures/lawmind-true-manuscript/`                                                                                                                             | 真模型                    | 无夹具则诚实 SKIP，不假绿                                                                                         |

编排、并行、门禁改动必须补 cassette（AGENTS.md）。不断言「系统提示里还有某句中文」。

## 外部标准（协议 + 链接，不拷语料）

只吸收**题型与口径**。夹具是自撰中文劳动合同 / 买卖 / 保密 / 许可片段。禁止粘贴 CUAD、MAUD、ContractNLI 的合同原文。

真循环外部切片（语料在 `tmp/`，不进 git）：

- Harvey LAB 英文两题 + 交件/账本改动冲突表：[docs/LAWMIND-HARVEY-LAB-SLICE.md](./LAWMIND-HARVEY-LAB-SLICE.md)
- PLawBench 中国法 9 题切片（案例分析 / 诉状 / 追问）：[docs/LAWMIND-PLAWBENCH-SLICE.md](./LAWMIND-PLAWBENCH-SLICE.md)

中国法律 Agent 公开集调研与自建资产（**独立仓库**，与本仓平级）：

- 产品仓指针：[docs/LAWMIND-CHINESE-LEGAL-AGENT-BENCHMARKS.md](./LAWMIND-CHINESE-LEGAL-AGENT-BENCHMARKS.md)
- **LawMind Bench** 真相源：本机常见路径 `../LawMind-Bench/`（发版闸门与金标在彼仓，不嵌本仓）

- **LegalBench / CUAD**：<https://github.com/HazyResearch/legalbench> 、任务表 <https://hazyresearch.stanford.edu/legalbench/tasks/> 。Hendrycks et al. 2021。官方 41 类全在 [src/lawmind/agent/cuad-official-clauses.ts](../src/lawmind/agent/cuad-official-clauses.ts)。Yes/No 仅在有回应 span 时为 Yes；日期答案为 `mm/dd/yyyy`；同一组可以共一段。这里的夹具是自撰中文，不是 EDGAR 的 510 份合同。510 份的零样本结果在文末。
- **LawBench**：<https://github.com/open-compass/LawBench> 。Fei et al. 2024。20 个任务号都用论文里的指标（accuracy、multi-label F1、rc-F1、soft-F1、ROUGE-L、normalized log-distance、F0.5），见 [src/lawmind/agent/legal-bench-metrics.ts](../src/lawmind/agent/legal-bench-metrics.ts)。夹具不是 20×500 官方集。官方集的零样本结果在文末。
- **ContractNLI**：Koreeda & Manning 2021。三向：蕴含 / 矛盾 / 未提及。矛盾 → 【待核实】，禁止 argmax。
- **MAUD**：Wang et al. 2023。成对成交条件保持混合，不取一边。
- **SARA numeric / 劳动合同法第47条月数**：走 `calculateLegal`（[src/lawmind/agent/tools/legal/calculate-lib.ts](../src/lawmind/agent/tools/legal/calculate-lib.ts)），金标不得手填与公式不一致的数。LawBench 3-7 的指标是 accuracy，用同一套 exact match。

协议单测：[src/lawmind/agent/factor-state-legal-industry.test.ts](../src/lawmind/agent/factor-state-legal-industry.test.ts)。§9.3 五类错误消融（同一套夹具，对照压缩后只重注提示词）：[src/lawmind/agent/factor-state-legal-industry-ablation.test.ts](../src/lawmind/agent/factor-state-legal-industry-ablation.test.ts)。表达轨（判断句、两种路径、万元写法、子工任务是否被锁）：[src/lawmind/agent/factor-state-legal-industry-express.test.ts](../src/lawmind/agent/factor-state-legal-industry-express.test.ts)。夹具模块：[src/lawmind/agent/factor-state-legal-industry-fixtures.ts](../src/lawmind/agent/factor-state-legal-industry-fixtures.ts)。1-hop 长程边误差：`hopTruncation`，劳动合同夹具上 2-hop 法条计入 `mechanicalDropped`，无路径的管辖计入 `isolated`（不扩子工边际）。骨架语法树：`src/lawmind/agent/skeleton-tree.ts`（`bindSkeletonSlot` / `lastPassedSkeleton`）。保形门：`src/lawmind/agent/factor-conformal.ts`；活路径 `projectReading` 仍用 γ，校准分够时 `projectReadingGated` 才写确定句。§9.5 离线三方对照：`src/lawmind/evaluation/offline-diagonal-simulator.ts`，不进 `runTurn`；相位未达预先写明的 Brier 幅度，不进产品。

## 怎么加题

条款标签：

```ts
{ label: "termination_for_convenience", anchor: "clause:解除", outcome: "提前三十日书面通知解除", excerpt: "……提前三十日书面通知解除……", absent: "本合同自双方盖章之日起生效。" }
```

- `outcome` 必须是 `excerpt` 的子串（CUAD span containment）。读法 id 用中文，避免「拉丁 id + 四个汉字」误接地。
- `absent` 调用 `spanAttestsOutcome(absent, outcome)` 必须为 false。
- 金额：先 `calculateLegal(...)`，再 `ingestToolResult(state, "calculate", result)`。错数只记 conflict，核定金额留下。
- 触及 `runTurn` / 工具表：在 [src/lawmind/agent/turn-orchestrator-cassettes.test.ts](../src/lawmind/agent/turn-orchestrator-cassettes.test.ts) 补 cassette，断言下一轮请求体，不把【机械核定】写进律师气泡。

## 怎么跑

```bash
pnpm exec vitest run \
  src/lawmind/agent/factor-state-legal-industry.test.ts \
  src/lawmind/agent/factor-state-legal-industry-ablation.test.ts \
  src/lawmind/agent/factor-state-legal-industry-express.test.ts \
  src/lawmind/agent/legal-bench-metrics.test.ts \
  src/lawmind/agent/factor-state-official-protocol.test.ts \
  src/lawmind/agent/factor-state.test.ts \
  src/lawmind/agent/factor-state-ablation.test.ts \
  src/lawmind/agent/factor-state-taskset-ablation.test.ts \
  src/lawmind/agent/factor-state-capability.test.ts \
  src/lawmind/agent/factor-state-lawyer-suite.test.ts \
  src/lawmind/agent/skeleton-tree.test.ts \
  src/lawmind/agent/ooxml-skeleton.test.ts \
  src/lawmind/agent/factor-conformal.test.ts \
  src/lawmind/evaluation/offline-diagonal-simulator.test.ts \
  src/lawmind/retrieval/retrieval-amplify.test.ts \
  src/lawmind/retrieval/authority-hits.test.ts \
  src/lawmind/agent/draft-worker.test.ts \
  src/lawmind/agent/draft-worker-batch.test.ts \
  src/lawmind/agent/turn-orchestrator-cassettes.test.ts \
  src/lawmind/agent/tools/legal/calculate-lib.test.ts
```

律师向约五百项机械门在 `factor-state-lawyer-suite.test.ts`：判断句必须保留。本文件与 lawyer-suite 不得混称胜利。

## 官方全量（2026-10-07）

模型是桌面里已配置的 `deepseek-flash`，温度 0。零样本对话，一次一条用户消息。关闭了 thinking：打开时补全预算写进 `reasoning_content`，`content` 为空，官方脚本会把空串当成弃答。LawBench 题面要求直接作答。这不是 `runTurn`，因子态、保形门和骨架都没有参与。语料不进 git。

20 个任务分的无权重平均是 0.606。指标不同，这个平均数不是榜上的单一能力分。

### LawBench zero_shot，20×500

评分脚本是仓库里的官方 `evaluation/main.py`。每题 500 条，预测都非空。2-1 用官方 ChERRANT，指标是 F0.5。2-6 的官方返回键写成了 `anstention_rate`，CSV 的弃答列因此是 0；下表弃答用的是脚本打印的 0.914。

| 任务 | 内容         | 指标                    |  分数 |  弃答 |
| ---- | ------------ | ----------------------- | ----: | ----: |
| 1-1  | 法条记忆问答 | ROUGE-L                 | 0.614 |     0 |
| 1-2  | 知识问答选择 | accuracy                | 0.872 | 0.002 |
| 2-1  | 文书校对     | F0.5                    | 0.337 |     0 |
| 2-2  | 争议焦点     | accuracy                | 0.490 |     0 |
| 2-3  | 多标签分类   | F1                      | 0.732 |     0 |
| 2-4  | 咨询分类     | accuracy                | 0.446 |     0 |
| 2-5  | 阅读理解     | rc-F1                   | 0.741 |     0 |
| 2-6  | 信息抽取     | F1                      | 0.058 | 0.914 |
| 2-7  | 舆情摘要     | ROUGE-L                 | 0.362 |     0 |
| 2-8  | 论点对       | accuracy                | 0.606 |     0 |
| 2-9  | 事件检测     | F1                      | 0.761 | 0.002 |
| 2-10 | 触发词       | F1                      | 0.629 |     0 |
| 3-1  | 法条预测     | F1                      | 0.841 | 0.008 |
| 3-2  | 情景法条     | ROUGE-L                 | 0.362 |     0 |
| 3-3  | 罪名         | F1                      | 0.628 | 0.174 |
| 3-4  | 刑期         | normalized log-distance | 0.882 | 0.014 |
| 3-5  | 刑期         | normalized log-distance | 0.894 | 0.002 |
| 3-6  | 案例分析选择 | accuracy                | 0.774 |     0 |
| 3-7  | 犯罪金额     | accuracy                | 0.934 |     0 |
| 3-8  | 法律咨询     | ROUGE-L                 | 0.159 |     0 |

读这几行时看长度，不把低分写成模型没说话：

- 2-6 的解析器只认 `类型:` 或 `类型：`。有金标实体的题里，91.4% 解析不出实体。预测中位长度 200 字，金标 54 字，是散文对不上格式。
- 2-7 摘要中位 50 字，金标 125 字，写短了。
- 3-8 中位 1777 字，金标 392 字。题面要求先回答再给法律依据，ROUGE-L 被多出来的文字拉低。
- 3-3 的 0.174 弃答是预测里没有出现评分表里的罪名。

### CUAD v1，EDGAR 510 份

来源是 Atticus CUAD v1（CC BY 4.0）的 SQuAD JSON：510 份合同、41 类、20910 题。合同全文作上下文。超过 9 万字的合同按 9 万字窗口、4000 字重叠切开，同一类取合同里更靠前的那段原文。每窗一次请求，带上全部 41 道官方问题，要求逐字抄完整的回应句，没有则空字符串。这不是 Hendrycks 论文里的滑动窗口抽取模型，也不是 AUPR。生成式没有校准概率，所以报 SQuAD v2 的 exact match 和 token F1，外加「有没有这段条款」的 precision / recall。

510 份全部返回，没有请求失败。

|                                 | exact match | token F1 |
| ------------------------------- | ----------: | -------: |
| 全部 20910 题                   |       0.724 |    0.809 |
| 有答案的 6702 题                |       0.300 |    0.567 |
| 无答案的 14208 题（空预测算对） |       0.923 |    0.923 |

条款是否存在：precision 0.842，recall 0.862，F1 0.852。总 F1 被大量「正确地回答没有」抬高，发布时要同时看有答案的 0.567。

| 类别                               | exact | token F1 | 存在 precision | 存在 recall | 存在 F1 |
| ---------------------------------- | ----: | -------: | -------------: | ----------: | ------: |
| Affiliate License-Licensee         | 0.898 |    0.908 |          0.808 |       0.356 |   0.494 |
| Affiliate License-Licensor         | 0.959 |    0.964 |          0.857 |       0.261 |   0.400 |
| Agreement Date                     | 0.076 |    0.263 |          0.961 |       0.949 |   0.955 |
| Anti-Assignment                    | 0.461 |    0.786 |          0.956 |       0.989 |   0.972 |
| Audit Rights                       | 0.653 |    0.813 |          0.931 |       0.939 |   0.935 |
| Cap On Liability                   | 0.606 |    0.763 |          0.975 |       0.705 |   0.819 |
| Change Of Control                  | 0.755 |    0.829 |          0.756 |       0.818 |   0.786 |
| Competitive Restriction Exception  | 0.757 |    0.799 |          0.481 |       0.842 |   0.612 |
| Covenant Not To Sue                | 0.831 |    0.861 |          0.915 |       0.430 |   0.585 |
| Document Name                      | 0.594 |    0.744 |          1.000 |       0.998 |   0.999 |
| Effective Date                     | 0.314 |    0.457 |          0.910 |       0.959 |   0.934 |
| Exclusivity                        | 0.590 |    0.715 |          0.694 |       0.956 |   0.804 |
| Expiration Date                    | 0.655 |    0.781 |          0.967 |       0.792 |   0.871 |
| Governing Law                      | 0.627 |    0.909 |          0.989 |       1.000 |   0.994 |
| Insurance                          | 0.735 |    0.886 |          0.958 |       0.964 |   0.961 |
| Ip Ownership Assignment            | 0.663 |    0.754 |          0.633 |       0.919 |   0.750 |
| Irrevocable Or Perpetual License   | 0.898 |    0.947 |          0.909 |       0.857 |   0.882 |
| Joint Ip Ownership                 | 0.927 |    0.961 |          0.894 |       0.913 |   0.903 |
| License Grant                      | 0.631 |    0.841 |          0.950 |       0.961 |   0.955 |
| Liquidated Damages                 | 0.875 |    0.917 |          0.738 |       0.787 |   0.762 |
| Minimum Commitment                 | 0.727 |    0.787 |          0.906 |       0.527 |   0.667 |
| Most Favored Nation                | 0.953 |    0.963 |          0.824 |       0.500 |   0.622 |
| No-Solicit Of Customers            | 0.929 |    0.954 |          0.758 |       0.735 |   0.746 |
| No-Solicit Of Employees            | 0.916 |    0.967 |          0.892 |       0.983 |   0.935 |
| Non-Compete                        | 0.747 |    0.838 |          0.740 |       0.790 |   0.764 |
| Non-Disparagement                  | 0.910 |    0.927 |          0.622 |       0.605 |   0.613 |
| Non-Transferable License           | 0.769 |    0.858 |          0.838 |       0.826 |   0.832 |
| Notice Period To Terminate Renewal | 0.867 |    0.907 |          0.741 |       0.982 |   0.845 |
| Parties                            | 0.002 |    0.211 |          1.000 |       1.000 |   1.000 |
| Post-Termination Services          | 0.333 |    0.452 |          0.474 |       0.918 |   0.625 |
| Price Restrictions                 | 0.845 |    0.852 |          0.118 |       0.600 |   0.198 |
| Renewal Term                       | 0.767 |    0.841 |          0.749 |       0.983 |   0.850 |
| Revenue/Profit Sharing             | 0.688 |    0.788 |          0.882 |       0.723 |   0.795 |
| Rofr/Rofo/Rofn                     | 0.875 |    0.913 |          0.968 |       0.718 |   0.824 |
| Source Code Escrow                 | 0.976 |    0.986 |          1.000 |       0.846 |   0.917 |
| Termination For Convenience        | 0.733 |    0.831 |          0.788 |       0.913 |   0.846 |
| Third Party Beneficiary            | 0.712 |    0.731 |          0.181 |       0.875 |   0.299 |
| Uncapped Liability                 | 0.749 |    0.764 |          0.439 |       0.162 |   0.237 |
| Unlimited/All-You-Can-Eat-License  | 0.969 |    0.976 |          1.000 |       0.353 |   0.522 |
| Volume Restriction                 | 0.827 |    0.829 |          0.429 |       0.073 |   0.125 |
| Warranty Duration                  | 0.873 |    0.899 |          0.774 |       0.640 |   0.701 |

上表是「全部 41 类都抄完整句子」。名称、双方、日期、管辖、续期和保证期的金标是短 span，所以 Parties 的 exact match 是 0.002、Agreement Date 的 token F1 是 0.263，但「有没有这段」仍在 0.95 以上。

readme 的口径是这九类只抄片段、其余类抄整句。这一轮 510 份也全部返回。总 exact match 0.736，token F1 0.807。有答案的 6702 题 exact match 0.306、token F1 0.529。无答案拒答 0.938。条款是否存在：precision 0.858，recall 0.788，F1 0.822。短答案里 Document Name 的 token F1 升到 0.943，Agreement Date 升到 0.734，Effective Date 升到 0.758。Parties 的存在 F1 仍是 1.000，token F1 只有 0.309。Expiration Date 的存在 recall 从 0.792 掉到 0.269。价格限制、数量限制、无限责任、附属许可的存在 recall 也更低。

对照用同一套 LawBench 官方脚本、同一 0–100 刻度。来源是 [DeepSeek 系列在 LawBench 上的公开结果](https://huggingface.co/datasets/WNJXYK/LawBench_Results)：DeepSeek-V3 平均 55.64，DeepSeek-R1 平均 58.57。本机 `deepseek-flash` 平均 60.6。落后的是 2-6（5.8，R1 为 31.72）、2-10（62.9，R1 为 72.27）、3-8（15.9，V3 为 23.34）。
