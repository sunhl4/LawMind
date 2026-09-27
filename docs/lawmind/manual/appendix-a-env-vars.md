# 附录 A 环境变量全表

本附录按用途分组列出仓库里出现过的 `LAWMIND_*` 环境变量。**提取方式是机械的**（`rg -o "LAWMIND_[A-Z0-9_]+"`），所以主体就是代码里真实存在的变量名——但这类提取有两个已知盲点，用之前值得知道：

- **它会剥掉前缀**：`VITE_LAWMIND_INTERNAL_EXPERIMENT_UI` 在代码里全名带 `VITE_`（`apps/lawmind-desktop/src/renderer/global.d.ts:7`），本表里写的是去前缀的形式。从 Vite 前端读的变量都要按实际全名写。
- **它会漏掉不在同名字面量里的读取**（例如经对象/动态键访问的），也可能混进表名里出现过、但代码里并不存在的名字。**拿这份表当线索，不要当凭证**——真要确认某个变量有没有用，`rg` 一次最稳。

用法说明：

- 带「默认」的都标了默认值；没标的是代码里没设默认（要么必填，要么不设即视为关闭/未配置）。
- 影响行为的关键变量，在「说明」里点明了后果。
- 分三张表：**你自己要配的**、**引擎调参用的**、**内部/测试用的**。

## A.1 你要配的（日常使用）

### 模型与推理

| 变量                           | 说明                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `LAWMIND_AGENT_API_KEY`        | 主模型 API Key。首次配置写进密钥链后会从环境文件抹掉           |
| `LAWMIND_AGENT_BASE_URL`       | 主模型 Base URL                                                |
| `LAWMIND_AGENT_MODEL`          | 主模型名                                                       |
| `LAWMIND_AGENT_MAX_TOKENS`     | 单次最大输出 token                                             |
| `LAWMIND_AGENT_TEMPERATURE`    | 采样温度                                                       |
| `LAWMIND_AGENT_TIMEOUT_MS`     | 模型调用超时，默认 120000                                      |
| `LAWMIND_AGENT_MAX_TOOL_CALLS` | 每轮工具调用上限，默认 80（上限也是 80）                       |
| `LAWMIND_MODEL_CONTEXT_TOKENS` | 上下文窗口大小，默认 128000                                    |
| `LAWMIND_MODEL_PROVIDERS`      | **不是环境变量**。`models/providers.ts` 里的常量数组，设了无效 |

### 国内供应商（一键预设）

| 变量                                                                    | 说明                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `LAWMIND_QWEN_API_KEY` / `LAWMIND_QWEN_BASE_URL` / `LAWMIND_QWEN_MODEL` | 通义千问 / DashScope                                           |
| `LAWMIND_DEEPSEEK_API_KEY` / `LAWMIND_DEEPSEEK_MODEL`                   | DeepSeek                                                       |
| `LAWMIND_GLM_API_KEY` / `LAWMIND_GLM_MODEL`                             | 智谱 GLM                                                       |
| `LAWMIND_MOONSHOT_API_KEY` / `LAWMIND_MOONSHOT_MODEL`                   | Moonshot                                                       |
| `LAWMIND_SILICONFLOW_API_KEY` / `LAWMIND_SILICONFLOW_MODEL`             | 硅基流动                                                       |
| `LAWMIND_PROVIDER_DEEPSEEK_API_KEY` 等 `LAWMIND_PROVIDER_*_API_KEY`     | 平台代理形态的供应商密钥（对应 `LAWMIND_PLATFORM_PROVIDER_*`） |

### 法律垂类模型（可选）

| 变量                                                                                               | 说明                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `LAWMIND_CHATLAW_API_KEY` / `LAWMIND_CHATLAW_BASE_URL` / `LAWMIND_CHATLAW_MODEL`                   | ChatLaw                              |
| `LAWMIND_LAWGPT_API_KEY` / `LAWMIND_LAWGPT_BASE_URL` / `LAWMIND_LAWGPT_MODEL`                      | LawGPT（本地部署时密钥可写 `local`） |
| `LAWMIND_LEXEDGE_ENDPOINT` / `LAWMIND_LEXEDGE_TOKEN`                                               | LexEdge                              |
| `LAWMIND_PARTNER_LEGAL_API_KEY` / `LAWMIND_PARTNER_LEGAL_BASE_URL` / `LAWMIND_PARTNER_LEGAL_MODEL` | 合作方法律模型                       |

