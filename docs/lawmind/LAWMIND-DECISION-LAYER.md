# LawMind 判断层（Decision Layer）：现状缺口、Jev 调研与选型

> **状态**：调研完成（2026-09-20）。结论是「**把 LLM 从运行时判定器降级为编译期工具**」——LawMind 已有这条路线的一半（`clause/` DSL + `lint/` 规则 + 参数库 + 逃逸飞轮），引入外部决策模型（Jev 或同类）是方案空间里的**最后一档**。
> **用途**：回答两个问题——「LawMind 现在哪些判断是用正则/启发式/哑字段凑合的」以及「除了再接一个模型，有没有更合适、更自主的做法」。
> **不是**：不是 Jev 的接入设计文档（那是 P0 之后的事），也不是「仓库要重写」的论证。
> **交叉引用**：[LAWMIND-LEGAL-COMPILER-ROADMAP.md](../LAWMIND-LEGAL-COMPILER-ROADMAP.md)（§1.8 飞轮 / §2.3 规则三分类 / §8 人员，**本文 §10 是它的延续**）· [clause/README.md](../../src/lawmind/clause/README.md) · [LAWMIND-ARCHITECTURE-STUDY.md](./LAWMIND-ARCHITECTURE-STUDY.md)（§4 工具管线 / §8.2 推理门禁）· [LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md](./LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md)（§6 护栏，本文 §3 是同一论证在判断层的复用）· [LAWMIND-EGRESS-POLICY.md](./LAWMIND-EGRESS-POLICY.md) · [AGENTS.md](../../AGENTS.md)

---

## 0. 一句话

LawMind 反复声明它的分层口径是「机械事实 ≠ 法律判断」（`src/lawmind/lint/types.ts:2`：_Passing lint ≠ legally correct_）。这个分层是对的，但它**只有两层**：机械层用确定性规则，判断层用大语言模型，**中间那层是空的**。

于是所有「需要判断、答案空间可枚举、又不值得为它付一次前沿模型对话」的位置，现在只能用三种手段凑合：中文正则、一次完整的 LLM 调用、或者干脆让它哑着。

**但结论不是「再买一个判定器」——而是把 LLM 从「运行时判定器」降级为「编译期工具」。** 这条路 LawMind 已经修了一半（`clause/` DSL + `lint/` 规则 + 参数库 + 逃逸飞轮），只是从来没有把它当成判断层的统一方案。本文 §10 给的是完整的方案空间与排序。

---

## 1. Jev 是什么（外部事实）

**TypeSafe AI 的 System One model，2026-09-15 发布，早期访问阶段（waitlist）。**

它不是更聪明的大语言模型，是**另一类东西**：不生成文本，接收一段 `state` + 一组**调用方预先定义好类型**的问句，返回类型化答案与校准概率。

| 项目   | 事实                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| 端点   | `POST https://api.typesafe.ai/v1/systemone`（**不是** OpenAI 兼容的 chat/completions） |
| 版本   | `jev-1.13.0`，别名 `jev-latest` / `jev-preview`                                        |
| 输入   | state + questions，仅文本（字符串 / JSON 对象 / JSON 数组）                            |
| 输出   | 三种问句原语，见下表                                                                   |
| 上下文 | 请求 64K；state 加最长问题不超过 32K                                                   |
| 延迟   | 厂商称端到端 70–500 ms；社区实测多在 70–300 ms                                         |
| 价格   | 每百万输入 token 0.042 美元；输出不计费                                                |
| 批处理 | 同一 state 上多个问题**并行求解**，加问题几乎不增加延迟                                |
| 训练   | 厂商称纯合成数据 + RLCD（Reinforcement Learning for Calibrated Decisions）             |

**三个问句原语**：

| 原语     | 语义                                 | 在 LawMind 里像什么                                    |
| -------- | ------------------------------------ | ------------------------------------------------------ |
| `Noul`   | 是 / 否概率 + 校准置信度             | 「争议解决条款缺失吗」→ lint 的布尔型规则              |
| `Choice` | 从你给的选项集中选一个，返回完整分布 | 「任务类型 / 风险档 / 该升级为待拍板吗」→ 有限枚举分类 |
| `Score`  | 按你给的 rubric 打分，返回分布       | 「这次改动的实质影响 1–5」→ 现在完全不判的地方         |

**三个必须记住的限制**：

1. **「不会幻觉」指的是结构上答不出 schema 之外的值。** 它不会给你畸形 JSON、不会编出你没提供的选项、不会有类型错误。**但它仍然会判错。** 第三方小样本评测里它抓出 7 个植入缺陷中的 6 个，对照的前沿模型 7 个全中。零幻觉 ≠ 零误判。
2. **准确率不比前沿模型高。** 厂商自己的四工作流均分 67.8%，对照前沿模型在 68–74% 区间。它的卖点是**成本与延迟低两三个数量级**，不是更准。3. **它是境外 API，且仍在 waitlist。** 生产依赖一个 waitlist 产品本身就需要一层端口隔离。

---

## 2. 为什么它卡在 LawMind 的缺口上

以下每一处都是逐行核对源码确认的现状，不是推测。

### 2.1 正则撑着的判断

- `src/lawmind/intent/utterance-kind.ts` 整个文件是中文句式断言（`CONTINUE_RE`、`BARE_ACK_RE`、`isTaskSwitchUtterance` …）。
- `src/lawmind/triage/rules.ts` 五条规则分诊三档，全部靠 `/起诉|应诉|开庭|诉讼|仲裁|…/` 这类正则。
- 特权提示只有两条 pattern（`src/lawmind/policy/privilege-sentinel.ts:12`），只能抓「律师-客户特权」这类**标记词**；没有标记词的实质法律意见抓不到。
- 立场自检靠六个中文关键词（`src/lawmind/stance/self-check.ts:12`）。

### 2.2 用一次完整 LLM 调用做分类

```110:118:src/lawmind/router/model-route.ts
export async function routeWithModel(
  input: RouteInput,
  cfg: OpenAiJsonClientConfig,
): Promise<TaskIntent | null> {
  const schema = [
    "你是法律工作流程路由器，只做分类与风险评估，不输出法律结论。",
    "只输出 JSON，不要 markdown。",
    "JSON schema:",
```

