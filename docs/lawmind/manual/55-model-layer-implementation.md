# 第 55 章 实现精读：模型层

`src/lawmind/models/`（16 个实现文件）加 `src/lawmind/llm/`（3 个）回答一个问题：**模型是怎么被选出来、被限制住、被调用的。**

这一层不负责「写什么」，只负责「用谁写、能用多少 token、失败怎么重试」。

## 55.1 五家供应商与十三个内置模型

### 供应商注册表

`models/providers.ts` 的 `LAWMIND_MODEL_PROVIDERS` 有五家：

| id          | 名称                    | 默认 Base URL                                       | 认的密钥环境变量                                                                    |
| ----------- | ----------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `dashscope` | 阿里云 DashScope / 通义 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `LAWMIND_PROVIDER_DASHSCOPE_API_KEY`、`LAWMIND_QWEN_API_KEY`                        |
| `openai`    | OpenAI                  | `https://api.openai.com/v1`                         | `LAWMIND_PROVIDER_OPENAI_API_KEY`、`OPENAI_API_KEY`                                 |
| `deepseek`  | DeepSeek                | `https://api.deepseek.com/v1`                       | `LAWMIND_PROVIDER_DEEPSEEK_API_KEY`、`LAWMIND_DEEPSEEK_API_KEY`、`DEEPSEEK_API_KEY` |
| `moonshot`  | Moonshot / Kimi         | `https://api.moonshot.cn/v1`                        | `LAWMIND_PROVIDER_MOONSHOT_API_KEY`、`MOONSHOT_API_KEY`                             |
| `zhipu`     | 智谱 AI                 | `https://open.bigmodel.cn/api/paas/v4`              | `LAWMIND_PROVIDER_ZHIPU_API_KEY`、`ZHIPU_API_KEY`                                   |

**规律**：每家都认两组变量——`LAWMIND_PROVIDER_<厂商>_API_KEY`（LawMind 自己的命名）和厂商的原始变量名（比如 `OPENAI_API_KEY`）。所以从别处搬配置过来通常能直接用。

### 十三个内置模型

`models/catalog.ts` 的 `LAWMIND_BUILTIN_MODELS`，按分组：

| id                          | 标签                               | upstream 模型       | 上下文      |
| --------------------------- | ---------------------------------- | ------------------- | ----------- |
| `builtin:deepseek-flash`    | DeepSeek Flash（**推荐、多模态**） | `deepseek-flash`    | **1048576** |
| `builtin:deepseek-chat`     | DeepSeek Chat                      | `deepseek-chat`     | 64000       |
| `builtin:deepseek-reasoner` | DeepSeek Reasoner（推理）          | `deepseek-reasoner` | 64000       |
| `builtin:qwen3.5-plus`      | 通义千问 3.5 Plus                  | `qwen3.5-plus`      | **131072**  |
| `builtin:qwen-plus`         | 通义千问 Plus                      | `qwen-plus`         | 32768       |
| `builtin:qwen-max`          | 通义千问 Max                       | `qwen-max`          | 32768       |
| `builtin:qwen-turbo`        | 通义千问 Turbo                     | `qwen-turbo`        | 8192        |
| `builtin:gpt-4o`            | GPT-4o                             | `gpt-4o`            | 128000      |
| `builtin:gpt-4o-mini`       | GPT-4o mini                        | `gpt-4o-mini`       | 128000      |
| `builtin:o1-mini`           | o1-mini（推理）                    | `o1-mini`           | 128000      |
| `builtin:moonshot-v1-8k`    | Moonshot v1 8K                     | `moonshot-v1-8k`    | 8192        |
| `builtin:glm-4-flash`       | GLM-4 Flash                        | `glm-4-flash`       | 128000      |
| `builtin:glm-4-plus`        | GLM-4 Plus                         | `glm-4-plus`        | 128000      |

**三个默认值常量**：

