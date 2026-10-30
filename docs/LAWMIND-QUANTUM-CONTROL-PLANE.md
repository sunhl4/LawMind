# LawMind 量子启发控制平面（v2）

> 2026-10-27 写入。本文只谈引擎侧，不改律师界面，不引入量子硬件、厂商云或线路模拟器，不声称任何加速。
> 科学边界仍以 [`LAWMIND-FORWARD-AGENT.md`](./LAWMIND-FORWARD-AGENT.md) §9 为准；本文是 §9 之后「怎么把这条轨道做厚」的工程方案。
> 律师说明仍看 [`量子启发.md`](./量子启发.md)；本文写给设计者与工程师。

---

## 0. 结论先行

现有系统的真实价值，不是「量子」这个词，而是一套**经典错误校正控制平面**：

- 状态在引擎侧：锚、读数、来源 span、可逆补丁；
- 模型只提议，引擎只对账；
- 下一轮采样前重画读数，错前提不进入下一轮；
- 机械项用确定性检查，法律判断仍归模型。

这条线今天已经能跑，但只跑到「账本 + 采样前缀清洗」。三个最贵的缺口是：

1. **相关证据被当成独立证据。** 两份子工引用同一段原文、同一个模型回合、同一份检索结果时，`productMerge` 仍按乘积融合，置信被虚高。量子信息里这是不可克隆 / 一夫一妻问题；经典侧就是「同一来源根只能算一次」。
2. **没有译码器。** 红灯亮了，现在按类别套替换规则：金额红灯修金额，引用红灯修引用。它丢掉了「两盏红灯是否由同一处笔误造成」这条最值钱的信息。
3. **没有测量调度。** 单句措辞就能翻红灯；同一读数在连续几轮、经由互不相交通道重复出现时，反而没有累积机制。结果是误报和过度 hedging 同时存在。

下一层不靠再加量子名词，靠三件普通计算机上的结构：

- **来源根 + 决策距离**：只对互不相交的来源根做乘积；胜出读法独有的来源根数量，才是「码距」的经典对应物。
- **最小权重综合征译码**：给定一组红灯，找一组总权重最小、能解释全部红灯且不弄绿变红的故障；同价不选边。
- **序贯证据滤波 + 测量预算**：弱读数按轮累积、按通道去重、按时间衰减；只在预期信息增益高于成本时才测。

这三件已落成纯函数模块，并把来源根接进了 `productMerge`；译码器和滤波器先只读，等第三批消融通过后再接修复回路。2026-10-27 续：P0 观测闭环（会话/案件账本、观察总线、修正记录、保形校准、指标）已经落地。2026-10-28 续：P1 首片「金额同回合修复」已落地，默认关闭；默认开启的只有机械核定里的同源错数分组。细节见 §6.4、§6.5。

---

## 1. 现状审计：什么是真的，什么是孤儿

### 1.1 在活路径上的

| 机制           | 落点                                                                                     | 今天实际做什么                                                     |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 回合因子态     | `src/lawmind/agent/turn-orchestrator.ts` 的 `beginTurnFactors` / `ingestMaterialAmounts` | 每轮重建临时金额、保留跨轮锚                                       |
| 工具结果入账   | `src/lawmind/agent/turn-orchestrator-tool-round.ts` 的 `ingestToolResult`                | 金额、引用、定义、修订码、骨架写入因子                             |
| 采样前重画读数 | `src/lawmind/agent/session.ts` 的 `renderEngineReadings`                                 | 每轮把【引擎核定】重新画到采样尾部                                 |
| 采样前缀清洗   | `session.ts` 的 `projectAssistantProseForSampling` / `projectToolResultForSampling`      | 错金额、假权威不进入下一轮前缀；律师历史保留原句                   |
| 提案冲突       | `factor-state.ts` 的 `fuseProposal`                                                      | 模型写的读数与账本不一致时记 `proposalId` + `conflict`，不覆盖账本 |
| 共享锚融合     | `fuseSharedAnchorLines`                                                                  | 子工同锚结论按 id 合并；不同 id 写【待核实】                       |
| 1-hop 约化     | `marginalFactors` / `composeWorkerSystem`                                                | 子工只拿命中锚及其邻居；`hopTruncation` 只测量、不拦               |
| 检索放大       | `retrieval-amplify.ts`                                                                   | 对角分数上的乘法重排；注释明写不是量子搜索                         |

### 1.2 孤儿模块：只有单测，没有生产调用者

| 模块                                                   | 现状                                                           | 影响                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| `src/lawmind/agent/factor-witness.ts`                  | 无生产引用                                                     | 记性抽查没有进入压缩 / 工具轮                              |
| `src/lawmind/agent/definition-relations.ts`            | 无生产引用                                                     | 定义环、金额拆分、日期先后只停留在单测                     |
| `src/lawmind/agent/review-observations.ts`             | 无生产引用                                                     | 审稿意见没有走账本同一条入账通道                           |
| `src/lawmind/agent/correction-ledger.ts`               | 无生产引用                                                     | 律师说「不对」没有结构化落库，校准数据断供                 |
| `src/lawmind/agent/factor-conformal.ts`                | 被 `factor-state.ts` 引用，但 `conformalScores` 没有生产填充者 | 保形门实际上处于休眠；`setConformalCalibration` 无生产调用 |
| `src/lawmind/evaluation/offline-diagonal-simulator.ts` | 只有单测                                                       | 符合 §9.5 的离线定位，不应进回合                           |

### 1.3 三个容易误判的程序事实