### 检索与法源

| 变量                                                             | 说明                                                                                               | 默认                                            |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `LAWMIND_AUTHORITY_PROVIDER`                                     | 法源路由：`open` / `generic` / `pkulaw` / `lexis`                                                  | `open`                                          |
| `LAWMIND_AUTHORITY_ENDPOINT`                                     | 商业法源端点（generic / pkulaw / lexis 需要）                                                      | 无                                              |
| `LAWMIND_AUTHORITY_API_KEY`                                      | 商业法源密钥（BYOK）                                                                               | 无                                              |
| `LAWMIND_AUTHORITY_CITATION_VALIDATE`                            | 开启引用核验（`1`/`true`/`yes`）                                                                   | 关                                              |
| `LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH`                       | 引用核验的专用路径                                                                                 | 无                                              |
| `LAWMIND_OPEN_LAW_MODE`                                          | 开源语料车道：`local` / `npc_flk` / `caseopen` / `courtlistener` / `eurlex` / `egov_jp` / `hybrid` | 有直播车道则 hybrid，否则 local                 |
| `LAWMIND_OPEN_LAW_NPC`                                           | 开国家法律法规数据库直播（**设 `0` 才关**）                                                        | 开                                              |
| `LAWMIND_OPEN_LAW_NPC_ENDPOINT`                                  | NPC 端点覆盖                                                                                       | `https://flk.npc.gov.cn/law-search/search/list` |
| `LAWMIND_OPEN_LAW_CORPUS`                                        | 外部语料 JSONL 绝对路径                                                                            | 无                                              |
| `LAWMIND_OPEN_LAW_CORPUS_DEMO`                                   | `1` 时外部语料整体按演示处理                                                                       | 无（未标注的语料一律按演示）                    |
| `LAWMIND_OPEN_LAW_CASEOPEN`                                      | 自建类案库                                                                                         | 关                                              |
| `LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT`                             | 类案端点                                                                                           | `http://127.0.0.1:8081/api/search`              |
| `LAWMIND_OPEN_LAW_COURTLISTENER`                                 | CourtListener 直播                                                                                 | 关                                              |
| `LAWMIND_OPEN_LAW_COURTLISTENER_ENDPOINT`                        | 端点覆盖                                                                                           | 官方 v4 search                                  |
| `LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN`                           | API token                                                                                          | 无                                              |
| `LAWMIND_OPEN_LAW_EURLEX` / `LAWMIND_OPEN_LAW_EURLEX_ENDPOINT`   | EUR-Lex                                                                                            | 关                                              |
| `LAWMIND_OPEN_LAW_EGOV_JP` / `LAWMIND_OPEN_LAW_EGOV_JP_ENDPOINT` | 日本 e-Gov                                                                                         | 关                                              |
| `LAWMIND_PKULAW_MODE`                                            | 法宝协议：`rest_compat` / `search_post` / `mcp_tools_call`                                         | `rest_compat`                                   |
| `LAWMIND_PKULAW_MCP_LAW_TOOL` / `LAWMIND_PKULAW_MCP_CASE_TOOL`   | MCP 工具名                                                                                         | `search_article` / `search_case`                |
| `LAWMIND_PKULAW_CASE_ENDPOINT`                                   | 案例端点（缺省同法规端点）                                                                         | 无                                              |
| `LAWMIND_COMPANY_REGISTRY_URL` / `LAWMIND_COMPANY_REGISTRY_KEY`  | 工商查询源（solo 版无内置）                                                                        | 无                                              |
| `LAWMIND_ALLOW_CROSS_MATTER_SEARCH`                              | `1` 开启跨案先例检索（**伦理墙默认关**）                                                           | 关                                              |
| `LAWMIND_ALLOW_INDEX_REBUILD`                                    | `1` 允许通过 API 重建索引。独立拉起的服务默认关；桌面壳拉起本机 API 时会注入 `1`                   | 独立服务关；桌面注入开                          |
| `LAWMIND_RETRIEVAL_MODE`                                         | 检索通道：`single` / `dual`                                                                        | `single`                                        |
| `LAWMIND_RETRIEVAL_TIMEOUT_MS`                                   | 检索超时。未设则回落 `LAWMIND_AGENT_TIMEOUT_MS`，再回落 120000                                     | 120000                                          |
| `LAWMIND_RECALL_PREFER_SMALL_FILES`                              | 偏好小文件召回                                                                                     | 无                                              |
| `LAWMIND_EMBEDDING_ENABLED`                                      | 开启本地 embedding 桩（**不是语义模型**）                                                          | 关                                              |
| `LAWMIND_EMBEDDING_MODEL` / `LAWMIND_EMBEDDING_DIMS`             | 模型名与维度                                                                                       | `local-hash-stub-v1` / 64                       |