```text
LAWMIND_DEFAULT_UPSTREAM_MODEL    = "deepseek-flash"
LAWMIND_DEFAULT_BUILTIN_MODEL_ID  = "builtin:deepseek-flash"
LAWMIND_DEFAULT_PLATFORM_MODEL_ID = "platform:deepseek-flash"
```

**上下文从 8192 到 1048576，差 128 倍**。这个数字不是装饰——它决定工具调用上限、历史条数上限、以及提示窗口的缩放系数（第 55.4 节）。

### 一条「退役别名」的处理

```ts
DEEPSEEK_FLASH_RETIRED_ALIASES = ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"];
```

`builtinIdForEnvModelName` 会把这两个名字映射回默认模型。注释没写原因，但意图清楚：**老配置里写的旧模型名不该让系统跑不起来**。

还有两个特殊映射：`qwen3.5-plus` 和 `qwen-plus-latest` 都指向 `builtin:qwen3.5-plus`。

### 平台模型（不用自备 Key）

`models/platform-catalog.ts` 单独一张表，五个模型，前缀是 `platform:`。它们的说明写在一段文档注释里：

> Platform-hosted catalog (Cursor-style): selectable in UI without exposing API keys.
> Keys resolve from `LAWMIND_PLATFORM_*` env or `LAWMIND_PLATFORM_PROXY_URL` + access token.

也就是说：**平台托管的模型在界面上可选，但律师看不到也不需要填 Key**——Key 在平台侧或代理侧。

## 55.2 模型 id 的四个命名空间

`models/resolve.ts` 里有一个关键常量：

```ts
ENV_CURRENT_MODEL_ID = "env:current";
```

所以模型 id 有四种前缀：

| 前缀          | 含义                               | 解析函数                        |
| ------------- | ---------------------------------- | ------------------------------- |
| `builtin:`    | 内置目录里的模型（用你自己的 Key） | `resolveBuiltinToAgentModel`    |
| `custom:`     | 律师加的自定义模型                 | `resolveCustomToAgentModel`     |
| `platform:`   | 平台托管（不用自带 Key）           | `resolvePlatformToAgentModel`   |
| `env:current` | **直接用环境变量里那套配置**       | `resolveEnvCurrentToAgentModel` |

第四种最特殊：它不是「某个模型」，而是「`.env.lawmind` 里 `LAWMIND_AGENT_*` 那一套」。也就是说，**导入的配置会被当成一个虚拟模型看待**——这样界面上的模型选择器能把它当一项列出来。

### `env:current` 的字段来源

| 字段      | 取值顺序                                                                |
| --------- | ----------------------------------------------------------------------- |
| `apiKey`  | `LAWMIND_AGENT_API_KEY`                                                 |
| `model`   | `LAWMIND_AGENT_MODEL` → `LAWMIND_DEEPSEEK_MODEL` → `LAWMIND_QWEN_MODEL` |
| `baseUrl` | `LAWMIND_AGENT_BASE_URL` → `LAWMIND_QWEN_BASE_URL` → DeepSeek 默认地址  |

**注意 `baseUrl` 最后回落到 DeepSeek**——而 `model` 不会回落（前三者都没设就是空的）。所以可能出现「有地址没模型名」的状态，那时会报 `missing_agent_env`。

### 默认模型的选择顺序（八步）

`resolveDefaultModelId` 的顺序：

```text
① models.json 里显式设了 defaultModelId（且配置有效）
② 环境变量里的模型名（LAWMIND_AGENT_MODEL / DEEPSEEK / QWEN）——且对应厂商的 Key 存在
③ 如果该把 env:current 列进目录 → env:current
④ 第一个配置好的平台模型
⑤ builtin:deepseek-flash（且 DeepSeek Key 存在）
⑥ 第一个配置好的内置模型
⑦ 第一个带内联 Key 的自定义模型
⑧ 兜底 builtin:deepseek-flash
```