答案空间是 8 选 1，却发一次完整 JSON completion；`riskLevel` 由模型**自报**（`:147` 的 `parsed.riskLevel ?? inferRiskLevel(kind)`），没有任何校准。

### 2.3 独立审稿：最贵的路径，判最简单的形状

`guardian/legal-guardian.ts` 用**独立会话 × 最多 2 轮 × 完整证据包**，判的是：

```487:487:src/lawmind/guardian/legal-guardian.ts
      '只输出一个 JSON 对象，不要分析过程，不要 markdown 围栏：{"verdict":"pass"|"fail","gaps":[{"code":"snake_case","message":"中文缺口","evidenceRef":"可选"}]}',
```

标准的 Noul + 一组存在性判断。而它的证据包是**代码组装**的（`buildGuardianEvidencePack`）、已经带 `evidencePackHash` 可复现——这是全仓最适合外置判定的接口形状。

### 2.4 哑字段：字段在，语义不在

架构研读 §8.2 已记录，此处复述结论：

- `reasoning-validator.ts` 的 `facts_grounded` 严重级别写成 `required ? "warning" : "warning"`——**永远不可能是 blocker**，`minFacts: 2` 事实上不起作用。
- 唯一的图生产者 `buildLegalReasoningGraph` **从不填 `facts`**（只填 `evidence`），所以该检查对规则生成的图**必然失败、又必然不拦**。
- `authorityConflicts` 按「两个 claim 引用同一个 source 且置信度差 > 0.3」判定——按 source 撞，不按法律主题。两个不相关的结论引了同一条法条就会报成「权威冲突」。

### 2.5 运行期只拦一个工具，而且这是**有意的**

> **本节已于 2026-09-20 复核并修正。** 架构研读 §12.1 记录的 `STRICT_EXTRA_APPROVAL_TOOL_NAMES` 死代码**已被移除**，并由 `dangerous-tool-policy.ts:5` 起的一段显式说明取代——这不是 bug，是一个被写下来的设计边界。

现状（复核后）：`toolRequiresExplicitApproval`（`agent/dangerous-tool-policy.ts:60`）第一件事就是

```66:69:src/lawmind/agent/dangerous-tool-policy.ts
  const { toolName, allowDangerousToolsWithoutApproval, strictDangerousToolApproval } = args;
  if (!toolRequiresLawyerPause(toolName)) {
    return false;
  }
```

而 `toolRequiresLawyerPause` 只对 `send_email` 为真。所以：

- 运行期真正会打断回合的动作**只有 `send_email` 一个**，这是有意的（「只拦从律师这边发出去的动作」）。
- 治理元数据里仍有 30 个工具被标成 `lawyer_approved_write`（`tool-name-sets.ts`），**比运行期门禁宽得多**。
- **即使在 `strict` 模式或 firm / private_deploy edition 下也一样**——因为早退（`:67`）发生在 strict 判断（`:70`）**之前**。`strictDangerousToolApproval` 只决定「`send_email` 要不要无条件拦」，不扩大工具范围。

两者叠加出来的真实缺口是：

> **「这次 `apply_surgical_edits` 改的是无害错别字还是免责条款」现在没人判。** 它不属于「发出去」，所以按现行设计不该拍板；但它也**没有被任何东西评估过实质影响**。

这是判断层最值钱的一个落点，而且它的性质是「**升级**」——不是把本地写动作改成要拍板（那会毁掉体验），而是让**真正高危的那一小部分**能从静默放行升级为一次拍板。方向单向，所以安全。

### 2.6 澄清门禁靠代理指标

`router/intake-gate.ts` 的 `caseMemoryLooksFilledForIntake` 用「字数 ≥ 40 + 命中当事人/交付物关键词」代理「档案够不够」；`HARD_CLARIFICATION_KEYS` 五个硬键的判定同样来自正则路由。

---

## 3. 分工：三层判断带

| 层         | 谁                                                | 做什么                                             | 边界                                     |
| ---------- | ------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| **机械层** | 确定性规则                                        | lint / schema / 哈希链 / CAS / `permissionMode`    | 真相源。不接受概率输入。                 |
| **判断层** | **现在：正则 + 启发式；目标：编译产物（见 §10）** | 路由分类、澄清键判定、覆盖度、风险分级、跨源相关性 | 要判断、答案空间可枚举、不值得付一次对话 |
| **生成层** | 大语言模型                                        | 写正文、拆争点、拟策略、解释推理                   | 价值主体。判断层的东西永远不进这条路。   |

**核心不变量**：

> **判定器不生成正文，大模型不出门禁结论。**

现在这两件事恰恰是混着的：`routeWithModel` 用大模型输出分类、`guardianSystemPrompt()` 用大模型输出 pass/fail、`critiqueDraftWithModel` 用大模型输出缺陷列表。判断层在做生成层的活儿——贵、不可校准，而且**不确定时仍会给你一个流畅的答案**。

**第二条不变量（编译器路线，见 §10）**：

> **运行期的判断不该是"每次都重新推理"，而该是"编译一次、执行多次、可回归验证"。**
> LLM 属于**编译期**（产出规则），不属于运行期（执行规则）。

---

## 4. 结合点清单

按「现状有多痛 × 契合度」排序。深度分档见 §5。