1. **纯度门槛今天几乎不参与判定。** 活路径上大多数因子只有一个 `mass: 1` 的 grounded 读数，\(\gamma=1\)；真正起作用的是 `grounded` 与 `proposalId` 的冲突标记。纯度主要在使用子工融合、出现两个 outcome 时才起作用。不要把 \(\gamma\ge0.75\) 写成「已校准的置信度」。
2. **没有真正的综合征修复回路。** `applyProseSyndrome` 今天恒返回 `none`；`turn-loop-state.ts` 的 `prose_syndrome` 分支注释写明「今天不可达」。系统做的是**记录 + 附注 + 采样前缀清洗**，不是「红灯 → 重采样 → 复查」闭环。
3. **保形门是休眠的。** `projectReadingGated` 只有在 `conformalScores.length >= 8` 时才启用；活路径没有写入者。它现在是一条准备好的旁路，不是已生效的保证。

---

## 2. 四个真问题

### 2.1 相关证据被当成独立证据

`productMerge` 的默认语义是「两侧独立，逐点相乘」。但独立不是由「来自两个子工」保证的：

- 两个子工用同一个模型、同一段父对话、同一份检索结果，错误高度相关；
- 同一段原文被两个子工引用，仍然只有一份物证；
- 同一个模型回合写出的两句互相印证，不是两条独立证据。

把相关证据相乘，会得到虚高的纯度和虚高的「已核实」。这比不做融合更危险，因为它把「一个错误」包装成「两个独立来源都同意」。

### 2.2 没有译码器

今天的修复是「按 kind 套规则」：

- 金额红灯 → 重写金额槽；
- 引用红灯 → 重标引用；
- 定义红灯 → 标【待核实】。

当两盏红灯同时亮时，系统会做两次独立修复，而不是先问「这两盏灯是不是同一处笔误造成的」。这会增加 token、增加改写面，也容易把一处根因修成两处表面症状。

### 2.3 没有测量调度

- 单句措辞就能触发 `fuseProposal` 的冲突标记；
- 没有「同一读数连续几轮一致才升级」的迟滞；
- 没有「这次检查值不值得做」的成本判断；
- 没有按模型、按锚类型自适应的门槛。

结果是两个方向同时出错：该报的持续错误没有累积，不该报的单句波动被放大。

### 2.4 状态仍然是会话级，不是案件级

因子态活在 `AgentSession` 上；压缩、重开、跨轮、跨子工都靠重画和重注。它没有一张**案件级、可版本化、可撤回**的证据账本。长任务一旦跨会话，红灯谱系、译码结果、律师修正史都留不下来，校准数据也无从积累。

---

## 3. 哪些量子概念值得借，哪些不值得

| 量子概念            | 经典对应物                       | 进产品？       | 可测的主张                 |
| ------------------- | -------------------------------- | -------------- | -------------------------- |
| 对角密度矩阵        | 锚上读数的概率分布               | 是             | 纯度、熵、混合态比例       |
| 稳定子 / 综合征     | 确定性不变量谓词                 | 是             | 误报率、召回率             |
| 译码器              | 最小权重集合覆盖 / 最小解释      | 是（新增）     | 根因命中率、每次修复 token |
| 码距                | 胜出读法独有的独立来源根数       | 是（新增）     | 决策距离分布               |
| 不可克隆 / 一夫一妻 | 来源根去重；共享根不做决定性证据 | 是（新增）     | 同源重复带来的置信增量 = 0 |
| 部分迹              | 子工边际 / 约化状态              | 是             | 丢弃质量、1-hop 误差       |
| 弱测量              | 贝叶斯滤波 / 序贯概率比检验      | 是（新增）     | 误报密度、漏报率           |
| 测量基选择          | 多样化 witness 探针              | 是（只读起步） | 每次探针的信息增益         |
| 量子 Zeno           | 反复问同一个问题会锁死当前读法   | 设计原则       | 探针基多样性               |
| 振幅放大            | 检索重排                         | 仅启发式       | 不承诺平方加速             |
| 相位 / 相干         | 带符号证据？                     | 产品路径否     | 只允许离线预注册实验       |
| 张量网络            | 压缩 / 推断                      | 仅离线         | 键维 vs 误差               |
| 向量符号架构        | 绑定 / 叠加的记忆代数            | 实验           | 恢复保真度                 |
| 量子硬件            | —                                | 否             | —                          |

**一句话**：对角态上仍然成立的结构，才借；需要相位、硬件或未校准的复数振幅，就不借。量子语言的价值是逼出「态在哪、何时测量、谁来判定冲突」这三个问题，不是提供新算子。

---

## 4. 目标架构：四层控制平面

### 4.1 第一层：证据代数

每个锚的每个读数带四样东西：

- `id`：读法本身；
- `weight`：支持强度（先验或校准后的对数几率）；
- `grounded`：是否有独立 span / 工具结果；
- `channels`：来源根。根相同即同一份证据。

规则：

- 同一读法内同根只算一次；
- 跨读法共享的根不做决定性证据；
- 只对互不相交的根做乘积；
- **决策距离** = 胜出读法独有的根数。距离 1 表示一份证据错了结论就翻；距离 2 才谈得上冗余。

代码：`src/lawmind/agent/evidence-provenance.ts`。`productMerge` 在双方都带来源根时走这条路径；否则退回旧行为，避免把「没登记来源」误当独立证据。

### 4.2 第二层：综合征与译码器

稳定子仍然是确定性谓词，但增加两样：

- **支持集**：这条检查触到哪些锚；
- **故障模型**：哪些故障能解释它、会弄红哪些其他检查、先验权重多少。