**第 ② 和第 ⑤ 步都要求「Key 存在」**，这是刻意的：**没 Key 的模型不该被选成默认**，否则第一次调用就失败。

### 四个解析错误码

| 函数                            | 错误码                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| `resolvePlatformToAgentModel`   | `unknown_model` / `invalid_platform_provider` / `missing_platform_api_key` |
| `resolveBuiltinToAgentModel`    | `missing_provider_api_key`                                                 |
| `resolveCustomToAgentModel`     | `missing_api_key`                                                          |
| `resolveEnvCurrentToAgentModel` | `missing_agent_env`                                                        |

**四个都不一样**——因为四种情况的处置方式不同（配平台、配厂商 Key、配自定义 Key、配 env）。

### 一个统一字段

每个解析出来的 `AgentModelConfig` 都会带：

```ts
provider: "openai-compatible";
```

**所有模型都走 OpenAI 兼容协议**。这是这个产品的一条硬选择：不接各家私有 SDK。

### 目录行的顺序

`buildModelCatalog` 的输出顺序是固定的：

```text
[...platforms, ...envRows, ...builtins, ...customs]
```

也就是**平台在前、自定义在后**。分组标签有：`"平台模型"`、`"自定义模型"`、`"自定义 API 端点"`、`"LawMind 平台推理"`。

## 55.3 自定义模型的存储与校验

`models/custom-store.ts` 管 `models.json`（`STORE_FILE = "models.json"`），当前 `CURRENT_SCHEMA_VERSION = 2`。

### 三个校验错误

| 错误码                            | 触发         |
| --------------------------------- | ------------ |
| `custom_model_fields_required`    | 必填字段缺   |
| `custom_model_invalid_model_name` | 模型名不合法 |
| `model_id_required`               | id 缺        |

`custom_model_invalid_model_name` 的判据值得记（**三条任一命中就拒**）：

```text
① 匹配 /^(custom|builtin|platform|env):/i     ← 不许用别人的前缀
② 是纯十六进制且长度 ≥20                       ← 不许像密钥
③ 是带连字符的 UUID 形式                       ← 不许像密钥
```

**②③ 防的是「把 API Key 当模型名填进去」**。这是个很实际的防御——那个字段经常被误填。

### 其他上限

| 项                         | 上限                     |
| -------------------------- | ------------------------ |
| 停止序列（stop sequences） | 8 条（`.slice(0, 8)`）   |
| 新模型 id                  | `custom:${randomUUID()}` |

### 存储里还有什么

`models.json` 不只有模型列表，还有：

- `defaultModelId`（默认模型）
- worker 模型（`setWorkerModelId`）
- 检索模型（`setRetrievalModelId`）
- 起草用模型开关（`setDraftWithModelEnabled`）
- 验证记录（`recordVerification` / `clearVerification` / `listVerifications`）

**「验证记录」是单独存的**：模型连通性探测的结果（第 55.6 节）会记在这里，界面据此显示「已验证」或「未验证」。

## 55.4 能力包络：按上下文窗口伸缩预算

`models/capability-envelope.ts` 是这一层最实用的部分。它的头部注释说明了动机：

> Model-aware capability envelope — scale output, context budget, and tool budgets from the selected model's context window **instead of fixed hard caps**.

也就是说：**不再用固定的硬上限，而是按模型窗口算**。这条设计直接影响了「换个大窗口模型为什么能办更多事」。

### 五个基础常量

| 常量                     | 值                            |
| ------------------------ | ----------------------------- |
| `DEFAULT_CONTEXT_TOKENS` | 128000                        |
| `MAX_OUTPUT_HARD_CAP`    | 65536                         |
| `MIN_OUTPUT_TOKENS`      | 4096                          |
| 上下文下限               | 4096（`Math.max(4096, ...)`） |
| 默认字符/token 换算      | 4                             |

### 输出上限按任务类型定比例