| #   | 落点                                        | 现状有多痛                                                                                           | 契合度                                             | 建议深度                 | 编译器路线怎么走                                        |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| 1   | 指令路由 `router/model-route.ts`            | 一次完整 LLM 请求只为 8 选 1；`riskLevel` 自报无校准                                                 | 满分（答案空间全是有限枚举）                       | D2 → 低置信度时 D3       | 编译成**决策表**（关键词 route 已是雏形）+ 分歧升级     |
| 2   | 独立审稿 `guardian/legal-guardian.ts`       | 最贵的 LLM 路径，判的却是 Noul 型 pass/fail；证据包可哈希                                            | 很高（接口形状天然匹配）                           | D3（shadow 先行）        | checklist 逐项 → **规则**；`verdict` 由代码聚合         |
| 3   | 澄清硬键 `router/intake-gate.ts`            | 硬键靠正则；「档案够不够」靠字数+关键词代理                                                          | 高（5 个硬键 = 5 个 Noul）                         | D3（只放宽「已填」方向） | 编译成**字段存在性规则**（已有 `ClausePattern` 形状）   |
| 4   | 写动作升级 `agent/dangerous-tool-policy.ts` | 运行期只拦 `send_email`（有意）；30 个工具在治理元数据里标 `lawyer_approved_write`，宽的这层没人消费 | 高（`approval-cache-key.ts` 已把参数规范化可哈希） | D3（**只允许升级**）     | 编译成**条款族命中表**（`lint/families/` 已有 6 族）    |
| 5   | 草稿语义复核 `reasoning/draft-critic.ts`    | `critiqueDraft` 只有三条中文正则，每加一条要穷举表达变体                                             | 高（可一次批量问 15–20 项）                        | D1 → D2                  | **首选编译对象**：`clause/lint.ts` 已能产出这类 finding |
| 6   | 条款图覆盖 + Guardian checklist             | `facts_grounded` 恒为 warning；图生产者不填 `facts`                                                  | 中高（逐条判「证据支不支持这个断言」）             | D2（先修数据侧）         | 先修数据（方案 A），再考虑编译                          |
| 7   | 检索合并 `retrieval/index.ts`               | 明确没有全局排序（分数不可比）；`authorityConflicts` 按 source 撞                                    | 中高（跨源可比打分）                               | D2                       | 改成**按法律主题键**（规则），不是打分                  |
| 8   | 特权提示 `policy/privilege-sentinel.ts`     | 两条正则，只抓标记词                                                                                 | 中高（判外发正文）                                 | D2（D3 需先定优先级）    | 编译成**结构化信号**规则（方案 A 已列）                 |
| 9   | 记忆采纳 `memory/adoption-service.ts`       | 谁进 prompt 是硬编码表；建议与画像是否冲突无人判                                                     | 中                                                 | D1                       | 编译成**冲突检测规则**                                  |
| 10  | 工具广告 `agent/tools/governance.ts`        | 固定 12 个核心工具 + `list_more_tools` 试错披露                                                      | 中（广告层本就只是提示层）                         | D1（优先级最低）         | 编译成**按交付类型的工具集表**                          |

**第 1–5 行是同一批，也是编译器路线的第一批目标**：它们的答案空间已经被代码限死，所以「schema 约束」在这里不是限制而是捷径——而**编译之后连运行时调用都不需要了**。第 6–10 行仍有价值，但要先解决数据侧或口径侧的前置问题。

---

## 5. 深度分档

| 档  | 名字       | 含义                                                     | 代价                                               |
| --- | ---------- | -------------------------------------------------------- | -------------------------------------------------- |
| D1  | 旁路可关   | 只加备注 / 建议，不进任何门禁                            | 默认安全，可随时关                                 |
| D2  | 软门禁     | 答案进 system prompt / world-state，模型看到但不受硬约束 | 改的是体验，不是安全                               |
| D3  | 硬门禁     | 答案能 block 一次工具调用或交付                          | 必须 fail-closed + 阈值 + 可审计 + **shadow 先行** |
| D4  | 替代真相源 | 结果写进案件 JSON 当真值                                 | **不建议**：不可复现，概率不是事实                 |

**D3 的转正必须过 §10.0 的棘轮。** LawMind 已经实现了这套棘轮（`delivery/progressive-autonomy.ts`），见 §10.0。

---

## 6. 与大模型的五种配合

| 模式       | 谁在前谁在后                    | LawMind 里的样子                                    | 风险   |
| ---------- | ------------------------------- | --------------------------------------------------- | ------ |
| **前置门** | 判定器先判 → 决定大模型看到什么 | 路由分类 → 决定广告哪些工具、要不要先澄清           | 低     |
| **后置审** | 大模型先写 → 判定器判缺口       | Guardian 证据包逐项 Noul；critic 判条款是否支撑断言 | 中     |
| **并行标** | 同一 state 一次问 N 项          | Guardian checklist 20 项 / 一次调用                 | 低     |
| **兜底器** | 判定器失手才回退                | `routeAsync` 三级回退：判定器 → 大模型 → 关键词     | 低     |
| **监工**   | 判定器看大模型的轨迹            | 语义层提示注入检测                                  | **高** |

**「监工」要特别小心。** 审批旗标是服务端能力位，模型自带的 `__approved` 会被无条件剥掉（`turn-orchestrator-tool-round.ts:345`：_审批旗标是服务端能力位，不是模型参数_）。用概率判定器去替代它是把确定性换成概率——它只能用来补**能力位管不到的语义层**，不能替代能力位。

---

## 7. 工程落地

### 7.1 编译器路线（首选）

**零新增端点、零新增依赖。** 全部落在既有模块上：