### 联网检索

| 变量                         | 说明                               |
| ---------------------------- | ---------------------------------- |
| `LAWMIND_WEB_SEARCH_API_KEY` | 联网搜索密钥（Brave）              |
| `BRAVE_API_KEY`              | 同上（Brave 官方变量名，两者都认） |
| `LAWMIND_VISION_MODEL`       | 视觉模型（图片兜底读取用）         |
| `LAWMIND_OCR_CLOUD`          | `1` 时启用云 OCR（需供应商密钥）   |
| `LAWMIND_OCR_LANGS`          | OCR 语言包                         |

### 邮箱

| 变量                               | 说明                                               |
| ---------------------------------- | -------------------------------------------------- |
| `LAWMIND_MAIL_SECRETS_KEY`         | 邮箱密钥的加密密钥                                 |
| `LAWMIND_MAIL_GRAPH_CLIENT_SECRET` | Graph 应用密钥                                     |
| `LAWMIND_MAIL_SEED`                | `1` 时注入演示邮件（**仅开发**，否则相关端点 403） |
| `LAWMIND_GRAPH_CLIENT_ID`          | Graph 客户端 id                                    |

### 版本、策略与出口

| 变量                                                                   | 说明                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `LAWMIND_EDITION`                                                      | `solo` / `firm` / `private_deploy`（policy 文件优先于它）                                               |
| `LAWMIND_CITATION_MODE`                                                | `grounded` / `assisted` / `off`                                                                         |
| `LAWMIND_POLICY_FORCE_NO_WEB_SEARCH`                                   | 由策略文件写入，`1` 表示强制关联网                                                                      |
| `LAWMIND_HOST_ACCESS_MODE`                                             | 已忽略。解析结果固定为 `command`（本机查找 + 命令），策略文件里的窄档位同样不再生效                     |
| `LAWMIND_HOST_ACCESS_FILE`                                             | 本机挂载授权文件路径                                                                                    |
| `LAWMIND_HOST_COMMANDS`                                                | 已忽略。本机命令默认可用。不是命令白名单；`bash` / `sudo` / `curl` 仍拒绝                               |
| `LAWMIND_PROJECT_DIR`                                                  | 关联项目目录                                                                                            |
| `LAWMIND_KEY_DIR`                                                      | 本机密钥目录，默认 `~/.lawmind/keys`                                                                    |
| `LAWMIND_PRIVILEGE_SENTINEL`                                           | `0`/`false` 关闭特权提示                                                                                |
| `LAWMIND_LEGAL_GUARDIAN`                                               | `0`/`false`/`off`/`no` 关闭独立审稿                                                                     |
| `LAWMIND_GUARDIAN_TRACKED_REDLINE`                                     | `block` / `advisory`（修订稿独立审稿档位）                                                              |
| `LAWMIND_JUDGMENT_TIERING`                                             | `off` / `shadow` / `on`                                                                                 |
| `LAWMIND_JUDGMENT_ESCALATION`                                          | `off` / `on`                                                                                            |
| `LAWMIND_JUDGMENT_ESCALATION_POSTURE`                                  | `advisory` / `block`                                                                                    |
| `LAWMIND_JUDGMENT_DISABLED_VERIFIERS`                                  | 禁用的机器验证器 id 列表                                                                                |
| `LAWMIND_DECISION_MODEL_MODE`                                          | `off` / `shadow` / `on`                                                                                 |
| `LAWMIND_DECISION_MODEL_BASE_URL` / `_API_KEY` / `_ID` / `_TIMEOUT_MS` | 决策模型配置                                                                                            |
| `LAWMIND_ROUTE_DIVERGENCE` / `LAWMIND_ROUTE_DIVERGENCE_POSTURE`        | 主开关 `0`/`false`/`off` 关掉记录。姿态是 `off` / `shadow`（默认）/ `escalate`，不是 `advisory`/`block` |
| `LAWMIND_PROMPT_VERBOSITY`                                             | `compact` / `full`                                                                                      |
| `LAWMIND_INTAKE`                                                       | 交办澄清相关开关                                                                                        |