译码器做三件事：

1. 从红灯生成候选故障（`buildFaultCandidates`）；
2. 搜索总权重最小、覆盖全部红灯、不碰绿项的故障集合（`decodeSyndrome`）；
3. 唯一解 → 只重做 `repairAnchors`、复查 `recheck`；同价 → `ambiguous`，不选边；无解 → `uncorrectable`，保留【待核实】。

跨轮再加一层：`persistentSyndrome` 只保留最近 `window` 轮中出现至少 `minRounds` 轮的红灯，单句 blip 不触发修复。

代码：`src/lawmind/agent/syndrome-decoder.ts`，只读观察器在 `syndrome-observer.ts`。

### 4.3 第三层：测量控制

- **弱测量滤波**：每个锚维护一组对数几率；每次读数贡献一个 LLR；按轮衰减；按通道去重；只有第一名超过 `upper`、领先第二名超过 `margin`、且独立通道数足够时才判确定。
- **探针基多样性**：同一个问题反复问会锁死当前读法（Zeno 类比）。witness 应轮换三类探针：
  - 值探针：只报已核数值；
  - 出处探针：只报 span / 条号；
  - 反事实探针：问「如果账本没有这个数，你会怎么写」。
- **测量预算**：只在预期降低的判定风险高于 token / 延迟成本时测量；模型变强、错误率下降后，门槛自动放宽，检查频次自动下降。

代码：`src/lawmind/agent/evidence-filter.ts`。witness 的探针生成已在 `factor-witness.ts`，下一步是把回答作为弱读数喂进滤波器，而不是一次性判 pass/drift。

### 4.4 第四层：组合与上下文

- **部分迹**：子工只拿任务锚的边际；`hopTruncation` 报告被丢掉的长程边和被丢掉的机械槽。丢弃质量不是零成本，要如实报告。子工结果带 `marginal` 计数（`seen` / `mechanical` / `longRange` / `isolated`），父会话据此区分「子工没看到」和「材料没有」；`isolated` 不点名。
- **边际边界**：`composeSubagentPrompt` 单点组装边际与边界，测试与生产读同一份提示。边界按证据强度分级：机械长程项优先、最近优先，名字预算 24；连通的语义长程项随后；零证据锚不点名、不计数；种子未落到因子态时不输出边界块。边界只给名字不给读数；任务需要时先核实再用，核实不到写缺口，不能把「未提供」写成「不存在」。子工可用只读工具 `read_marginal_anchor` 按名取回边际或已命名边界锚的读数，范围外与零证据锚拒绝，读数不进入初始提示。
- **不可克隆**：同一模型回合、同一份检索结果、同一段原文，只能算一个来源根；跨子工共享根不做独立证据。
- **压缩通道**：压缩只能丢信息，不能造证据，也不能消解冲突。用保真度指标（锚保留、冲突保留、判断保留）量它，而不是信任摘要。
- **干涉合并**：同一锚上独立支持相乘；支撑不相交写冲突；父模型不兼任冲突裁判。
- **案件级账本**：因子态、红灯谱系、译码结果、修正记录写入案件级存储；采样读的是投影，不是历史本身。

---

## 5. 调研：2025–2026 的研究采位

> 这里只写「他们做了什么、我们取哪一块、归入哪批测试」。不把论文当产品承诺。

### 5.1 译码器与「模型提议、校验处置」

- **LLM-Assisted LDPC Decoding via Syndrome-Verified Semantic Priors**（arXiv:2608.14280，2026-08）。LLM 提出字符纠正，但解码器只接受通过奇偶校验的更正，并以软先验注入，不直接改写码字。模拟显示 2.0 dB 下相对常规解码器降低 73% 的误码率；即使 LLM 预测不准确，注入精度仍高于 0.88。取用：我们的译码器也应只接受能解释综合征、且不弄绿变红的故障；模型提议只能作为候选，不能作为判决；被接受的更正应以软权重进入，而不是直接覆盖原文。
- **Securing quantum error correction against misleading advice from AI agents**（arXiv:2609.19090，2026-09）。被动综合征历史本身有歧义；需要额外校准测量和独立评估器，才能接受恢复更新；在模拟建议攻击中，校准置信检查能拒绝有害建议、保留有益更新。另一个结果同样重要：在相同观测下，确定性控制器取得至少同样多的有益更新。取用：译码器权重必须用修正史校准；同价解释不选边；不要让模型直接驱动译码器；优先确定性控制器。
- **Quantum-Inspired Trace-Augmented Evidence Selection for Reasoning over Structured Hypothesis Spaces**（arXiv:2606.06941，2026-06）。EP-HUBO 用小型本地模型生成多条 CoT，按假设解析证据池，用质量权重（相关性、具体性、区分度）解高阶二元优化，再交给前沿模型做一次裁决；在经典模拟退火和 Dirac-3 光子机上评估。取用：译码目标应是「最小权重解释 + 证据支持」，不是多数投票；光子机只是实验平台，不构成产品优势。
- **Calibrated Trust, Not Sharper Prediction**（arXiv:2608.14617，2026-07）。完整结论比「没有提升」更有用：(1) 在 1000 个 ECtHR 案件上，证据图 + 置信传播 + 序贯贝叶斯 + Dempster-Shafer + 保形预测的融合，判别力（AUROC 约 0.83）没有超过原始 LLM；(2) 朴素融合会把 ECE 从约 0.16 推到 0.46；(3) Dempster-Shafer 在长链上会自信地错，建议移除；(4) 真正的价值在操作层：去掉 D-S、重新校准、加类条件风险控制后，保形选择性预测层自动放行部分的准确率 96.8%、逃逸错误 0.5%，对比未调优基线的 85.9% / 3.8%。取用：不要用融合宣称更准；把保形层用于「哪些自动放行、哪些升级给人」，并且先做校准。