| 任务类型           | 比例             |
| ------------------ | ---------------- |
| `draft` / `review` | **0.25**（最大） |
| `chat` / 默认      | 0.2              |
| `plan`             | 0.15             |
| `classify`         | **0.05**（最小） |

算式：

```text
maxOutputTokens = min(65536, max(4096, override ?? env ?? floor(contextTokens × ratio)))
```

**为什么 `classify` 只有 5%**：分类任务的输出是一个小 JSON，给太多是浪费。而 `draft` 给 25%——写文书确实需要长输出。

### 工具调用上限按窗口分三档

| 上下文   | 每轮工具调用上限 |
| -------- | ---------------- |
| ≥ 100000 | 80               |
| ≥ 32000  | 50               |
| 其他     | 32               |

### 历史条数上限按窗口分四档

| 上下文   | 历史条数 |
| -------- | -------- |
| ≥ 200000 | 120      |
| ≥ 100000 | 100      |
| ≥ 32000  | 80       |
| 其他     | 50       |

### 温度按任务类型

默认值：

| 任务类型            | 温度               |
| ------------------- | ------------------ |
| `classify` / `plan` | **0.15**（最确定） |
| `chat` / 默认       | 0.35               |
| `draft` / `review`  | **0.5**（最自由）  |

覆盖顺序：显式 override（夹在 [0, 1.5]）→ `LAWMIND_AGENT_TEMPERATURE`（同样夹）→ 按任务默认。

**「分类要 0.15、起草要 0.5」是一条很实用的经验**：分类任务要稳定（同一个输入尽量给同一个结果），起草任务要一点自由度（否则每份稿子都一样）。

### 提示窗口的缩放系数

```text
promptWindowScale = min(2.5, max(0.5, contextTokens / 128000))
```

也就是说：以 128k 为基准，**最多放大 2.5 倍、最多缩小 0.5 倍**。

**这个系数作用在哪**：第 43 章讲的 `prompt-fragments.ts` 的 `scaleFragmentCapTokens` —— 每种提示片段（钉选、稿面、协议、技能索引、案件索引、偏好指纹、交付物）的字符上限会按这个系数缩放。所以**窗口越大，每段提示能给的字越多**。

**为什么要夹在 0.5–2.5**：不然 1M 窗口的模型会给出 8 倍上限，反而把预算吃穿。

### 侧车任务的限制

`resolveClassifySidecarLimits` 给「侧车调用」（路由分类、第二意见）返回一组限制：

```text
{ maxTokens: 包络的输出上限, timeoutMs: 包络的模型超时, temperature: classify 的温度 }
```

**它复用包络的输出上限而不是自己定一个**——这样侧车调用也随模型窗口伸缩。

## 55.5 连通性探测

`models/probe.ts` 是一个「尽量小」的探测。它的请求体是：

```json
{
  "model": "...",
  "messages": [{ "role": "user", "content": "Reply with exactly: ok" }],
  "max_tokens": 8,
  "temperature": 0
}
```

**`max_tokens: 8`** —— 探测只要确认「能通」，不要让模型真写东西（费钱）。

**超时取两者较小**：

```text
timeout = Math.min(config.timeoutMs ?? 120000, 60000)
```

也就是探测最多 60 秒——比正常调用更急，因为它是给律师等结果的。

### 五个错误码与人话

| 错误码                | 判据                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `missing_api_key`     | 没配 Key                                                                                                      |
| `invalid_api_key`     | 认证失败（正则 `/authentication fails\|invalid.*api.?key\|incorrect api key\|unauthorized/i` 或状态 401/403） |
| `model_api_error`     | 其他 API 错误                                                                                                 |
| `model_timeout`       | 超时                                                                                                          |
| `model_network_error` | 网络（正则 `/fetch failed\|ENOTFOUND\|ECONNREFUSED\|ETIMEDOUT\|ECONNRESET\|certificate\|TLS/i`）              |

**注意 `invalid_api_key` 的判据是「状态码 + 文本」两条**——因为有的网关返回 200 带错误文本。