| 位置                                            | 动作       | 要做什么                                                                                                                                    |
| ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lawmind/clause/dsl.ts`                     | 扩展       | 新增合同族 `ClausePattern`（`lint/families/` 已有 6 族可参照）                                                                              |
| `src/lawmind/clause/pattern.ts`                 | 扩展       | `ClauseExtractor` 已是可注入接口——LLM 产出的提取器可以从这里落（编译期跑，结果缓存成模式）                                                  |
| `src/lawmind/lint/rules.ts` / `general.ts`      | 扩展       | 新规则；必须带 `source` + `effectiveFrom`（`statute-params.ts:3` 的口径）                                                                   |
| `src/lawmind/lint/statute-params.ts`            | 扩展       | 新法律常量行；**每行必须有 `effectiveFrom` + `source`**                                                                                     |
| `src/lawmind/metrics/lint-escape-candidates.ts` | 扩展       | 现在是「三向分发」（规则候选 + 语料 + 立场候选），补一个**规则候选的待确认队列**接 `memory/adoption-service.ts`                             |
| `src/lawmind/metrics/decision-samples.ts`       | **已落地** | `decision-samples.jsonl` + 数据体检报告：把 §10.0 的信号统一导出成可编译语料（第二十期 P0，见 [PLAN](./LAWMIND-DECISION-LAYER-PLAN.md) §3） |
| `src/lawmind/memory/adoption-service.ts`        | **复用**   | 规则候选走既有 `pending → adopted / dismissed / recorded_noop` 队列，**不静默落盘**                                                         |
| `src/lawmind/delivery/progressive-autonomy.ts`  | **复用**   | 编译好的规则从 advisory 升到 blocking，走既有棘轮                                                                                           |
| `src/lawmind/evaluation/`                       | 扩展       | 新规则的回归语料进 `replay-fixtures` / golden 层（三层口径见 `evaluation/README.md`）                                                       |

### 7.2 外部判定器路线（最后一档·P5 已落地端口）

> **已落地**（2026-09-20，P5）：下列表格是设计稿的当时设想；实际实现与原设想有**两处差异**，以本注为准：
> ① 端点客户端**就在** `models/decision-model.ts` 里（未另建 `llm/systemone-client.ts`）——它不走 OpenAI 兼容协议，放同目录反而增加一层无意义的间接；
> ② 配置读 **workspace policy + `LAWMIND_DECISION_MODEL_*`**，**未**扩 `ModelsStoreFile`——因为判定器不是「对话模型的一个变体」，塞进 `models.json` 会让它与 `AgentModelConfig` 的假设纠缠。
> 门禁名为 `resolveDecisionModel()`，姿态 `off | shadow | on`（**默认 `off`**），且 `egressMode: "offline"` **一票否决**（刻意不沿用「模型 API 不受 egressMode 约束」的既有豁免）。
> 详见计划 §8.5。

| 位置                                     | 状态       | 要做什么 / 要小心什么                                                                                                                              |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lawmind/models/decision-model.ts`   | **已落地** | 端口 + Typesafe 适配器 + 三态门禁。**必须复用** `platform/outbound-proxy.ts`（已用 `requestTag: "decision-model"`），否则绕过 SSRF / 白名单 / 审计 |
| `src/lawmind/policy/workspace-policy.ts` | **已落地** | `decisionModelMode` / `BaseUrl` / `ApiKey` / `Id` 四键；另加 P4 的 `judgementPromotion` 与 P2 的 `routeDivergence*`                                |
| 各结合点 `*.decision.ts`                 | **未接**   | 前置条件未满足：P2.3 的分歧数据还是零记录，在拿到它之前接入等于把可测量的缺口换成不可测量的第三方承诺                                              |
| 审计集成                                 | **未做**   | 端口 id（`typesafe.<model>`）尚未进审计链——按下面的红线，接入时必须走 `detail` 或 sidecar                                                          |

**两条路线共同的红线**：

| 约束                                        | 说明                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `audit/hash-chain.ts:18`                    | canonical payload 是**恰好六个字段**。判定结果只能进 `detail` 或走 sidecar（参照 `guardian/store.ts`），**新增顶层字段会破链** |
| `agent/turn-orchestrator-cassettes.test.ts` | `AGENTS.md` 契约：改门禁/编排必须加 cassette。判定器响应是 typed JSON，比 SSE 好造                                             |

---

## 8. 数据边界

**编译器路线在这里天然胜出：运行期零出网**，所以 §10 里最值钱的落点（Guardian 证据包、`CASE.md`、条款正文、外发信正文）**根本不需要考虑出网问题**。只有最后一档（外部判定器）才需要下面这一节。

外部判定器最值钱的落点恰恰是最不该出网的内容。

**注意一个已有口径漏洞**：[LAWMIND-EGRESS-POLICY.md](./LAWMIND-EGRESS-POLICY.md) §4 明确写着「**模型 API 仍会出网**」。所以判定器的开关**必须是自己的字段**，不能搭 `egressMode` 的车，否则会出现「声称离线但仍在出网」的漏洞。

三个方案：

| 方案 | 内容                         | 问题                                                                |
| ---- | ---------------------------- | ------------------------------------------------------------------- |
| A    | 去标识化后出网               | Guardian 判的正是实质覆盖，去标识化直接伤害它要判的东西。**不可行** |
| B    | 默认关 + 显式开启 + 诚实告知 | 与 LawMind 处理法宝 / 检索的既有口径一致                            |
| C    | 只做端口，等本地等价物       | Jev 被疑基于开源权重，社区已预期竞品出现                            |

**推荐 B + C**：立刻按端口设计、默认 `off`，先做 shadow 验证「这个模式对 LawMind 有没有用」。这样拿到的是**「校准决策层」这个能力**，而不是**「TypeSafe」这个供应商**。

---

## 9. 明确不要做的

1. 用判定器**生成**任何面向律师的文字。
2. 把判定结果写进 `matters/<id>/*.json`（概率不是事实；`jev-1.13.0` 会升版；模型漂移会让历史案件无法解释）。
3. **降级**现有确定性门禁（`permissionMode` / `clarificationGate` / `approval` 是审计承重点）。判定器只能**加一层**，或朝**更严**方向升级。
4. 替掉 `__approved` 能力位。
5. 把 `Score` 当「法律正确性」分数——它只在给定 rubric 语义内可比，跨 rubric 不可比。

> 第 3 条最容易被「更快更便宜」说服而破例，而那会把 LawMind 唯一不可替代的东西（可审计的确定性门禁）换成概率。

---

## 10. 更合适的实现方式：方案空间

这一节是本文的核心。**「再加一个模型」是清单里的最后一档，不是第一档。**

### 10.0 前提：LawMind 已经在盘上放了训练信号，只是从没当成训练信号用

这是整个讨论里最容易被忽略、但决定性的一点。以下全部是逐行核实的既有实现：

