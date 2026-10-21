# LawMind × DeepSeek 五层技术栈：哪些值得研究，哪些可以先不看

> 值得投入的只有一条指标、两条纪律、一个审计开关；引擎层读思想，算子层不看。

2026-10-20，DeepSeek 开源了 DeepInfer，并把自己描述成"应用层 Harness / 接口层 deepseek-recipe / 模型层 V4.1-Flash / 算子层 FlashMLA·DeepGEMM·DeepEP·TileLang / 引擎层 DeepInfer"的全栈。本文只回答一个问题：**这五层里，哪些对 LawMind 有真实的、可落地的参考价值。**

写作口径有两条：

1. **判断标准**：它能不能改变我们发出去的请求体，或者改变我们对一笔成本、一次审计的判断。两条都不占的，是别人的机房故事。
2. LawMind 侧的事实一律标 `文件:行`，都是我实际读到的代码；DeepInfer 侧的"包含/不包含"来自其 README 与公开报道，**没有逐行核仓库**，第六节单列了不确定项。

## 1 结论

### 1.1 判断标准

LawMind 是**本地 Electron 桌面**（`docs/LAWMIND-ARCHITECTURE.md` 的四层：桌面壳 / 本地 HTTP API / 引擎 / 渲染层），模型调用走 BYOK 直连或平台代理，默认上游就是 `deepseek-flash`（`src/lawmind/models/catalog.ts:7`），**自己没有推理栈**。

所以"参考价值"必须落到两件事之一：

- 改变请求体：前缀排布、工具表、续跑方式、采样参数；
- 改变判断：一次调用的钱花在哪、缓存有没有中、同一输入能不能复现。

跑不进这两条的，再漂亮也不进排期。

## 目录