### 审计

| 变量                                | 说明                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `LAWMIND_AUDIT_CHAIN_KEY`           | 审计链 HMAC 密钥（64 hex，**必须放在工作区外**）。没有 `LAWMIND_AUDIT_HASH_CHAIN_KEY` 这个别名，设了不读 |
| `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL` | 审计外锚地址（`file://` 或 HTTP PUT）                                                                    |

### 技能签名

| 变量                           | 说明                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `LAWMIND_SKILL_SIGNING_SECRET` | 技能签名密钥（**生产必须用真密钥**，不能用派生兜底值） |

### 本机服务与桌面

| 变量                                           | 说明                                                                                                           | 默认                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `LAWMIND_LOCAL_API_TOKEN`                      | 历史共享令牌（**仅开发/E2E**，打包态仍走派生鉴权）                                                             | 无                                                                            |
| `LAWMIND_SKIP_API_AUTH`                        | `1` 跳过本机 API 鉴权（**打包态强制忽略**）                                                                    | 关                                                                            |
| `LAWMIND_LOCAL_API_CLIENTS_FILE`               | CLI 凭据文件位置                                                                                               | `<userData>/LawMind/local-api-clients.json`（开发态常在 `Electron/LawMind/`） |
| `LAWMIND_LOCAL_HOST` / `LAWMIND_LOCAL_HOST_V6` | **不是环境变量**。监听地址写死在 `lawmind-server-helpers.ts`                                                   | `127.0.0.1` / `::1`                                                           |
| `LAWMIND_DESKTOP_PORT`                         | 本机 API 端口（非 headless 必填）                                                                              | 无                                                                            |
| `LAWMIND_WORKSPACE_DIR`                        | 工作区路径（多数 CLI 必填）                                                                                    | 无                                                                            |
| `LAWMIND_ENV_FILE`                             | 环境文件路径                                                                                                   | 无                                                                            |
| `LAWMIND_USER_DATA_DIR`                        | 用户数据目录（**仅开发态生效**）                                                                               | 无                                                                            |
| `LAWMIND_ALLOW_MULTI_INSTANCE`                 | `1` 关闭单实例锁（**仅开发态**）                                                                               | 关                                                                            |
| `LAWMIND_DEVTOOLS`                             | `1` 打开停靠式开发者工具                                                                                       | 关                                                                            |
| `LAWMIND_SKIP_AUTO_UPDATE`                     | `1` 关闭应用内更新                                                                                             | 关                                                                            |
| `LAWMIND_DOWNLOAD_PAGE_URL`                    | 下载页地址                                                                                                     | jsDelivr 上的页面                                                             |
| `LAWMIND_DESKTOP_ACTOR_ID`                     | 审计归属，默认 `lawyer:desktop`                                                                                | —                                                                             |
| `LAWMIND_ENGINE_ACTOR_ID`                      | 只给 CLI / 引擎规划审稿兜底（高于 `DESKTOP`，再缺省 `lawyer:system`）。桌面审计只读 `LAWMIND_DESKTOP_ACTOR_ID` | 无                                                                            |
| `LAWMIND_PACKAGED`                             | 打包态标记，由桌面壳给本机服务端子进程设 `1`                                                                   | 无                                                                            |
| `LAWMIND_ENABLE_COLLABORATION`                 | `false` 关闭协作                                                                                               | 开                                                                            |
| `LAWMIND_REPO_ROOT`                            | 仓库根（开发/CLI）                                                                                             | 无                                                                            |