| 已有的东西                                                         | 位置                                       | 它其实是                                                      |
| ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------- |
| `escape-candidates.jsonl`（规则漏掉时的 `ruleIds`）                | `metrics/lint-escape-candidates.ts:32`     | **负样本索引**：哪条规则在该命中时没命中                      |
| `escape-corpus.jsonl`（同一时刻的正文 snippet）                    | `metrics/lint-escape-candidates.ts:41`     | **语料**：漏网正文本身                                        |
| `lint_escape` 产品指标（`outcome: lawyer_edit` / `lint_findings`） | `engine/reviewing.ts:74` / `:188`          | **标签**：律师实质改了 / 是草稿侧问题                         |
| `firstPassOk` / `firstPassFail`（按 `deliverableType` 分桶）       | `metrics/product-metrics.ts`               | **按文书族分类的通过率 = 校准目标**                           |
| `north-star.json`                                                  | `metrics/north-star.ts`                    | 上面两个的合成口径                                            |
| `ReviewLabel` 14 个中文标签                                        | `review-labels.ts:4`                       | **细粒度失败分类学**，已经手工定好了                          |
| `classifyRejectionLabels` → `playbook\|skill\|verify\|template`    | `learning/rejection-ratchet.ts`            | **驳回标签 → 修复动作**的分类，已实现                         |
| `extractChangeSpan`（律师真改了什么）                              | `learning/draft-edit-learning.ts:26`       | **偏好对**（before/after），已经是训练数据的形状              |
| `rewriteAmplitude`（改动幅度，按助手累计）                         | `learning/rewrite-amplitude.ts`            | **连续型回归目标**                                            |
| `approvals.jsonl`（append-only + CAS）                             | `application/services/approval-service.ts` | **律师拍板记录**：干净、带时间戳、不可篡改                    |
| **`isAutonomyUnlocked`**                                           | `delivery/progressive-autonomy.ts:11`      | **棘轮**：`firstPassRate` + `lintEscapeRate` 双序列达标才解锁 |

最后一条是本文最重要的发现：

```11:15:src/lawmind/delivery/progressive-autonomy.ts
/**
 * Unlock progressive autonomy only when first-pass AND lint-escape series both qualify.
 * A rubber-stamp first-pass series alone is not enough.
 */
export function isAutonomyUnlocked(input: AutonomySeriesInput): boolean {
```

**LawMind 已经有「用测量出来的战绩换取信任」这套机制了**，而且它刻意防了「自说自话」（单靠 first-pass 不够，必须有逃逸序列对照）。

所以结论是：

> **判断层缺的不是判定器，是「把已有信号接起来」。而 D3 硬门禁的转正机制也已经现成——就是把这个棘轮从「交付」推广到「判断」。**

这和 [LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md](./LAWMIND-ITERATION-SPEED-AND-GUARDRAILS.md) §6.1 的论证是同一个：_在 flaky 修好之前，护栏给出的信号同样不可信_。判断层的版本是：**在判定质量不可测之前，换更强的判定器没有意义。**

### 10.0b 第二个前提：LawMind 已经建了半个编译器，只是没把它当成判断层的方案

[LAWMIND-LEGAL-COMPILER-ROADMAP.md](../LAWMIND-LEGAL-COMPILER-ROADMAP.md) 是一份 500 人天的**法律编译器**计划，而且工程切片已经落地。以下都在仓库里：

| 已有                                                                                                                                                                                                                                                                                                                                                                      | 位置                               | 它是什么                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| 条款解析 DSL（`defineClause` / `definitions` / `obligations` / `rights` / `liability` / `dispute`）                                                                                                                                                                                                                                                                       | `clause/dsl.ts`                    | **判断的可声明表达**（不是模型权重）       |
| 条款 AST（`ClauseType` / `Clause` / `ClauseDoc` / `Reference`）                                                                                                                                                                                                                                                                                                           | `clause/ast.ts`                    | 结构化中间层                               |
| 模式类型（触发词 / 捕获正则 / 子模式 / 自定义提取器）                                                                                                                                                                                                                                                                                                                     | `clause/pattern.ts`                | 规则的可扩展接口                           |
| 结构化条款 lint（5 条：`undefined_article_ref` / `previous_ref_unresolved` / `undefined_term` / `obligation_without_liability` / `dispute_missing`）                                                                                                                                                                                                                      | `clause/lint.ts`                   | 已能产出可合并进 `runLegalLint` 的 finding |
| 22 条通用一致性 / 要式 / 法定上限规则（`statutory.deposit_cap`、`statutory.lpr_multiple`、`statutory.limitation_period`、`form.or_arbitrate_or_sue`、`form.jurisdiction`、`consistency.amount_case`、`consistency.defined_terms`、`consistency.cross_ref`、`consistency.article_numbering`、`consistency.date_order` …；`lint/rules.ts` 10 条 + `lint/general.ts` 12 条） | `lint/rules.ts`、`lint/general.ts` | **已在跑的编译器产物**                     |
| 6 个合同族规则包（买卖 / 借款 / 租赁 / 劳动 / 股权 / 建工，共 52 条规则 id）                                                                                                                                                                                                                                                                                              | `lint/families/`                   | 族化规则                                   |
| 法条参数库（**每行带 `effectiveFrom` + `source`**）                                                                                                                                                                                                                                                                                                                       | `lint/statute-params.ts`           | 可版本化的法律常量                         |
| 编译填充 + 族化适配器                                                                                                                                                                                                                                                                                                                                                     | `compile/`                         | 反向：结构 → 文书                          |

参数库的文件头一句话是这条路线的方法论：

```3:3:src/lawmind/lint/statute-params.ts
 * Wrong params are worse than no lint — keep source + effectiveFrom on every row.
```

**更关键的是，路线图已经把本文 §10 要讨论的问题裁决完了。** §2.3「规则三分类」：

| 类         | 例子                                                | 处置                         |
| ---------- | --------------------------------------------------- | ---------------------------- |
| 客观可枚举 | 法条现行有效、4×LPR、定金 20%、或裁或诉、时效、要式 | **编译**；发现即报，可自动修 |
| 半客观一致 | 大小写金额、定义词、交叉引用、日期顺序              | **编译**；多数可自动修       |
| 主观裁量   | 赔偿上限接不接受、管辖选哪边、商业让步              | **永不编译；升级卡带推荐**   |

而 §1.8 把飞轮也写完了：