### 5.2 因子图与多智能体聚合

- **From Talking Words to Sharing Thoughts**（arXiv:2606.00405，2026-05）。用二部因子图做多 LLM 聚合，变量节点是模型，检查节点看一致性；指出 naive aggregation 会有 anchor corruption，弱模型的噪声会污染最强专家。取用：共享锚融合要有独立性和权重，不能把「多一个模型」当成「多一条独立证据」。
- **Verification Independence**（SSRN，2026，已在 `量子启发.md` 引用）。独立性分框定、证据、机制、权限四个维度；换一个模型不算机制独立。取用：审稿探针必须带原文证据、独立执行、无权放行；来源根要记录机制，不只记录模型名。

### 5.3 上下文漂移与压缩

- **DISCO: Distributed Long Context Scaling with Grounding-Reasoning Disaggregation**（arXiv:2609.33485，2026-09）。把 grounding 拆给一组 worker LLM，driver 只做计划与综合；在 RULER-QA 1M 上保持 78.4%，LongBench v2 最高提升 9.8 分，推理成本降低 80% 以上。取用：子工约化是同一方向；我们的 1-hop 边际要明确「带走什么、丢掉什么」，不能只做摘要预算。
- **Diagnosing and Mitigating Context Rot in Long-horizon Search**（arXiv:2606.29718，2026-06）。长上下文下模型会提前放弃或给出不确定的错答，失败早于窗口耗尽。取用：证据流要分三类记录——没检索到、检索到但被截断、送到了但没用；不能用「模型不够认真」一言蔽之。
- **CTXAgent: Self-Controlled Context Management of LLM Agents**（arXiv:2610.34425，2026-10）。在相同条件下比较七个前沿模型自管上下文；多数强模型能定期压缩和整理，混合会话的 live context 多数低于 100k tokens，分数基本不降；Claude Opus 5.5 下自管 harness 与 Claude Code 任务成功率相当，成本低 34%–49%。取用：压缩要被测量，不是被信任；强模型可以自管，但成本因模型而异，引擎侧仍要保留可回源档案和冲突不被消解的约束。
- **Adaptive Retrieval, Selective Answers: Evaluating Conformal Factuality in Agentic RAG**（arXiv:2610.34872，2026-10）。把 claim-level 保形事实性放到 agentic RAG 里评估。取用：门应落在 claim / 锚级别，不是整篇文档级别；保形门需要真实校准集，不能拍脑袋。
- **TrAC: Trace-Conditioned Answer Consistency**（arXiv:2608.00422，2026-08）。用多条推理轨迹的一致性做不确定性量化。取用：跨轨迹一致性是弱信号，不是真理；可以进滤波器，不能单独当证据。

### 5.4 模型变强与「纠错内化」

- **Fault-tolerant foundation models**（arXiv:2610.10311，2026-10）。在模拟故障硬件上训练，模型会学会在「好的纠错码」内计算，规模越大越耐受。取用：模型越强，引擎的检查应越少、越便宜；这与我们第四节的「自适应放宽」一致，也说明不要把固定门槛写成永久税。
- **Entanglement as Memory: Mechanistic Interpretability of Quantum Language Models**（arXiv:2603.26494，2026-03）。单量子比特语言模型可被经典精确模拟，并收敛到经典策略。取用：支持 §9.7 的结论——几个量子比特的内核不会带来产品优势，不要把资源投到小比特内核。
- **KARIPAP: Quantum-Inspired Tensor Network Compression of LLMs**（arXiv:2510.21844，2025-10）。用 iPEPS / TRG 压缩模型权重，和 agent 状态压缩不是一回事。取用：不要混淆「权重压缩」与「证据状态压缩」；后者只做离线对照。
- **Q-Interference: Phase-Aware Quantum-Inspired Attention**（arXiv:2608.17288，2026-08）。给注意力加学习相位。取用：这是模型结构，不是 agent 控制层；不进入本轨道。
- **Density-Matrix Reinforcement Learning**（arXiv:2610.17214，2026-10）。用密度矩阵存策略，非对角项编码动作相关性。取用：说明「相干项可以是有用的经典数据结构」，但那是策略相关性，不是法律证据；只做离线实验，不进产品。

### 5.5 向量符号架构与记忆

- **Holographic Invariant Storage**（arXiv:2603.13558，2026-03）。用双极 VSA 做上下文漂移的设计期安全契约，给出单信号恢复保真度、连续噪声鲁棒性、多信号容量退化的闭式界。取用：如果要试 VSA 记忆，必须先用这些界做容量预算，不能把「叠加」当无限容量。
- **Attention as Binding**（arXiv:2512.14709，2025-12）。把注意力 / 残差流解释成近似 VSA，解释变量混淆和逻辑相关提示不一致。取用：绑定 / 解绑是诊断视角，不是替代模型的方案；可作为锚-角色表示的理论参照。

---

## 6. 本轮已落地

### 6.1 新模块