### 打包与签名

| 变量                                                         | 说明                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `LAWMIND_OFFICECLI`                                          | officecli 可执行文件路径                                                                                      |
| `LAWMIND_OFFICECLI_BIN` / `LAWMIND_OFFICECLI_VERSION`        | 打包辅助                                                                                                      |
| `LAWMIND_VENDOR_OFFICECLI` / `LAWMIND_SKIP_OFFICECLI_VENDOR` | vendor 控制                                                                                                   |
| `LAWMIND_RESOURCES_PATH`                                     | 打包资源目录                                                                                                  |
| `LAWMIND_NODE_BIN` / `LAWMIND_DESKTOP_NODE_VERSION`          | 打包用的 Node                                                                                                 |
| `LAWMIND_MAC_SIGN_IDENTITY` / `CSC_NAME`                     | macOS 签名身份                                                                                                |
| `LAWMIND_REQUIRE_NOTARIZED`                                  | `1` 时未公证直接让构建失败                                                                                    |
| `LAWMIND_APP_DATA_DIR`                                       | CLI 发现文件用的目录。`LAWMIND_APP_ID` / `LAWMIND_PRODUCT_NAME` 来自 `branding/manifest.json`，设环境变量无效 |

## A.2 引擎调参（一般不用动）

### 护栏

| 变量                                             | 说明                                                                    | 默认   |
| ------------------------------------------------ | ----------------------------------------------------------------------- | ------ |
| `LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` | 允许危险工具免审批。`strictDangerousToolApproval` 为真（firm 等）时无效 | 无     |
| `LAWMIND_TOOL_SANDBOX`                           | `1` 开启工具沙箱                                                        | 关     |
| `LAWMIND_TOOL_SANDBOX_INLINE`                    | `1` 强制 inline（测试用）                                               | 无     |
| `LAWMIND_TOOL_TIMEOUT_MS`                        | 工具超时（0 表示不限）                                                  | 0      |
| `LAWMIND_MAX_TOOL_CONCURRENCY`                   | 工具并发上限                                                            | 4      |
| `LAWMIND_READONLY_WORKER_MAX_ROUNDS`             | 只读 worker 轮数上限（夹到 12）                                         | 5      |
| `LAWMIND_TOOL_RESULT_TOKEN_LIMIT`                | 单个工具结果的 token 上限。未设按窗口 1/8，回落 8000，上限 200000       | 8000   |
| `LAWMIND_COLLAB_STEP_TIMEOUT_MS`                 | 工作流单步超时（夹 30s–1h）                                             | 900000 |
| `LAWMIND_AUTO_DELIVERABLE_WF`                    | 自动交付物工作流。`0`/`false`/`off`/`no` 才关                           | 开     |
| `LAWMIND_ALLOW_RENDER_GATE_BYPASS`               | 允许绕过渲染门（慎用）                                                  | 无     |
| `LAWMIND_ALLOW_CHECKLIST_BYPASS`                 | 允许绕过必核清单（慎用）                                                | 无     |
| `LAWMIND_ALLOW_STALE_COVERAGE`                   | 允许陈旧覆盖率                                                          | 无     |
| `LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER`            | 允许强制渲染                                                            | 无     |

### 上下文与压缩

| 变量                         | 说明                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `LAWMIND_COMPACT_LLM`        | 用 LLM 增强压缩摘要                                          |
| `LAWMIND_STRICT_TOOL_STREAM` | 严格工具流式（默认被设成 `0`）                               |
| `LAWMIND_DOC_READ_MODE`      | 文档读取模式                                                 |
| `LAWMIND_CHARS_PER_TOKEN`    | 字符/token 换算（估算用），未设为 4                          |
| `LAWMIND_CONTEXT_TUNING`     | JSON，覆盖策略文件的 `context.*`。policy 缺 `context` 时才读 |
| `LAWMIND_LLM_JSON_SCHEMA`    | JSON schema 能力覆盖，默认 `auto`                            |