> 上述六点串起来的工程化机制是 **lint 逃逸率**：律师在交付后每改一处 = 一次 lint 逃逸 = 同时是 (a) 新 lint 规则候选 (b) benchmark 新案例 (c) 立场库新条目。这一个指标把「越用越像这位律师」从口号变成可度量的收敛过程。

还有 `clause/README.md` 的待扩展清单里写着：

> 用更精确的 NLP/LLM 提取器替换启发式 `extractor`。

**这句话就是答案的形状**：LLM 的位置是**编译期的提取器**，不是运行期的判定器。

---

### 首选路线 · 法律编译器（把 LLM 退到编译期）

**核心转变**：

```text
现在（判断层）:  每次运行 → 调 LLM/模型去「判」 → 得到一次性的答案
编译器路线:      离线一次 → LLM/顾问产出「规则」 → 运行期确定性执行，零调用
```

两期分离：

| 期         | 在哪跑             | 用什么                                       | 产物                                         |
| ---------- | ------------------ | -------------------------------------------- | -------------------------------------------- |
| **编译期** | 离线 / CI / 顾问席 | **任何** LLM（可本地、可替换）+ 法律顾问验收 | `ClausePattern`、lint 规则、参数库行、决策表 |
| **运行期** | 律师桌面，本地     | **纯确定性代码**                             | finding / 判定结果                           |

**这个路线在你的三个关切上严格优于买模型**：

| 关切           | 买外部模型                          | 编译器路线                                      |
| -------------- | ----------------------------------- | ----------------------------------------------- |
| **花钱**       | **每次调用都付费**，永久            | **一次编译，运行期零边际成本**                  |
| **受牵制**     | 供应商改版 / 涨价 / 倒闭 / waitlist | 产物在你仓库里，`effectiveFrom` + `source` 自持 |
| **自主知识产** | 权重永远是别人的                    | 规则、参数、语料、阈值都是你自己的              |
| **可审计**     | 概率是黑箱，无法向律师解释          | 规则可读、可 diff、可回归测试                   |
| **可版本化**   | 模型静默升级，历史案件无法解释      | 规则包 + 生效日 + 出处，可回滚                  |
| **越用越准**   | 只随供应商升级                      | **随本所改稿数据收敛**（§10.0 的飞轮）          |
| **可出网**     | 需出网（除非本地部署）              | 运行期零出网，天然 `egressMode: offline`        |
| **准确性上限** | 受厂商水平限制                      | 受**你自己规则覆盖率**限制（风险见下）          |

**注意最后一行是诚实的代价**，不是优点：编译器有覆盖率天花板（路线图 R7 已登记）。它能覆盖客观与半客观，**覆盖不了主观裁量**——而那部分路线图的处置正好和本文 §10.5 的分歧驱动升级是同一条：**永不编译，只升级给律师**。

**"更高级"的准确含义**：不是更强的模型，而是**把判断从"每次都重新推理"变成"编译一次、执行多次、可回归验证"**。这是编程语言相对于解释执行的优势，不是模型相对于模型的优势。

**编译器路线也不是"不要 LLM"**——LLM 在编译期有明确位置：

1. **规则候选生成器**：吃 `escape-corpus.jsonl`（漏网正文）+ `escape-candidates.jsonl`（哪条规则该命中没命中），产出 DSL 规则候选。
2. **`ClausePattern` 提取器**：`clause/pattern.ts` 的 `ClauseExtractor` 类型本来就允许复杂语义提取器——那里可以放 LLM（离线跑，把结果缓存成模式）。
3. **验收辅助**：法律顾问复核时给候选打标（走既有 `memory/adoption-service.ts` 的 `pending → adopted / dismissed` 队列，**不静默写入**）。

**这就是「用 LLM 写你的编译器」而不是「用 LLM 替代你的编译器」。**

---

### 方案 A · 确定性收口（不用任何模型）

清单里相当一部分「缺口」其实是**数据缺口或 wiring bug，不是模型缺口**：

| 现状                                      | 真正的最小修法                                                                                                                                                | 需要模型吗   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `facts_grounded` 恒为 `warning`           | 让 `buildLegalReasoningGraph` 填 `facts`（数据侧）                                                                                                            | **不需要**   |
| `authorityConflicts` 按 source 撞         | 改成按法律主题键（规则侧）                                                                                                                                    | **不需要**   |
| `STRICT_EXTRA_APPROVAL_TOOL_NAMES` 死代码 | **已删除**（2026-09-20 复核）。若要新增内部管线的拍板，需先改 `toolRequiresExplicitApproval` 的早退结构 + 补 cassette（`dangerous-tool-policy.ts:11` 已写明） | **不需要**   |
| `privilege-sentinel` 只有两条正则         | 用**结构化信号**（`deliverableType` + citation integrity + 是否引用诉讼策略章节 + 收件人是否外部）而非裸文本正则                                              | **不需要**   |
| 立场自检靠六个关键词                      | 复用 `ClauseGraph` 已有的条款识别，不要再开一套正则                                                                                                           | **不需要**   |
| 运行期只拦 `send_email`                   | 把 `WRITE_TOOLS` 里「触及责任/期限/管辖/金额」的子集挂上**升级式**审批（规则判定章节标题 + 参数族）                                                           | 大部分不需要 |

**这一遍应该先做。** 不先做它就直接引入判定器，等于**用概率去填数据洞**——洞还在，只是被一层看起来更聪明的输出盖住了。

### 方案 B · 把 LLM 调用改成「受约束 + 由代码聚合」

关键洞察：Jev 的卖点可以拆成**两个独立的东西**——

1. **接口**：schema 受限，结构上答不出非法值。
2. **目标**：概率被专门训练成校准的。

**接口这一半 LawMind 现在就能拿到，不需要新供应商**：

- `response_format: json_object` 已在用（`llm/openai-json.ts:99`），可升级到 **strict JSON schema** 或**语法约束解码**（grammar-constrained decoding）。这就有了「结构上不可能畸形」。
- **聚合逻辑移回代码**：Guardian 已经部分这么做（`guardianBlocksExport` 判 verdict）。把 checklist 每一项变成独立的布尔判定，`verdict` 由**确定性规则聚合**——这一步的价值和是否用 Jev 完全无关。
- `completeJsonObject` 已有重采样机制（`shouldResampleSidecarJson`，`:136`），可以改成「**多次采样取分布**」——用采样频率近似概率，作为校准的粗代理。