还有一个容易踩的情况有专门文案：

```text
模型 API 返回 200 但无有效 choices，请检查模型名与 Key 权限
```

**「返回 200 但没内容」**是最迷惑人的一种失败。这句话把它点明了，而且给出了两个最可能的原因。

## 55.6 模型分层与用量账本

### 三层分类（启发式）

`models/model-tier.ts` 的头部注释先划了边界：

```text
Heuristic Worker / Advisor labels for local usage display.
Not a billing system — no dollar costs.
```

**「不是计费系统、不算钱」**——它只做本地展示。

三档与判据：

| 档        | 正则（节选）                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------- |
| `advisor` | `o1`、`reasoner`、`deepseek-r1`、`qwen-max`、`gpt-4o`（非 mini）、`claude-opus`、`glm-4-plus`、`o3` |
| `worker`  | `turbo`、`flash`、`mini`、`nano`、`haiku`、`qwen-turbo`、`glm-4-flash`                              |
| `general` | 其他                                                                                                |

标签是「Advisor（重推理）」「Worker（快执行）」「通用」。

**这个分层有什么实际用**：主要给界面显示（「你现在用的是重推理模型」），以及给 `models/model-usage.ts` 的分档统计。

### 用量账本

`model-usage.ts` 把每次调用的用量追加到一个账本：

```text
<workspace>/model-usage/ledger.jsonl
```

记录 id 的格式是 `usage-<时间戳>-<6位随机>`。

`summarizeModelUsage` 的默认窗口是 **30 天**，`byModel` 只保留 **前 8 名**，分档顺序固定 `["advisor","worker","general"]`。

`mergeUsageSnapshots` 与 `usageFromProvider` 处理「把不同来源的用量合并」。

**「本地账本」的定位**：头部注释写的是「agentsview-style, workspace-local only」——**只在本工作区，不上报**。

## 55.7 两个「开关型」模型配置

### 起草用模型（`draft-reasoning.ts`）

它决定「起草要不要用模型」。判据（注释原文）：

```text
- model / unset：在具备 LLM 凭据时启用
- keyword / off / 0 / false：强制关闭
```

**注意「unset 等于启用」**——默认是走模型的，只有显式写了 `keyword` / `off` 才关。

它的配置里两个默认值是：

```text
temperature: 0.2
timeoutMs: model.timeoutMs ?? 90000
```

**0.2 的温度**说明：起草用模型时温度调低了（对比包络里 draft 的 0.5）。这两个数字不一致——**包络的 0.5 是通用默认，起草这份配置更保守**。

### 路由用模型（`router-reasoning.ts`）

同一套开关逻辑，区别在：

| 项         | 值                                            |
| ---------- | --------------------------------------------- |
| `taskKind` | `"classify"`                                  |
| 温度       | 从 `LAWMIND_ROUTER_TEMPERATURE`（**无默认**） |
| 超时       | 从 `LAWMIND_ROUTER_TIMEOUT_MS`（**无默认**）  |

**它没有默认温度**，所以会落到包络里 `classify` 的 0.15。

### 一条「关键词只作回退」的原则

`router-reasoning.ts` 的文档注释：

```text
- model / unset：具备 LLM 凭据时启用（关键词仅作失败回退）
```

**「关键词仅作失败回退」**——这是设计意图。关键词路由表（第 58 章那 32 条）是兜底，不是主路。

## 55.8 检索分流：single vs dual

`models/retrieval-split.ts` 只有两个导出，但对应一个产品选择。头部注释：

```text
Split vs shared retrieval: one general chat model, or a dedicated legal-retrieval model.
```

| 模式             | 含义                   |
| ---------------- | ---------------------- |
| `single`（默认） | 用同一个通用模型做检索 |
| `dual`           | 单独配一个法律检索模型 |

超时默认 `model.timeoutMs ?? 120000`。