### 改稿幅度门

| 变量                                  | 说明                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `LAWMIND_SURGICAL_ENFORCE`            | `1`/`true`/`on` 只进指标与教练。产品路径不按字数拒稿，不拦截 `update_draft` |
| `LAWMIND_SURGICAL_MAX_ABS_CHAR_DELTA` | 绝对字符差上限（默认 400）                                                  |
| `LAWMIND_SURGICAL_MAX_RATIO`          | 相对比例上限（默认 0.25）                                                   |

### 路由与模型角色

| 变量                                                                                                                                                                                 | 说明                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `LAWMIND_ROUTER_MODE` / `LAWMIND_ROUTER_MODEL` / `LAWMIND_ROUTER_BASE_URL` / `LAWMIND_ROUTER_API_KEY` / `LAWMIND_ROUTER_TEMPERATURE` / `LAWMIND_ROUTER_TIMEOUT_MS`                   | 路由模型配置                                                                                                       |
| `LAWMIND_REASONING_MODE` / `LAWMIND_REASONING_MODEL` / `LAWMIND_REASONING_BASE_URL` / `LAWMIND_REASONING_API_KEY` / `LAWMIND_REASONING_TEMPERATURE` / `LAWMIND_REASONING_TIMEOUT_MS` | 推理模型配置                                                                                                       |
| `LAWMIND_DEFAULT_UPSTREAM_MODEL` / `LAWMIND_DEFAULT_BUILTIN_MODEL_ID` / `LAWMIND_DEFAULT_PLATFORM_MODEL_ID` / `LAWMIND_BUILTIN_MODELS` / `LAWMIND_PLATFORM_MODELS`                   | **不是环境变量**。`models/catalog.ts` 与 `platform-catalog.ts` 里的常量                                            |
| `LAWMIND_DECISION_MODEL_API_KEY` / `LAWMIND_DECISION_MODEL_ID`                                                                                                                       | 判定模型（`models/decision-model.ts`、`policy/workspace-policy.ts`）。密钥也可写进策略文件的 `decisionModelApiKey` |

**注意：没有 `LAWMIND_WORKER_MODEL` 这个环境变量。** 设置页里的更快模型存在工作区模型设置的 `workerModelId`（`models/custom-store.ts`、`models/types.ts`），只用于审稿和回合内摘要，不接管对话里的工具循环。照 `LAWMIND_WORKER_MODEL` 去 grep 会一无所获。

### 平台代理（私有化/商业通道）

| 变量                                                           | 说明                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `LAWMIND_PLATFORM_PROXY_URL`                                   | 平台代理地址                                                             |
| `LAWMIND_PLATFORM_API_TOKEN` / `LAWMIND_PLATFORM_ACCESS_TOKEN` | 代理凭据                                                                 |
| `LAWMIND_PLATFORM_AUTHORITY_PROXY`                             | 法源走代理                                                               |
| `LAWMIND_PLATFORM_PROVIDER_*_API_KEY`                          | 代理形态的供应商密钥（DASHSCOPE / DEEPSEEK / MOONSHOT / OPENAI / ZHIPU） |
| `LAWMIND_PLATFORM_QWEN_API_KEY`                                | DashScope 的**别名**（`models/platform-providers.ts` 两名字都认）        |
| `LAWMIND_COMMERCIAL_BFF_PORT`                                  | 商业 BFF 端口                                                            |
| `LAWMIND_BUILD_CHANNEL`                                        | `oss` / `commercial`。只在进程启动时读取；策略文件改不了（§1.14）        |

### 各版本自检与门禁