**拿不到的只有「被训练过的校准概率」**——而那一半可以用方案 C / D / E 自己补。**方案 B 是纯收益，无论最终选哪条路都该做。**

### 方案 C · 本地小模型 + 语法约束解码 + 自校准

- **本地推理**：LawMind 已经留了缝——`indexing/embeddings/index.ts:6` 的注释明确写 _USER may later swap in bge-m3 / onnx runtime_。
- **语法约束**：XGrammar / llguidance / llama.cpp GBNF，给出与方案 B 同等的结构保证。
- **校准自己拟合**：这是关键的一步——**温度缩放（temperature scaling）/ Platt scaling**，一个单调映射，几百个样本就能拟合。样本来自 §10.0 的 `escape-corpus.jsonl` + `firstPassOk/Fail`。

> **校准是可以在本地用几百个样本补出来的，不必从外部买。** 而且本地校准学到的是**这家律所的口径**，比通用校准更准——同一个「高置信度」，在红圈所和精品所的语义是不一样的。

零出网、零供应商，天然符合 `egressMode: offline`。

### 方案 D · 分歧驱动升级（不需要任何概率）

**最有价值的一条。** 核心：**不确定性 = 多个便宜判定器的分歧。**

LawMind 天然有三条路径：关键词 `route` / 模型 `routeWithModel` / 规则 lint。做法是全部并行跑（都很便宜），**一致就直接用，不一致就升级**（升级到大模型，或升级到律师）。

| 优点              | 说明                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| 不用训练          | 三条路径都已经存在                                                       |
| 不用供应商        | 零新增依赖                                                               |
| 完全可解释        | 分歧样本本身就是可审计的证据（比一个 0.73 更好解释）                     |
| 天然 fail-closed  | 分歧 → 升级，不需要调阈值                                                |
| 与 LawMind 同性格 | 「宁可返回 null 也不编 0%」（`metrics/north-star.ts:3`）是同一种设计哲学 |

学术上这叫 **disagreement-based selective prediction**，工程上就是级联分类器（cascaded classifier）。**它最适合 LawMind 的原因**：它把不确定性当作要**暴露出来交给律师**的东西，而不是要**藏起来的东西**。

### 方案 E · 从自己的历史里学一个 firm-specific 校准器

用 §10.0 那些现成信号做特征工程 + 一个轻量模型（逻辑回归 / GBDT / 甚至就是一张加权规则表）：

- **特征**（全是现成的便宜信号）：`deliverableType`、diff 长度、hunk 数、触及的章节标题、是否命中必审条款族、citation 数、`rewriteAmplitude`、有没有命中 stance。
- **标签**：`approvals.jsonl` 的批准/驳回、`reviewLabels` 的 14 个标签、`firstPassOk/Fail`。
- **目标函数**：不是「法律正确性」，是「**这位律师会不会动手**」。一个纯行为学目标——可测、可校准，而且**正好是拍板门禁需要的东西**（门禁要判的就是「这次该不该打断律师」）。

**这是唯一一个越用越准、且越用越贴这家所的方案**，因为标签来自这家所自己的行为。代价是冷启动——需要几十到上百个样本才能起步。

### 方案 F · 引入外部决策模型（Jev 或同类）

它仍然是对的，但**不是替代谁，而是当第三条腿**：

| 什么时候对                        | 理由                                                                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 冷启动期                          | 本地还没标签，方案 E 起步不了                                                                                                            |
| 需要跨语言 / 跨法域的通用语义判断 | 本地没有这类语料（例如语义层提示注入检测）                                                                                               |
| **作为方案 D 的第三条独立判定器** | **分歧驱动需要「独立性」**；Jev 是另一家厂商、另一种训练目标（RLCD vs RLHF），**独立性天然高于两个同源模型**，所以它的分歧信号信息量最大 |

最后一行是一个漂亮的定位：**Jev 的最佳位置不是替代谁，而是当异质的那一票。**

### 决策规则

| 条件                                                 | 选                                   |
| ---------------------------------------------------- | ------------------------------------ |
| 答案客观可枚举 / 半客观一致，且判出来后答案不变      | **编译器**（编译一次，运行期零成本） |
| 是数据缺口 / wiring bug                              | **A**                                |
| 答案属主观裁量                                       | **升级给律师**（永不编译、永不判定） |
| 能让聚合逻辑回到代码里                               | **B**（永远该做）                    |
| 答案空间可枚举 + 有现成规则路径，但编译不出来        | **D**（三条路径投票）                |
| 有标签（几十个样本以上）+ 要硬门禁，且编译器覆盖不到 | **E**                                |
| 必须完全不出网                                       | **编译器** 或 **C** 或 **D**         |
| 冷启动 / 需要异质第三票                              | **F**（只当第三条腿）                |

---

### 自主性对照

> 口径：**自主** = 运行期不依赖任何外部服务；**资产** = 产物沉淀在你仓库里、随使用增值。

| 方案                  | 运行期出网 | 边际成本 | 可审计         | 资产归属     | 越用越准 | 自主性   |
| --------------------- | ---------- | -------- | -------------- | ------------ | -------- | -------- |
| **编译器（首选）**    | **否**     | **零**   | **强**         | **自持**     | **是**   | **最高** |
| A 确定性收口          | 否         | 零       | 强             | 自持         | 否       | 最高     |
| D 分歧驱动            | 否         | 零       | 强             | 自持         | 部分     | 最高     |
| E 自拟合校准器        | 否         | 零       | 中（系数可读） | 自持         | **是**   | 高       |
| C 本地小模型          | 否         | 零       | 弱             | 依赖开源权重 | 需再训练 | 中       |
| B 受约束 LLM 调用     | 是         | 每次调用 | 弱             | 无           | 否       | 低       |
| F 外部决策模型（Jev） | 是         | 每次调用 | 极弱           | **无**       | 否       | **最低** |