**`dual` 的用法**：如果你有一个专门的法律垂类模型（比如本地的 ChatLaw），可以只把它用在检索上，对话仍用通用模型。

**默认是 `single`**：不给律师增加配置负担。

## 55.9 决策模型端口：默认关闭且离线不可用

`models/decision-model.ts` 是这一层最谨慎的一个。它的头部注释解释了为什么它是一个「端口」而不是「接入某家服务」：

```text
计划 §8 给的引入理由只有一条：作为 P2.3 分歧驱动的第三条独立判定器。
而分歧驱动的价值来自独立性——Jev 是另一家厂商、另一种训练目标（RLCD vs RLHF）、
另一种模态（不生成），所以它的分歧信号信息量最大。
```

也就是说：**引入它的价值来自「它和现有判定器不同」**，而不是「它更准」。

### 解析顺序：先查离线（第 ① 步）

```text
① resolveEgressMode(policy) === "offline" → { mode: "off", reason: "egress_offline" }
② 三态解析（policy → env → ""）
③ 凭据（baseUrl / apiKey / model，policy 优先，再 env）
④ 超时（LAWMIND_DECISION_MODEL_TIMEOUT_MS，默认 8000）
```

**第 ① 步在「读任何其他配置」之前**——所以离线模式下这个能力**根本不会被启用**，而不是「启用了但用不了」。

五种 reason：

| reason                | 含义                     |
| --------------------- | ------------------------ |
| `egress_offline`      | 离线模式（第一步就返回） |
| `disabled_by_default` | 三态解析出「关」（默认） |
| `missing_credentials` | 凭据不全                 |
| `enabled`             | 开启                     |
| `shadow`              | 影子（只记录）           |

### 三态解析

| 输入                                | 结果                           |
| ----------------------------------- | ------------------------------ |
| `""` / `off` / `0` / `false` / `no` | `off`（`disabled_by_default`） |
| `on` / `1` / `true`                 | `on`                           |
| 其他非空                            | `shadow`                       |

**「其他非空值当 shadow」**是个保守做法：写错了拼写不会变成「开启」。

### 端点与模型名

```text
endpoint = ${baseUrl}/v1/systemone
model id = typesafe.${config.model}
kind     = "typesafe"
```

`createTypesafeDecisionModel` 走 `createOutboundProxy({requestTag: "decision-model"})`（第 15 章那个统一出口），**任何失败都返回 `undefined`**，不抛。

### 答案解析的四条过滤

`parseSystemOneAnswers` 对每条答案做校验，**不合法就丢掉那一条**：

| 字段         | 校验                                       |
| ------------ | ------------------------------------------ |
| `noul` 概率  | 夹到 [0, 1]                                |
| `choice`     | 必须在 `question.options` 里，否则丢       |
| `score`      | 必须在 `[scale.min, scale.max]` 里，否则丢 |
| `confidence` | 夹到 [0, 1]                                |
| `questionId` | 未知的丢                                   |

默认分布：`{ [choice]: 1 }` 或 `{ [String(score)]: 1 }`。

**「不合法就丢」而不是「纠正」**：这是外部模型给的判断，纠正是越权。

## 55.10 `llm/`：三个底层工具

`llm/` 只有三个文件，但它们是「所有侧车调用」的共同底座。

### `openai-json.ts`

头部注释：

```text
Minimal OpenAI-compatible JSON chat completion helper (LawMind internal).
Used by model-driven router / reasoning when retrieval adapters are not involved.
```

`completeJsonObject<T>` 的签名：

```ts
completeJsonObject<T>(cfg, messages, opts?: { schema?, env? }): Promise<T | null>
```

**返回 `null` 而不是抛错**——调用方拿到 `null` 就知道「这次没拿到」，然后走回退。

它的行为里有三处值得细看。

**第一处：严格 schema 的降级不消耗采样预算。**