- [1 结论](#1-结论)：判断标准、五层评级、最该做的四件事
- [2 先对齐我们的约束](#2-先对齐我们的约束)：部署形态、默认上游、并发模型、可观测
- [3 逐层](#3-逐层)：Harness / recipe / DeepInfer / 权重 / 算子
- [4 成本模型](#4-成本模型为什么缓存命中率比prompt-长度重要)：一笔账、一条更正、块粒度
- [5 四件事](#5-四件事落点与验收)：落点与验收、明确不做的
- [6 不确定、待核与顺带发现](#6-不确定待核与顺带发现)
- [7 怎么自己验证](#7-怎么自己验证)：两个一下午能跑完的实验

### 1.2 五层评级

| 层     | 内容                                    | 对 LawMind 的价值                                      | 结论     |
| ------ | --------------------------------------- | ------------------------------------------------------ | -------- |
| 应用层 | DeepSeek Harness                        | **高**：已经抄了一半，剩下的一半最值钱                 | 继续对齐 |
| 接口层 | deepseek-recipe                         | **最高**：token 编解码可校准估算器，缓存字段可变成指标 | 优先落地 |
| 引擎层 | DeepInfer                               | 中：代码搬不动，四个决策可搬                           | 读思想   |
| 模型层 | V4.1-Flash 权重                         | 低：私有化硬件门槛跑不动                               | 记录     |
| 算子层 | FlashMLA / DeepGEMM / DeepEP / TileLang | 极低                                                   | 不看     |

### 1.3 最该做的四件事

| 该做的事                | 为什么                                                                                  | 落点                                                                                                 | 怎么算做完                                          |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| cached token 变一等指标 | 现在 usage 里的缓存字段被整段丢掉，全仓没有一处记 `cached`，无法判断缓存中没中          | `src/lawmind/agent/runtime-model-call.ts:279`、`RunTurnEvent`、`src/lawmind/agent/context-budget.ts` | 一次真实首轮能报出 fixed / cached / uncached 三个数 |
| 前缀稳定性审计          | 工具表每轮可能变（`list_more_tools` / pin / 权限 / `lockSearch`），一变整段历史缓存作废 | `src/lawmind/agent/turn-orchestrator-model-loop.ts:437`、`src/lawmind/agent/system-prompt.ts:898`    | A/B 两个会话，cached 占比可复现地提高               |
| 估算器校准              | 1 CJK 字按 1 token 估是保守值，高估会提前 compact，而 compact 会重写前缀                | `src/lawmind/agent/context-budget.ts:60`                                                             | 同一语料的估算误差 < 10%                            |
| 可复现模式              | 审计链能证"发生过"，不能证"可复现"；`temperature` 默认 0.3                              | `src/lawmind/agent/runtime-model-call.ts:362`、审计 envelope                                         | 固定 seed + 结构化输出，两次调用同文                |

## 2 先对齐我们的约束

不先摆清楚我们在哪，就会把别人的机房问题当成自己的产品问题。

- **部署形态**：桌面应用，模型调用从本机发出（BYOK）或经平台代理（`docs/lawmind/LAWMIND-PLATFORM-PROXY.md`，**状态 Draft，服务端实现另议**）。没有常驻推理服务。
- **默认上游**：`deepseek-flash`（`src/lawmind/models/catalog.ts:7`）。所以 V4.1-Flash 的服务质量、价格、缓存行为，是**我们实际在用的东西**，不是别人的 benchmark。
- **并发模型**：进程内一个准入池，`DEFAULT_MODEL_SLOTS = 8`、`MODEL_HARD_CAP = 8`，429 减半、连续 8 次成功 +1（`src/lawmind/runtime/turn-admission.ts:20`、`:168`）。这是**客户端**的调度，解决的是"别被上游打死 + 别让一个对话饿死别的对话"，不是吞吐优化。
- **可观测**：`TokenBudgetSnapshot` 只有 `used / effectiveLimit / level / warnRatio`（`src/lawmind/agent/context-budget.ts:15`），没有"固定税"，没有"缓存命中"。
- **无状态上游**：OpenAI 兼容端点不保留会话链。这一点决定了后面第 4 节的一条重要更正。

## 3 逐层

### 3.1 应用层 · Harness：已经抄了一半

证据在代码里，不是猜测：

- `src/lawmind/llm/http-retry.ts:7` 的重试预算直接引用了 `DeepSeek harness retryPolicy.mode=normal`——EMPTY/TRANSPORT 重试两次，并明确写"不要发明第三个预算"。
- `src/lawmind/agent/session-inbox.ts:2` 的 followup / steer / inject 三通道，就是 Harness 的入口语义。
- `src/lawmind/agent/tool-decision-sampling.ts:3` 在写 tool call 前先落 `reasoning_content`，也是照它做的。

没抄完的是三件，`docs/LAWMIND-MEWORK-CODE-REVIEW.md` §1.2 已经列过：工具第一个参数 `purpose`、工具表指纹稳定、工具轮只发增量。前两件仍然有效；第三件要先看第 4 节的更正，**它不是一次重构，是一个产品决定**。

### 3.2 接口层 · deepseek-recipe：最被低估

它提供"与官方 API 对齐的 token 编解码"。这在别人眼里像文档附件，在我们这里有两个硬用途。

**用途一：校准 `context-budget.ts` 的估算器。**

现在的估算是 1 个 CJK 字 ≈ 1 token、其余 4 字符/token（`src/lawmind/agent/context-budget.ts:24`、`:60`）。这个选择是**故意保守**的：注释里写"chars/4 对中文系统性低估 3-4 倍"，所以宁可高估。

但保守有代价。`historyContextTokens` 把名义窗口封在 200K（`src/lawmind/agent/context-budget.ts:31`），告警水位是 `warnRatio = 0.85`（`src/lawmind/agent/context-tuning.ts:144`）。一旦高估，就会**提前触发 compact**。而 compact 会重写历史前缀——按第 4 节，前缀一改，缓存从改动的那一块开始整段失效。所以：

> 估算偏差不是"显示不准"，它会让你多花钱。

DeepSeek 分词器对中文是压缩的（汉字常常不到 1 token），所以"1 字 = 1 token"的上界可能宽出三到四成。具体宽多少，必须用 recipe 实测，不要凭感觉调常数。

**用途二：验证结构化输出与采样参数。**

这决定第 5.4 节的"可复现模式"能不能做。如果 recipe 的编解码与官方 API 对齐，那么"同一输入、同一参数、同一输出"才有可验证的口径，而不是只在温度 0 上赌。

### 3.3 引擎层 · DeepInfer：代码搬不动，四个决策可搬

按公开口径：Apache-2.0、只支持 V4.1-Flash、**离线单模型**、基于 vLLM、要 SM100 或昇腾 950、Linux + GCC 13 + CUDA 13；**明确不含 KV cache 系统、Prefill/Decode 分离、负载均衡**。

这四条合起来要读懂两层意思：

1. 它开源的是"算子 + 调度"，不是"在线服务"。"生产级"是营销口径，"155T tokens/day"也没有独立复核。想靠它自建一个在线 API，缺口正好在最难的那三块。
2. 反过来说，**它的价值不在代码，在它承认的难点在哪**——KV cache 与调度才是护城河，kernel 不是。

能搬的是四个决策：

- **异步调度**：CPU 准备下一批时 GPU 不空等。对我们映射成"工具执行与下一次采样重叠"，而不是等工具全跑完再组 prompt。
- **SWA 有界重放**：只重算尾部 140 token，不重跑整个 prefill。我们的 `compact` 是"钉住近尾 + 摘要"，本质上是同一件事。意义在于**校准认知**：不需要发明新机制，只需要把"重放窗口"当成一个可调预算。
- **DSpark 投机解码 + 置信度调度**（≤5 draft）：只影响首字延迟，不影响我们任何设计。知道即可。
- **确定性采样 + 结构化输出约束**：对律师场景是稀缺品。审计链现在能证明"发生过"，不能证明"再来一次还是这份"。

### 3.4 模型层 · V4.1-Flash 权重：私有化看着香，实际跑不动

SM100 / 昇腾 950 的门槛意味着律所一体机不可能跑。`docs/lawmind/LAWMIND-EGRESS-POLICY.md:81` 已经写明"模型 API 仍会出网——需换本地模型"，同页也给了离线承诺的三件套：`offline` + 本地模型 + 不配外部权威库。

结论：真正该研究的是 **vLLM / SGLang 上跑得动的小模型**，不是 DeepInfer。V4.1-Flash 权重对我们的意义只有一条——它证明了"开放权重"这条路存在，但没证明它便宜到能进律所机房。

### 3.5 算子层 · 不看

FlashMLA、DeepGEMM、DeepEP、TileLang 是给"自己开 GPU 推理服务并且有 CUDA 团队"的人看的。EPLB、CP/DP、专家并行这些词进不了产品决策。**至少现在不进。**

## 4 成本模型：为什么"缓存命中率"比"prompt 长度"重要

这一节修正 `docs/LAWMIND-MEWORK-CODE-REVIEW.md` §2.2 的一个说法。那篇的结论是"我们每轮全量重发，第 N 轮成本是 N 倍"，并建议"续跑只发增量"。前半句方向对但量级不准，后半句在 BYOK 场景**做不到**。

### 4.1 一笔账

设固定税 \(F\)（系统提示 + 工具 schema，每轮都发）、每轮新增 \(u\)（assistant 输出 + 工具回包）、轮数 \(N\)、缓存命中时的单价系数 \(r\)（命中价约为未命中的 1/10，量级口径，以当期价目为准）。第 \(i\) 轮的输入约为 \(F + iu\)，于是

$$
C \approx r\left(NF + \frac{N^{2}u}{2}\right)
$$

四个杠杆的力度完全不同：

- **降 \(r\)（保前缀 + 提命中）**：整体系数，唯一能一次改出 10 倍量级的东西。
- **降 \(N\)（单轮多工具并行）**：二次项。
- **降 \(u\)（工具回包瘦身）**：二次项，但只在 \(N\) 大时显形。
- **降 \(F\)（prompt 瘦身）**：线性项。这就是"把系统提示写短"经常白忙的原因——它不是主项。

### 4.2 为什么"续跑只发增量"在我们这里不成立

MeWork 每轮只发两条消息，是因为它的**云端**按 `assistantParentMessageId` 重建整条链。DeepSeek 的 OpenAI 兼容端点是**无状态**的：客户端不发全量历史，服务端就没有上下文。BYOK 直连下，"只发增量"没有实现路径。

它只在一种情况下成立：LawMind 自建平台代理并维护服务端会话链。那是**另一个产品决定**（而且 `LAWMIND-PLATFORM-PROXY.md` 现在还是 Draft、服务端另议），不是一次 turn-orchestrator 重构。

所以真正能拿的是它背后的两条纪律，而不是它的请求形状：

1. **前缀逐字节稳定**；
2. **工具表指纹不变**。

### 4.3 缓存是块粒度的，不是字符粒度的

按 DeepSeek 的文档口径，前缀缓存以块为单位（64 token 量级）。这意味着"改一个字符"不是只损失一个字符，而是**从那一块开始整段失效**。所以判断"这个改动会不会伤缓存"，不能看改了多少字，要看改的位置在第几块。

## 5 四件事：落点与验收

### 5.1 cached token 变一等指标

现在整条链路只留三个数：

```ts
usage = {
  prompt_tokens: chunk.usage.prompt_tokens ?? 0,
  completion_tokens: chunk.usage.completion_tokens ?? 0,
  total_tokens: chunk.usage.total_tokens ?? 0,
};
```

`src/lawmind/agent/runtime-model-call.ts:279`。usage 里的缓存命中字段（`prompt_cache_hit_tokens` / `prompt_tokens_details.cached_tokens`，具体以 V4.1 当期 API 为准）被整段丢掉，全仓没有一处记录 `cached`。

改三处：

1. usage 聚合保留缓存字段，并在 `ModelCallHttpError` / 重试日志里不丢；
2. `RunTurnEvent` 增 `token_usage`，带 `input / cached / uncached / fixed / output`；
3. `context-budget.ts` 的快照补"固定税"——首轮把系统提示与工具 schema 单独算出来，这就是 MeWork 那 67,864 token 的对应物。

**验收**：一次真实首轮，日志里能同时看到 fixed、cached、uncached。没有这三个数，第 5.2 节的效果就只能靠感觉。

### 5.2 前缀稳定性审计

**已经做对的部分**：boundary + 冻结。

```ts
export const LAWMIND_PROMPT_DYNAMIC_BOUNDARY = "---LAWMIND_PROMPT_DYNAMIC_BOUNDARY---";
```

`src/lawmind/agent/system-prompt.ts:25`。`applySystemPromptToHistory` 只替换 boundary 之后的部分，已发出的 static 前缀逐字节冻结（`src/lawmind/agent/system-prompt.ts:528`）。这条设计是对的，不要动。

**问题在 wire 上的工具表**。`openAITools = registry.toOpenAITools({ names: roundToolNames })`（`src/lawmind/agent/turn-orchestrator-model-loop.ts:437`）每轮重建，而 `roundToolNames` 会因为 `list_more_tools`、pin packs、权限模式、`lockSearch` 变化（同文件 `:436`、`:883`）。多数实现的 prefix cache 把 tools 也计入前缀，**工具表一变，整段历史缓存作废**。

按第 4.1 节的账：省 10K token 的工具表、换掉 60K token 的缓存，是净亏。

顺序倒不用管：`toOpenAITools` 已按名字排序（`src/lawmind/agent/tools/registry.ts:65`），不会出现"集合相同、顺序抖动"的假失效。

**建议方向**：工具"全集常驻 + 用 `tool_choice` / 参数校验限制"，而不是物理增删。如果担心 token，就按"稳定子集 + 稳定排序"来切，别按轮切。

**验收**：同一任务跑两次，一次触发 `list_more_tools`、一次不触发，比较 cached 占比；或者直接读 5.1 的字段。

**顺带的副作用**：工具清单的 prose 在 `staticTail` 里（`src/lawmind/agent/system-prompt.ts:867`，`:898` 拼进 staticText），而 static 被冻结，所以中途 `list_more_tools` 之后，**prose 表还是启动时那份，真正生效的是 `body.tools`**。模型被要求"以本轮工具表为准"，它看到的 prose 却没更新。现有的 `tool-disclosure-delta`（`src/lawmind/agent/tool-disclosure-delta.ts:2`）用一条隐藏的 transcript note 说明增量，算是绕过去了，但 prose 与 wire 的一致性没有断言。值得补一条 cassette。

### 5.3 估算器校准

目标不是"更准"，是"不要因为高估而提前 compact"。用 5.1 的 `fixed / input` 数做对照：

- 取 20 份真实案卷（合同、判决、笔录各若干），
- 分别用 recipe 的编解码与 `estimateTextTokens` 算同一段，
- 得出 CJK / 拉丁 / 混排三档的实际系数，
- 只调系数，不动水位逻辑。

**验收**：同一语料的估算误差 < 10%，且 compact 触发次数可解释地下降。

### 5.4 可复现模式

律师场景里，"同一输入、同一参数，出同一份稿"比"快 30%"更值钱，尤其在合同审查与尽调比对。现在 `temperature` 默认 0.3（`src/lawmind/agent/runtime-model-call.ts:362`），结构上不承诺可复现。

做法：

- 会话级 `reproducible: true`：temperature 0 + 固定 seed（上游支持时）+ 结构化输出约束；
- 把采样参数、模型 ID、工具表指纹写进审计 envelope，而不是只写 prompt 哈希；
- 对外口径写清楚：**同参数同输入**，不承诺跨版本模型一致。

**验收**：同一输入连跑两次，正文哈希一致（允许时间戳类字段差异），审计里能查到当次采样参数。

### 5.5 明确不做的

- **不要为了"学 MeWork"自建服务端会话链**。它是平台代理模式的下游工程，不是引擎改造。等代理真的上线再谈。
- **不要自建推理**。DeepInfer 自己都不含 KV cache 系统与 P/D 分离；律所机房的硬件门槛也够不着。真要私有化，用 vLLM / SGLang + 跑得动的小模型。
- **不要为了省 token 去按轮切工具表**。按第 4 节，这通常是负收益。

## 6 不确定、待核与顺带发现

- **DeepInfer 的能力清单**：包含项（DSpark、SWA 有界重放、异步调度、结构化输出、Attention DP / MoE EP + EPLB）与不含项（KV cache、PD 分离、负载均衡）来自 README 与公开报道，**未逐行核源码**。若要做技术选型，先读 README 的 "not included" 一节再下结论。
- **缓存 usage 字段名**：`prompt_cache_hit_tokens` 与 `prompt_tokens_details.cached_tokens` 两代口径都存在，V4.1 用哪个要以当期 API 文档为准。落地时两个都读，取到哪个算哪个。
- **`turn-admission.ts:160` 注释漂移**：注释写 "starts at 2 and may move inside 1..3"，代码是 `DEFAULT_MODEL_SLOTS = 8`、hard cap 8、429 减半、8 次成功 +1。动这个文件时顺手改注释。
- **`HISTORY_QUALITY_CONTEXT_TOKENS = 200_000`** 与"模型窗口 1M"并存是刻意的（`src/lawmind/agent/context-budget.ts:31`），别在算成本时误用成 1M。
- **"生产级"这类词**：开源 README 的自我描述不能当架构证据。判断标准回到第 1.1 节的两条。

## 7 怎么自己验证

两个实验，一下午能跑完，不需要改产品代码。

**实验 A（缓存）**：同一份 30 页合同 + 同一句指令，跑两个会话。A 全程不触发 `list_more_tools`；B 在第二轮触发一次。记录两边的 `cached_tokens` 与总输入。预期：B 的 cached 占比明显更低。如果两边一样，说明工具表没进前缀，第 5.2 节的优先级要降。

**实验 B（估算）**：取 50 段真实文本（含法条、合同、判决摘录），比 `estimateTextTokens` 与 recipe 编解码的差。预期：中文段高估，英文段接近。偏差方向决定 compact 水位该往哪边挪。

两个实验都不需要动 `turn-orchestrator`，也不触发 cassette 准入要求。做完再决定要不要改代码。