**这张表是本文对「自主知识产权」关切最直接的回应**：Compiler 在最自主的一档，Jev 在最不自主的一档，而两者的**准确性差异（如果有）远小于自主性差异**。

---

## 11. 推荐路线

| 阶段   | 做什么                                                                                                                          | 为什么在这个位置                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **P0** | **编译器当主线**：① 写 `decision-samples.jsonl` 导出器（把 §10.0 的信号变成可用语料）；② 方案 A 全部做完（消灭纯数据缺口）      | 编译器要有原料才能编译；不先做这步后面全是空中楼阁         |
| **P1** | **接飞轮**：`escape-corpus` → 规则候选 → `adoption-service` 待确认队列 → 法律顾问验收 → 落 `lint/families` 或新 `ClausePattern` | 路线图 §1.8 已设计好，只差接线；这是「越用越准」的唯一实现 |
| **P2** | **B + D**：LLM 调用改严格 schema、聚合回代码；路由起三路径分歧记录（shadow）                                                    | 零新供应商零出网，立刻拿到不确定性信号                     |
| **P3** | **E 起步**：用 P0/P1 攒下的样本拟合第一个 firm-specific 校准器，覆盖编译器够不着的那部分，先做 D1/D2                            | 越用越准，且贴本所口径                                     |
| **P4** | **D3 转正**：用 `isAutonomyUnlocked` 的棘轮逻辑决定哪个判断能进硬门禁                                                           | 机制已存在，把范围从「交付」推广到「判断」                 |
| **P5** | 最后才评估 F。若引入，只当方案 D 的第三条腿；`egressMode: offline` 时必须不可用                                                 | 到这一步它才是净收益，而不是又一个不可测的组件             |

**P0 不做，后面全是空中楼阁。** 这是本文最重要的建议。

**顺序为什么是「编译器 → 飞轮 → 分歧 → 校准 → 棘轮 → 才考虑外部」**：前四步每一步的产物都是**你自己的资产**，且后一步都复用前一步的产出。接一个外部模型不产生资产，它只是把「未知」从一层变成两层——所以它必须排在资产已经攒起来、且确定自己缺什么之后。

---

## 12. 诚实清单

写这类文档最容易把「设计意图」当「已实现」。以下是明确的不确定与边界：

1. **Jev 的准确率证据是弱的。** 厂商自评基准的参照标签由其他模型生成（不是人工标注真值），第三方评测只有小样本。本文引用它，但没有把它当可信数字用——这也是为什么全文把它放在最后一档。
2. **§10.0 的信号「质量」未经验证。** `escape-corpus.jsonl` 的 snippet 被截断在 400 字（`engine/reviewing.ts:89`），样本量是否足够、正负样本是否失衡，本文没有实测。P0 的产出之一应该是这份数据的体检报告。
3. **`approvals.jsonl` 作为标签有分布偏差。** 只有走到拍板的动作才有记录；被静默放行的动作（§2.5）不产生标签。用它训练会继承这个盲区。
4. **方案 E 的特征都是法律无关的行为特征。** 它能学「这位律师会不会动手」，**学不到「法律上对不对」**。不要把它当质量模型。
5. **方案 C 的本地小模型效果未经本仓验证。** `embeddings/index.ts` 的当前实现是 _deterministic local hash-embedding stub_，**不是生产语义模型**。换成真模型需要实测。
6. **编译器路线有覆盖率天花板（路线图 R7 已登记）。** 它覆盖客观可枚举与半客观一致，**覆盖不了主观裁量**。诚实呈现是硬约束：报告必须自述「本次机械核对 N 项」，不能把覆盖率说成法律正确性——`lint/types.ts:3` 已经写死了这条口径。
7. **编译器的规则必须有法律顾问验收，这不是可选项。** 路线图 §8 明确「规则错了比没有规则更糟」。`lint/statute-params.ts:3` 的 _Wrong params are worse than no lint_ 是同一句话。**编译器路线的人力成本方式与买 API 完全不同：它前期重、后期趋零；买 API 是全程线性付费。** 选型时不要只比第一年。
8. **本文对「自主知识产权」的讨论是工程视角。** 仓库代码是 MIT（`LICENSE`）；「资产」指运行期不依赖外部服务、且产物（规则包 / 参数库 / 逃逸语料 / 阈值）沉淀在本地工作区并随使用增值。这不是法律意见，涉及正式 IP 策略请走法务。
9. **所有 `path:line` 来自 2026-09-20 的工作区快照**，行号会随重构漂移；找东西时优先按标识符名搜。**本次写作中已实测到两处引文被并行改动打漂**（见 §2.5 的复核注），所以引用前请先核。
10. **`src/lawmind/clause/README.md` 已过期。** README 的「结构化 lint」只列 4 条检查，`clause/lint.ts` 实际有 5 条（少了 `clause.previous_ref_unresolved`）。这正好是本文方法论的一个活样本：**文档声明 ≠ 代码事实**，而编译器路线之所以比模型路线可信，就是因为前者的产物能被这样逐条核对。
11. **「22 条通用规则 / 52 条族规则 / 5 条条款规则」是按 `ruleId` 字面计数**，不等于有效覆盖率。有多少条在实际文书上真的会命中、precision 如何，本文没有实测——这正是 P0 要出的体检报告。

---

## 13. 参考

- [A new kind of AI model from a ChatGPT inventor is thrilling developers — TechCrunch, 2026-09-18](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)
- [A deep dive into Jev, TypeSafe's System One model — flaviocopes.com](https://flaviocopes.com/jev/)
- [Jev API — Fast, Type-Safe Structured Decisions](https://jevapi.dev/)
- [How to classify, route, and score with Jev and AI SDK — Vercel](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)
- [Building a Harness with Jev — LangChain](https://www.langchain.com/blog/building-a-harness-with-jev)
- [TypeSafe Jev Review — Kingy AI](https://kingy.ai/blog/typesafe-jev-review-the-ai-model-that-doesnt-generate-text/)
- [Guardrails Beat Guidance (arXiv 2604.11088)](https://arxiv.org/html/2604.11088v2)