```text
如果响应是 400 且文本像「拒绝 strict schema」
  → markStrictSchemaRejected(baseUrl)（把这个主机记进拒绝缓存）
  → responseFormat 改成 json_object
  → attempt -= 1        ← 关键：不消耗配额
  → continue
```

注释写着「does not consume sampling budget」。**这条很重要**：如果降级消耗配额，那么一个不支持严格 schema 的主机会把三次配额都用在「试了又失败」上。

**第二处：不符合 schema 时重采样。**

```text
shouldResampleSidecarJson({ parsed, truncated, attempt, attempts })
```

判定依据里有一个 `truncated`（输出看起来被截断）。**「被截断的 JSON」和「格式错的 JSON」不同**——前者重采样有意义（加点预算可能就出来了），后者重采样也是白搭。

**第三处：三个「配置从环境变量拼」的构造函数。**

| 函数                                | 用途                              | taskKind   |
| ----------------------------------- | --------------------------------- | ---------- |
| `routerLlmConfigFromEnv`            | 路由分类                          | `classify` |
| `reasoningLlmConfigFromEnv`         | 推理（允许回落聊天凭据）          | `review`   |
| `reasoningLlmConfigExplicitFromEnv` | 推理（**只认 REASONING\_ 前缀**） | `review`   |

**第三个没有回落**。所以「想只用专用推理模型、不借用聊天凭据」时用它。

三者的回落链都是：`LAWMIND_ROUTER_*` / `LAWMIND_REASONING_*` → `LAWMIND_AGENT_*` → `QWEN_*`。

**`QWEN_*` 是最后一层回落**——说明通义千问曾是默认配置，现在是历史兼容。

还有一个细节：它剥代码围栏（`/^```json\s*/i`、`/^```\s*/i`、`/\s*```$/`）。**模型经常把 JSON 包在围栏里**，不剥就解析不了。

### `json-schema-capability.ts`：一个空名单

这个文件很重要，因为它的**核心常量是空数组**：

```ts
KNOWN_STRICT_SCHEMA_HOSTS: ReadonlyArray<string> = [];
```

注释解释了现状：

```text
目前为空数组——即 P2.1 落地后的默认行为与升级前一致
```

也就是说：**机制做好了，但没有一个主机被判为「确定支持严格 schema」**。所以默认全都走 `json_object`。

### 为什么需要这个机制

头部注释讲清了背景：

```text
`response_format: { type: "json_object" }` 只保证「产出是 JSON」，
不保证「字段名对、枚举值在集合内」。所以调用方（路由分类、Guardian）至今仍需
自己再校验一遍并把非法值丢掉——`router/model-route.ts` 的 `isTaskKind()` 就是这道补丁。
```

**这句话解释了一个常见困惑**：「我都写了 JSON schema，为什么还要校验？」因为 `json_object` 模式不保证结构。

### 六步判定

`resolveJsonSchemaMode(baseUrl, env)` 的顺序：

```text
① LAWMIND_LLM_JSON_SCHEMA = off/0/false/no  → json_object（env_forced_off）
② 主机名为空                                 → json_object（empty_base_url）
③ 主机在「曾被拒绝」缓存里                    → json_object（previously_rejected）
④ env = on/1/true/yes                        → json_schema（env_forced_on）
⑤ 主机在已知支持名单里（现在是空的）           → json_schema（known_supported_host）
⑥ 其他                                       → json_object（unknown_host_default_json_object）
```

**「曾经被拒绝」这一档**（第 ③ 步）是这个机制的关键：**第一次试错之后就不用再试了**。

### 拒绝缓存的形状

```text
strictRejectedHosts = new Set<string>()    ← 模块级内存，跨调用存活
markStrictSchemaRejected(baseUrl) → 只在「首次插入」时返回 true
resetStrictSchemaRejectionCache()          ← 测试用
listStrictSchemaRejectedHosts()            ← 返回排序后的列表
```

**只在首次插入时返回 true** —— 所以调用方知道「这是第一次降级」（值得记一条日志），而不是每次都记。

缓存的键是 `hostOf(baseUrl)`（`new URL(...).host.toLowerCase()`，失败时手工剥协议与路径）。

### 拒绝的判据

```text
looksLikeStrictSchemaRejection(status, body):
  status !== 400 → false
  否则 /json_schema|response_format|strict/i.test(body)