| 变量                                                        | 说明                           |
| ----------------------------------------------------------- | ------------------------------ |
| `LAWMIND_REQUIRE_TRUE_MANUSCRIPT`                           | `1` 时真稿门 SKIP 就非零退出   |
| `LAWMIND_REQUIRE_HUMAN_BASELINE`                            | `1` 时人类基准非通过就非零退出 |
| `LAWMIND_BENCHMARK_STRICT` / `LAWMIND_BENCHMARK_REAL_MODEL` | benchmark 严格模式与真模型     |
| `LAWMIND_SHADOW_REAL_MODEL`                                 | 影子回放走真模型               |
| `LAWMIND_SMOKE_DEEP`                                        | 冒烟做深度检查                 |
| `LAWMIND_BACKUP_INCLUDE_ENV`                                | 备份包含环境文件               |

### 案件云与副本

| 变量                                                                       | 说明           | 默认                    |
| -------------------------------------------------------------------------- | -------------- | ----------------------- |
| `LAWMIND_MATTER_CLOUD_DIR`                                                 | 案件云数据目录 | `.lawmind-matter-cloud` |
| `LAWMIND_MATTER_CLOUD_PORT`                                                | 端口           | `8788`                  |
| `LAWMIND_MATTER_CLOUD_HOST`                                                | 监听地址       | `127.0.0.1`             |
| `LAWMIND_MATTER_CLOUD_TENANT`                                              | 租户 id        | 无                      |
| `LAWMIND_MATTER_CLOUD_ADMIN_LAWYER_ID` / `LAWMIND_MATTER_CLOUD_ADMIN_NAME` | 初始化管理员   | 无                      |

### 集成（DMS / 电子签）

| 变量                                                              | 说明                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `LAWMIND_SHAREPOINT_CLIENT_SECRET` / `LAWMIND_SHAREPOINT_FIXTURE` | SharePoint                                                           |
| `LAWMIND_IMANAGE_CLIENT_SECRET` / `LAWMIND_IMANAGE_FIXTURE`       | iManage                                                              |
| `LAWMIND_FEISHU_APP_SECRET` / `LAWMIND_FEISHU_FIXTURE`            | 飞书                                                                 |
| `LAWMIND_ESIGN_PROVIDER`                                          | 电子签占位。`LAWMIND_ESIGN_API_KEY` 只出现在提示字符串里，运行时不读 |

## A.3 内部与测试（改了可能出怪事）