| 文件                                         | 作用                                                                        | 状态                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lawmind/agent/evidence-provenance.ts`   | 来源根、共享根、独立性融合、决策距离                                        | 已接入 `productMerge`；双方都带 channels 时生效                    |
| `src/lawmind/agent/syndrome-decoder.ts`      | 故障候选、最小权重译码、跨轮持续综合征                                      | 纯函数 + 单测；`persistentSyndrome` 已接观察总线，修复回路仍未接   |
| `src/lawmind/agent/evidence-filter.ts`       | 序贯对数几率、衰减、通道去重、确定/混合/冲突判定                            | 纯函数 + 单测；已接模型提案迟滞与 witness 弱读数（值/出处/反事实） |
| `src/lawmind/agent/syndrome-observer.ts`     | 从现有因子账本读红灯并译码                                                  | 只读观察器，不改状态                                               |
| `src/lawmind/agent/witness-measurement.ts`   | witness 回答进弱滤波；回合末主动抽查（默认关闭）                            | 被动已接；主动由 `LAWMIND_FACTOR_WITNESS=1` 开启                   |
| `src/lawmind/agent/factor-state.ts`          | `FactorOutcome.channels`、`recordReading` 可选来源、`productMerge` 溯源分支 | 向后兼容；无 channels 时走旧路径                                   |
| `src/lawmind/adapters/factor-ledger/`        | 会话/案件级 JSONL 账本，schema 校验，坏行跳过                               | 已落地；有 matterId 写案件账本                                     |
| `src/lawmind/agent/observation-bus.ts`       | 统一观察落盘，失败吞掉                                                      | 已接 correction / syndrome / summary                               |
| `src/lawmind/agent/conformal-calibration.ts` | 从修正史构建校准分数，门只在有区分度时启用                                  | 已落地；数据不足时保持关闭                                         |
| `src/lawmind/agent/factor-metrics.ts`        | 修正、综合征、witness 抽查、回合汇总的只读聚合                              | 已落地；内部摘要                                                   |

### 6.2 已接线的部分

- `fuseSharedAnchorLines` 现在给每条能 attest 的 worker span 附一个 `spanChannel`。同一段原文被两个 outcome id 引用时，共享根被排除，结果是【待核实】，而不是让其中一侧靠重复引用变得确定。
- 材料金额、`calculate`、检索来源、`xml_qa`、`draft_worker` 的入账也开始带来源根（material / tool / span）。这些根今天不改变读数本身，但让后续融合有「同一份证据」可查，而不是只能按模型名猜独立性。
- `productMerge` 在双方都带来源根时走 `fuseProvenancedOutcomes`；否则保持旧的乘积逻辑，避免把未登记来源的读数误判为独立证据。
- `persistentSyndrome` 已接回合观察：`AgentTurn.syndromeHistory` 每轮更新，只有同一红灯在最近 3 轮中至少 2 轮出现、且持续集合发生变化时才写 `syndrome` 记录；记录同时带 `transient` 位和 `round`。单轮 blip 不再进账本，回合 summary 仍统计全部红灯。
- `evidence-filter` 已接模型提案迟滞：`fuseProposal` 以 `model` 通道记一次弱读数；当前回合仍显示冲突，跨回合后单通道提案不再进入引擎读数，第二个独立通道确认才保留。历史错值仍由采样投影清洗，不重新进入上下文。
- `witness-measurement.ts` 把 witness 回答接进弱滤波：每个锚记录 `obeyed` / `invented` 对数几率，通道按值 / 出处 / 反事实分开；同一通道重复答对不增加独立通道，两个不同基一致才判稳定。主动抽查只在 `LAWMIND_FACTOR_WITNESS=1` 时于回合收口前问一次（reviewModel、无工具、1024 token 上限），只写观察，不改正文或判定。

### 6.3 明确没有做的部分

- 没有把译码器接进 `applyProseSyndrome` 的修复回路；
- 没有用滤波器升级或降级读数；它只决定模型提案是否仍作为当前冲突显示，witness 也只写观察。
- 没有新增律师可见界面或设置。

这样安排是为了遵守本仓库的门禁：先有可测的只读结构，再有消融，最后才动生成回路。

### 6.4 P0 观测闭环已落地（2026-10-27 续）

- **账本**：`src/lawmind/adapters/factor-ledger/` 提供 `appendFactorLedgerRecord` / `readFactorLedgerRecords`。有 `matterId` 写 `matters/<id>/factor-ledger.jsonl`，否则写 `sessions/<id>.factor-ledger.jsonl`；坏行读取时跳过。
- **观察总线**：`src/lawmind/agent/observation-bus.ts` 统一落盘 correction / syndrome / witness / relation / review / summary。任何写盘失败都被吞掉，观察不能打断回合。
- **观察生产接线**：`observation-builders.ts` 只读校验 witness 回答、审稿观察和定义别名关系；工具结果入账后由 `turn-orchestrator-tool-round.ts` 写入对应观察记录。`draft_worker` 的结构化 `reviewObservations` 会透传到父回合。
- **账本清理**：`cleanupFactorLedger` 只由运维/CLI 显式调用，按记录数、字节数或显式年龄清理；追加和清理共用文件锁，保留最新有效记录。
- **修正记录**：`correction-ledger.ts` 新增 `readings`（修正前读数、纯度、grounded、决策距离）与 `fileEditsReverted`，并保存译码器选择的 `faultKinds`；`turn-orchestrator.ts` 在「不对」分支写一条 correction 记录。`kept` 只表示「没有被撤回」，不是正确标签。
- **回合汇总**：`turn-orchestrator-finalize.ts` 在回合收口时写 summary 记录（因子数、确定/混合、红灯数、决策距离数组），不含律师正文。
- **保形校准**：`conformal-calibration.ts` 从 correction 记录的读数快照构建校准行；只有行数 ≥8 且有区分度时才写入 `conformalScores`。全为「双源、纯度 1」的读数会被判为 `uninformative`，门保持关闭。已启用的分数随会话持久化；重新校准的清理/刷新策略还没做。
- **指标**：`factor-metrics.ts` 聚合修正、综合征、回合汇总三类记录，输出内部摘要；不把警告数当质量。
- **准入 cassette**：`turn-orchestrator-cassettes.test.ts` 覆盖修正回合写 correction + summary、工具结果写 witness/relation/review 观察、以及金额修复的 fault kind 进入 correction 记录；下一轮请求体不含账本路径。

P0 观测生产接线和账本显式清理已完成；剩余风险是 witness 目前只消费显式 `witnessAnswers` 工具数据，relation 只消费已有 typed alias 边，review 只消费带锚/span 的结构化观察，不会从自由文本猜测。

### 6.5 P1 首片：金额同回合修复（默认关闭）

- **计划器**：`src/lawmind/agent/prose-repair.ts` 只处理「账本有工具核定金额、模型在最终回复里写了另一个数」。它用 `buildFaultCandidates` + `decodeSyndrome` 找唯一解；同一错数出现在两个金额槽时，用 proposal 级相关故障归成一个根因，只重做这些槽。
- **开关**：`LAWMIND_FACTOR_REPAIR=1` 时 `turn-loop-policies.ts` 的 prose-syndrome 策略返回一次 `resample`；默认关闭。关闭时仍执行 `applyProseSyndrome`，所以采样前缀清洗、判断保留、提案入账不受影响。
- **上限**：`advanceRepair` 复用 `MAX_FACTOR_REPAIRS=2`；打满后停止反弹，按 `deliver` 写【待核实】。
- **不做**：引用冲突交给 same-turn citation gate；没有工具读数的「未核实」金额不反弹；账本本身是 mixed（没有唯一已核值）时不反弹；旧冲突不在当前回复里出现时不反弹；Word 改稿轮不反弹。
- **默认开启的小片**：`appendMechanicalNote` 在同一错数出现在两个以上金额槽时加一行「【同一处错数】…」。它不改正文、不改判断，只把「一次改两处」说清楚。
- **观察**：策略在反弹/封顶时写一条 `repair` 记录（动作、锚、说明）；`factor-metrics` 统计反弹/封顶次数，供消融比较。
- **准入**：cassette 覆盖「calculate → 错金额 → 一次反弹 → 交付 88000」；`LAWMIND_FACTOR_REPAIR` 默认关闭，现有 D1 cassette 继续验证「错数进不了下一轮前缀」。

---

## 7. 路线图与验收

### P0 · 先把观测闭环补上（1–2 周）· 已落地

1. **案件级账本**：把 `FactorState`、红灯谱系、译码报告、修正记录持久化到案件目录；采样只读投影。→ `adapters/factor-ledger/`，有 matterId 时写案件账本，否则写会话账本。
2. **观测总线**：witness、关系核对、审稿观察、修正记录统一进一条只读通道；每条记录带锚、带来源、带轮次。→ 已接 correction / syndrome / summary / witness / relation / review；witness/review 只接受结构化、带锚的输入。
3. **校准数据**：把律师「不对」的修正记录落成带锚、带修回结果的记录；`reason` 先留空，禁止关键词自动分类。→ `correction-ledger.ts` 新增读数快照、`faultKinds` 与 `fileEditsReverted`。
4. **保形校准**：从修正记录累计 `conformalScores`，达到 `MIN_CONFORMAL_CALIBRATION` 后才启用 `projectReadingGated`；未达到时如实标注「未校准」。→ `conformal-calibration.ts` 已实现；无区分度数据时门保持关闭。
5. **指标**：红灯谱系覆盖率、同源重复率、证据距离分布、【待核实】误报密度、过度 hedging 率。→ `factor-metrics.ts` 已量红灯数、译码结果分布、决策距离分布与修正结果；`pnpm lawmind:factor-ledger` 是只读出口。误报密度、hedging 率、同源重复率仍缺律师侧采样或来源根统计。

验收：没有足够校准数据时不改变律师可见行为；门一旦启用，按校准规则改变确定/混合判定。若记录本身让延迟或 token 明显上升，先降采样。

P0 剩余：账本保留期与清理策略已完成；witness/relation/review 的深入语义生产仍保持结构化输入边界，后续再接弱测量滤波与真实任务评测。

### P1 · 译码器（2–3 周）· 首片已落地

1. 把 `syndrome-observer` 的报告接到事件日志；→ 已接 `factor-ledger` 的 syndrome 观察；独立的 `events.jsonl` 出口仍可另接。
2. 用修正史校准 `FaultWeightTable`；→ 已保存 `faultKinds` 到 correction calibration rows，但还未按故障类型分层估计权重。
3. 在 `applyProseSyndrome` 后面加一个**默认关闭**的译码修复分支：唯一解才重做，同价/无解只标混合；→ 已实现 `prose-repair.ts`，由 `LAWMIND_FACTOR_REPAIR=1` 开启；默认关闭。cassette 覆盖「错金额 → 一次反弹 → 交付核定数」。
4. 对照臂：现状按类别修复 vs 译码器修复；→ 待跑真实任务集。
5. 指标：根因命中率、一次修复成功率、每次修复 token、二次修正率。

默认开启的一小片：`appendMechanicalNote` 现在会在同一错数出现在两个以上金额槽时加一行「【同一处错数】…」；它不改正文、不改判断，只提示律师一次改两处。单槽冲突不增加这一行。

验收：译码器在根因命中率或 token 成本上优于按类别修复，且不增加律师可见误报；否则只保留为诊断。金额同回合修复在真实任务集上未过这条之前，保持 `LAWMIND_FACTOR_REPAIR` 默认关闭。

### P2 · 弱测量与测量预算（3–4 周）

1. 每个锚维护 `EvidenceFilterState`；模型句子、witness 回答、工具结果分别以不同 LLR 进入；→ 模型提案与 witness（值/出处/反事实）通道已接，工具结果仍走强证据、不进弱滤波。
2. `persistentSyndrome` 过滤单轮 blip；→ 已接回合观察总线，账本同时保留瞬态位。
3. witness 探针按值 / 出处 / 反事实三类轮换；→ 已接 `buildWitnessProbes` 的通道轮换，主动抽查每回合最多一次。
4. 用预期信息增益 / 成本决定是否探测；→ 首片：只在「有已核金额/引用、正文没用到」时探一次，默认关闭；按成本排序的完整预算表未做。
5. 指标：误报密度下降、漏报不升、每次修复 token 下降、过度 hedging 不升。→ witness 的通过/偏离、稳定遵守/稳定编造、通道数已进 `factor-metrics`；其余四项仍需真实任务集。

验收：在固定任务集上，弱测量臂比现状少误报且不漏报；若只是把警告变少但真实缺源被隐瞒，判失败。

### P3 · 组合与上下文（3–4 周）

1. 子工边际按任务锚的互信息选，而不是只看 hop 距离；
2. `hopTruncation` 的丢弃质量进入报告；→ 已接 `draft_worker` 结果的 `marginal` 计数，续跑保留。
3. 压缩保真度：锚保留、冲突保留、判断保留；
4. 所有子工融合走来源根；同一模型回合、同一检索结果只算一次；
5. 指标：压缩后锚召回、冲突不消解率、长程红灯归因命中率。

验收：压缩后「错前提进入下一轮」的比例下降；长程边丢弃造成的错误可量化；不以摘要更像为成功。

### P4 · 离线研究（不排产品期）

1. 相位 / 相干实验：沿用 `offline-diagonal-simulator.ts`，预注册胜出幅度；未胜出就继续禁止；
2. 张量网络：对长程证据图做 MPS / 精确推断对照，量键维与误差；
3. VSA 记忆：先用 `Holographic Invariant Storage` 的容量界做预算，再决定是否试；
4. 密度矩阵策略：只做离线对照，不进交件回合。

---

## 8. 指标与否证门

### 8.1 消融臂

| 臂  | 内容                             |
| --- | -------------------------------- |
| A   | 裸模型 + 最简循环，不接账本      |
| B   | 现状账本（S1–S4 + 采样前缀清洗） |
| C   | B + 来源根 / 决策距离            |
| D   | B + 译码器                       |
| E   | B + 弱测量滤波                   |
| F   | 全组合                           |

### 8.2 指标

- 五类机械错误存活率：引用不在来源包、金额与计算器不符、定义/称谓漂移、修订轨空或整句替换、没证据写成事实；
- 无依据的确定句比例；
- 【待核实】误报密度（每千字 / 每份交件）；
- 过度 hedging 率：已核事实被标成待核实的比例；
- 译码根因命中率、一次修复成功率、每次修复 token；
- 持续红灯事件数 / 瞬态红灯位数（`syndrome` 记录的 `bits` 与 `transient`）；
- 陈旧提案数（单通道模型提案，跨回合不再进入引擎读数）；
- witness 抽查：通过 / 偏离、主动探针数、反事实探针数、稳定遵守 / 稳定编造（两基一致）、独立通道数；
- 压缩后锚召回、冲突保留率、判断保留率；
- 证据距离分布、同源重复率；
- 律师修改量 / 盲评偏好（有真稿时）。

### 8.3 否证门

- C 若不能在标注集上降低「无依据确定句」，来源根只保留为诊断，不做门禁；
- D 若不能在同任务集上优于按类别修复（根因命中率或 token），译码器不接生成回路；
- E 若降低误报的同时增加漏报或过度 hedging，不上线；
- 任何机制若让律师可见的无依据警告增加，回退；
- 模型变强后机制成本不自动下降，说明它是税，不是能力，降级或移除；
- 未放入真稿前，不得写成「六类缺陷已解决」或「真实交件一定更好」。

---

## 9. 非目标

- 不在 `runTurn` 调用量子处理器、厂商云或线路模拟器；
- 不存相位、不跑量子线路、不声称平方加速；
- 不新增律师可见的「量子模式」、开关或设置；
- 不把「量子分」合成一个指标；结构与表达双轨计分；
- 不用关键词禁止清单、字数配额或硬拒冒充稳定子；
- 不让引擎替模型写法律判断；
- 不把日志、哈希链或过程记录当成正确性证明；
- 不把「多一个模型」当成「多一条独立证据」。

---

## 10. 理论边界与可证性质

这一节只写「能证明什么、不能证明什么」，防止把工程启发写成物理承诺。

### 10.1 译码器是 MAP，不是因果识别

设故障集合 \(F\) 的先验为 \(P(F)\propto e^{-\sum_{f\in F} w_f}\)，观测到的综合征为 \(S\)。在「故障独立、每个故障对综合征的作用是确定性的」假设下，最小权重覆盖 \(\min\sum_{f\in F} w_f\) 就是 \(\arg\max P(F\mid S)\)。它给出的是「与综合征最一致的解释」，不是「真实原因」。同价解释必须返回 `ambiguous`；这是 MAP 在多解时的正确行为，不是实现缺陷。

### 10.2 来源根乘积是朴素贝叶斯

若每个来源根给出独立似然比，且根之间条件独立，则对同一读法的权重乘积给出后验。共享根被排除，避免把一份证据算两次。它不估计根之间的相关；同一模型、同一上下文、同一检索结果必须显式归到同一个根，否则仍会虚高。这是本模块的已知边界。

### 10.3 保形门只在可交换样本上有覆盖保证

Split conformal 的有限样本覆盖保证要求校准行与测试行可交换。律师修正记录是**选择偏差样本**：只有被注意到的错误才会被修正，沉默不等于正确。因此 `conformal-calibration.ts` 现在只把修正记录当作弱校准数据，并且要求至少 8 条有区分度的行；它不宣称覆盖率。真正的覆盖保证需要独立标注的校准集。

### 10.4 决策距离不是码距

`decisionDistance` 数的是「胜出读法独有的来源根」。它没有阈值定理，也不保证距离 2 就能纠错；它只表达「要翻转结论，至少要让两条独立证据同时失效」。把它写成码距会过度承诺。

### 10.5 弱测量滤波是序贯贝叶斯

`evidence-filter.ts` 是对数几率累加、按轮衰减、按通道去重。若 LLR 经过校准，阈值有决策论解释；未校准时它只是启发式迟滞。它不提供量子测量意义上的投影或波函数坍缩。

### 10.6 对角态没有量子优势

产品路径只存对角概率，不存相位，不跑线路。译码器是集合覆盖，滤波是序贯贝叶斯，融合是朴素贝叶斯；这些算法没有量子加速主张。相位/相干只允许离线预注册实验，未胜出不得进入 `runTurn`。

## 11. 参考文献

**量子纠错与译码**

- Knill, Laflamme. Theory of quantum error-correcting codes. _Phys. Rev. A_ 55, 900 (1997).
- Gottesman. Stabilizer codes and quantum error correction. PhD thesis, Caltech (1997).
- Fowler, Mariantoni, Martinis, Cleland. Surface codes: towards practical large-scale quantum computation. _Phys. Rev. A_ 86, 032324 (2012).
- Wald. Sequential Analysis. Wiley (1947).（序贯概率比检验）

**因子图与推断**

- Pearl. Probabilistic Reasoning in Intelligent Systems. Morgan Kaufmann (1988).
- Kschischang, Frey, Loeliger. Factor graphs and the sum-product algorithm. _IEEE Trans. Inf. Theory_ 47(2), 498–519 (2001).
- Cover, Thomas. Elements of Information Theory. Wiley (2006).（数据处理不等式）

**保形预测与不确定性**

- Vovk, Gammerman, Shafer. Algorithmic Learning in a Random World. Springer (2005).
- Angelopoulos, Bates. A gentle introduction to conformal prediction and distribution-free uncertainty quantification. arXiv:2107.07511 (2021).

**2025–2026 研究**

- arXiv:2608.14280 — LLM-Assisted LDPC Decoding via Syndrome-Verified Semantic Priors.
- arXiv:2609.19090 — Securing quantum error correction against misleading advice from AI agents.
- arXiv:2606.06941 — Quantum-Inspired Trace-Augmented Evidence Selection for Reasoning over Structured Hypothesis Spaces.
- arXiv:2608.14617 — Calibrated Trust, Not Sharper Prediction: An Empirical Test of Uncertainty Fusion.
- arXiv:2606.00405 — From Talking Words to Sharing Thoughts: Scalable Multi-LLM Aggregation via Structured Message Passing.
- arXiv:2609.33485 — DISCO: Distributed Long Context Scaling with Grounding-Reasoning Disaggregation.
- arXiv:2606.29718 — Diagnosing and Mitigating Context Rot in Long-horizon Search.
- arXiv:2610.34425 — CTXAgent: Self-Controlled Context Management of LLM Agents.
- arXiv:2610.34872 — Adaptive Retrieval, Selective Answers: Evaluating Conformal Factuality in Agentic RAG.
- arXiv:2608.00422 — TrAC: Trace-Conditioned Answer Consistency for Efficient Uncertainty Quantification in LLMs.
- arXiv:2610.10311 — Fault-tolerant foundation models.
- arXiv:2603.26494 — Entanglement as Memory: Mechanistic Interpretability of Quantum Language Models.
- arXiv:2510.21844 — KARIPAP: Quantum-Inspired Tensor Network Compression of Large Language Models.
- arXiv:2608.17288 — Q-Interference: Memory-Efficient Phase-Aware Quantum-Inspired Attention.
- arXiv:2610.17214 — Density-Matrix Reinforcement Learning.
- arXiv:2603.13558 — Holographic Invariant Storage: Design-Time Safety Contracts via Vector Symbolic Architectures.
- arXiv:2512.14709 — Attention as Binding: A Vector-Symbolic Perspective on Transformer Reasoning.

**本仓库内部**

- [`LAWMIND-FORWARD-AGENT.md`](./LAWMIND-FORWARD-AGENT.md) §9 — 科学裁决、硬件与模拟器边界、后续优化顺序。
- [`量子启发.md`](./量子启发.md) — 律师说明与设计者复盘。
- `src/lawmind/agent/factor-state.ts`、`factor-witness.ts`、`definition-relations.ts`、`correction-ledger.ts`、`review-observations.ts`、`factor-conformal.ts`。
- `src/lawmind/evaluation/offline-diagonal-simulator.ts` — 离线三方对照。