```

**只在 400 时判**，而且文本里要有那几个词之一。这个判据窄而准——**不会把别的 400 误判成「不支持严格 schema」**。

### `http-retry.ts`：三个常量的取舍

| 常量                        | 值         | 注释里的理由                                                                                 |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `DEFAULT_MODEL_MAX_RETRIES` | **2**      | 「DeepSeek harness 重试 EMPTY/TRANSPORT 两次；Codex 默认 4；本运行时一直用 2，保持这个预算」 |
| 退避基数                    | **400 ms** | —                                                                                            |
| 尝试上限（指数用）          | **6**      | 防指数爆炸                                                                                   |

`modelAttemptBudget()` = `1 + maxRetries` = **3 次尝试**。

**那条注释本身很有价值**：它记录了这个数字是「对齐别人的实现 + 保持自己的一致性」的结果，不是拍脑袋。

### 延迟与抖动

```text
cappedAttempt = min(attempt, 6)
exponential   = 400 × 2^cappedAttempt
jitter        = floor(random() × 400)
delay         = exponential + jitter
```

**有抖动**是为了避免多个并发请求同时重试（惊群）。

### 什么该重试

`isRetryableHttpFailure`：

| 状态              | 重试 |
| ----------------- | ---- |
| 429               | ✅   |
| ≥ 500             | ✅   |
| 400–499（除 429） | ❌   |
| `AbortError`      | ✅   |
| 消息含网络类词    | ✅   |

**「4xx 不重试（除 429）」是对的**：参数错、认证失败这类重试多少次都一样，只会浪费时间和钱。

### 两条「不重试」的硬规则

`shouldRetryTransportFailure` 开头两条：

```text
opts.signal?.aborted → false
err.name === "ModelCallUserAbortError" → false
```

**用户中断永远不重试**。否则律师点了停止，系统还在后台重试。

## 55.11 已知坑（本章相关）

- **所有模型都走 OpenAI 兼容协议。** 没有私有 SDK。
- **`LAWMIND_DEFAULT_UPSTREAM_MODEL = "deepseek-flash"`。** 换默认要改三处常量。
- **模型 id 有四种前缀**（`builtin:` / `custom:` / `platform:` / `env:current`），它们不是同一种东西。
- **`env:current` 不是模型，是「环境变量里那套配置」的虚拟项。**
- **默认模型的选择要求「Key 存在」。** 没 Key 的不会被选成默认。
- **自定义模型名会拒绝「像密钥」的值**（纯十六进制长串、UUID 形态）。
- **输出上限按任务类型有比例**（classify 5%、draft 25%）。
- **温度：分类 0.15、起草 0.5。** 但起草那份独立配置用的是 0.2（不一致，按使用的路径为准）。
- **提示窗口缩放夹在 0.5–2.5。** 别去掉这个夹。
- **探测的 `max_tokens` 是 8。** 那是刻意的小。
- **探测超时最多 60 秒**（比正常调用更急）。
- **模型分层不算钱。** 它不是计费系统。
- **用量账本只在本工作区，不上报。**
- **决策模型默认关，且离线模式下第一步就返回 `egress_offline`。**
- **决策模型的答案「不合法就丢」，不纠正。**
- **`KNOWN_STRICT_SCHEMA_HOSTS` 现在是空的。** 所以全都走 `json_object`，调用方仍要自己校验。
- **严格 schema 降级不消耗采样预算。**
- **`completeJsonObject` 失败返回 `null`，不抛。**
- **用户中断永远不重试。**
- **4xx（除 429）不重试。**