| 变量                                                                                                                                                                                                                                                                                                                           | 说明                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `LAWMIND_E2E`                                                                                                                                                                                                                                                                                                                  | `1` 走打包路径的渲染层（E2E 用）                        |
| `LAWMIND_E2E_CHANNEL` / `LAWMIND_E2E_MOCK_PORT` / `LAWMIND_E2E_MOCK_TOKEN` / `LAWMIND_E2E_VITE_PORT`                                                                                                                                                                                                                           | E2E 参数                                                |
| `LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS` / `_FACTOR` / `_MAX_DELAY_MS` / `_MAX_ATTEMPTS`                                                                                                                                                                                                                                        | 监督退避参数（测试可调）                                |
| `LAWMIND_ENABLE_E2E_TEST_ROUTES`                                                                                                                                                                                                                                                                                               | `1` 打开 E2E 专用路由（崩坏/建草稿）                    |
| `LAWMIND_DAEMON` / `LAWMIND_DAEMON_SUPERVISOR` / `LAWMIND_DAEMON_RESTART_COUNT`                                                                                                                                                                                                                                                | 守护与监督（由进程自己设置）                            |
| `LAWMIND_LOCAL_API_INSTALLATION_SECRET` / `_EPOCH` / `_REVOKED_CLIENTS` / `_INSTANCE_ID`                                                                                                                                                                                                                                       | 凭据派生参数（由桌面端注入子进程）                      |
| `LAWMIND_DEBUG_RUN_ID`                                                                                                                                                                                                                                                                                                         | 调试标记                                                |
| `LAWMIND_INTERNAL_EXPERIMENT_UI`                                                                                                                                                                                                                                                                                               | 内部实验界面                                            |
| `LAWMIND_INTERACTIVE_REVIEW`                                                                                                                                                                                                                                                                                                   | 交互式审核模式                                          |
| `LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY`                                                                                                                                                                                                                                                                                         | 回合诊断开关                                            |
| `LAWMIND_WORD_ADDIN_DIR`                                                                                                                                                                                                                                                                                                       | 插件资源目录覆盖                                        |
| `LAWMIND_ADDIN` / `LAWMIND_ADDIN_INTERNALS`                                                                                                                                                                                                                                                                                    | 插件注入的变量                                          |
| `LAWMIND_UI_DPR`                                                                                                                                                                                                                                                                                                               | 界面截图倍率（生成 mockup 用）                          |
| `LAWMIND_DOCS_BASE` / `LAWMIND_GITHUB_BLOB_BASE`                                                                                                                                                                                                                                                                               | 文档与 GitHub 链接基址                                  |
| `LAWMIND_FOCUS_CHAT_SEARCH_EVENT` / `LAWMIND_OPEN_WORKSPACE_FILE_EVENT` / `LAWMIND_MAIN_VIEWS` / `LAWMIND_SETTINGS_DEFAULT_SECTION` / `LAWMIND_SETTINGS_SCROLL_ANCHORS` / `LAWMIND_USER_MANUAL`                                                                                                                                | 界面行为常量（有些其实不是环境变量，是运行时标记）      |
| `LAWMIND_PLATFORM_CONTRACTS_V1`                                                                                                                                                                                                                                                                                                | 内部开关，默认开。设 `0` 关掉平台契约字段。不是律师设置 |
| `LAWMIND_AGENT_BEHAVIOR_EPOCH` / `LAWMIND_PROMPT_DYNAMIC_BOUNDARY` / `LAWMIND_EGRESS_MODES` / `LAWMIND_Q1_GOLDEN_JOURNEYS` / `LAWMIND_ROUTE_HANDLERS` / `LAWMIND_SECRET_RE` / `LAWMIND_ATTORNEY_DISCLAIMER_SHORT` / `LAWMIND_ATTORNEY_DISCLAIMER_EXPORT_FOOTER` / `LAWMIND_CASE_SUBDIR_ROLE_FILE` / `LAWMIND_SSE_HEARTBEAT_MS` | 代码里的常量名，**不是环境变量**（机械提取时会误抓）    |
| `LAWMIND_AGENT` / `LAWMIND_AGENT_` / `LAWMIND_QWEN_` / `LAWMIND_DEEPSEEK_` / `LAWMIND_MCP_` / `LAWMIND_CUSTOM_` / `LAWMIND_PLATFORM_` / `LAWMIND_REASONING_` / `LAWMIND_FOO` / `LAWMIND_FOO_SECRET` / `LAWMIND_BAR_KEY` / `LAWMIND_MCP_FOO_SECRET` / `LAWMIND_MCP_SECRET`                                                      | 前缀片段或测试用假值，**不是真变量**                    |

## A.4 三个最容易搞错的

1. **`LAWMIND_OPEN_LAW_NPC` 要设 `0` 才是关。** 默认是开的。想关 NPC 直播得显式写 `0`。
2. **`LAWMIND_SKIP_API_AUTH` 在打包态无效。** 这是刻意的（测试可隔离，生产不可被环境变量改状态）。
3. **`LAWMIND_AUDIT_CHAIN_KEY` 和 `LAWMIND_SKILL_SIGNING_SECRET` 都不要放在工作区里。** 工作区是模型可写面，放进去等于把锁放到被审材料手边。

## A.5 怎么核对这份清单

```bash
# 列出代码里出现的全部 LAWMIND_* 变量名
rg -o "LAWMIND_[A-Z0-9_]+" --no-filename -g '!node_modules' -g '!docs/**' | sort -u
```

注意输出里会混进常量名（见 A.3 最后两行说明的几类）。要判断某个名字是不是真环境变量，看它出现在 `process.env.` 或 `env.` 后面，还是只是被定义成常量。这条命令抓不到 `VITE_LAWMIND_*`，也抓不到 `BRAVE_API_KEY`、`OPENAI_API_KEY` 这类厂商官方名。
