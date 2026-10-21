# 附录 A 环境变量全表

本附录按用途分组列出代码里真实读取的 `LAWMIND_*` 环境变量。变量名、缺省值与读取行为已逐条对照代码核对（审计基线：`docs/LAWMIND-HARDCODED-CATALOG.md` A 节，2026-10-17；约 205 个真环境变量，另有 ~100 个同名但**不是**环境变量的常量，单列在 A.3 末尾）。

用法说明：

- 「默认」列给出 unset 时的行为；没写的是代码里没设默认（要么必填，要么不设即视为关闭/未配置）。
- 影响行为的关键变量，在「说明」里点明了后果。
- 分三张表：**你自己要配的**、**引擎调参用的**、**内部/测试用的**。
- 渲染层另有一族 `VITE_LAWMIND_*` 注入变量（全名带 `VITE_` 前缀，见 A.3）；`BRAVE_API_KEY`、`OPENAI_API_KEY` 等厂商官方名也被部分读取点认作回退。

## A.1 你要配的（日常使用）

### 模型与推理

| 变量                           | 说明                                                                                             | 默认                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `LAWMIND_AGENT_API_KEY`        | 主模型 API Key。首次配置写进密钥链后会从环境文件抹掉                                             | 空 → 模型未配置                                                                                        |
| `LAWMIND_AGENT_BASE_URL`       | 主模型 OpenAI 兼容端点                                                                           | `deepseek.defaultBaseUrl`                                                                              |
| `LAWMIND_AGENT_MODEL`          | 主模型名（回退读 `LAWMIND_DEEPSEEK_MODEL` / `LAWMIND_QWEN_MODEL`）                               | 空 → 未配置                                                                                            |
| `LAWMIND_AGENT_MAX_TOKENS`     | 单次最大输出 token                                                                               | 窗口×比例（chat 0.2 / draft·review 0.25 / plan 0.15 / classify 0.05），帽 65536（draft/review 131072） |
| `LAWMIND_AGENT_TEMPERATURE`    | 采样温度，夹取 [0, 1.5]                                                                          | 分档：classify/plan 0.15、chat 0.35、draft/review 0.5                                                  |
| `LAWMIND_AGENT_TIMEOUT_MS`     | 单次模型 HTTP 超时。**draft/review 任务单独走 480000**，见 A.4                                   | 120000（chat/classify）；480000（draft/review）                                                        |
| `LAWMIND_AGENT_MAX_TOOL_CALLS` | 单回合工具迭代上限。policy `agentMaxToolCallsPerTurn` 优先于它；服务端夹 ≤80（**想调大调不动**） | 80                                                                                                     |
| `LAWMIND_MODEL_CONTEXT_TOKENS` | 声称的模型上下文窗口（下限 4096）                                                                | 128000                                                                                                 |
| `LAWMIND_MODEL_PROVIDERS`      | **不是环境变量**。`src/lawmind/models/providers.ts:10` 里的常量数组，设了无效                    | —                                                                                                      |

### 国内供应商（一键预设）

| 变量                                                                                               | 说明                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LAWMIND_QWEN_API_KEY` / `LAWMIND_QWEN_BASE_URL` / `LAWMIND_QWEN_MODEL`                            | 通义千问 / DashScope（model 回退 `qwen-plus`，base 回退 dashscope 兼容端点）                                                                       |
| `LAWMIND_DEEPSEEK_API_KEY` / `LAWMIND_DEEPSEEK_MODEL`                                              | DeepSeek（model 回退 `deepseek-flash`）                                                                                                            |
| `LAWMIND_GLM_API_KEY` / `LAWMIND_GLM_MODEL`                                                        | 智谱 GLM                                                                                                                                           |
| `LAWMIND_MOONSHOT_API_KEY` / `LAWMIND_MOONSHOT_MODEL`                                              | Moonshot                                                                                                                                           |
| `LAWMIND_SILICONFLOW_API_KEY` / `LAWMIND_SILICONFLOW_MODEL`                                        | 硅基流动                                                                                                                                           |
| `LAWMIND_PROVIDER_DASHSCOPE_API_KEY` / `_OPENAI_` / `_DEEPSEEK_` / `_MOONSHOT_` / `_ZHIPU_API_KEY` | 内置供应商目录按 provider 取 key 的第一顺位（`apiKeyEnvKeys` 表，首个非空生效；openai/deepseek/moonshot/zhipu 还认厂商官方名 `OPENAI_API_KEY` 等） |

### 法律垂类模型（可选）

| 变量                                                                                               | 说明                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `LAWMIND_CHATLAW_API_KEY` / `LAWMIND_CHATLAW_BASE_URL` / `LAWMIND_CHATLAW_MODEL`                   | ChatLaw（实验；key 缺省 `local`）    |
| `LAWMIND_LAWGPT_API_KEY` / `LAWMIND_LAWGPT_BASE_URL` / `LAWMIND_LAWGPT_MODEL`                      | LawGPT（本地部署时密钥可写 `local`） |
| `LAWMIND_LEXEDGE_ENDPOINT` / `LAWMIND_LEXEDGE_TOKEN`                                               | LexEdge 代理（空 → 恒返回空）        |
| `LAWMIND_PARTNER_LEGAL_API_KEY` / `LAWMIND_PARTNER_LEGAL_BASE_URL` / `LAWMIND_PARTNER_LEGAL_MODEL` | 合作方法律模型（key 缺省 `local`）   |

### 检索与法源

| 变量                                                             | 说明                                                                                                 | 默认                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `LAWMIND_AUTHORITY_PROVIDER`                                     | 法源路由：`open` / `generic` / `pkulaw` / `lexis`（未识别的值也回落 `open`）                         | `open`                                          |
| `LAWMIND_AUTHORITY_ENDPOINT`                                     | 商业法源端点（generic / pkulaw / lexis 需要；做 URL 校验）                                           | 无                                              |
| `LAWMIND_AUTHORITY_API_KEY`                                      | 商业法源密钥（BYOK；**永不日志/回显**，桌面经 keychain `authority.pkulaw.apiKey` 注入）              | 无                                              |
| `LAWMIND_AUTHORITY_CITATION_VALIDATE`                            | 开启厂商引用核验（`1`/`true`/`yes`）                                                                 | 关                                              |
| `LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH`                       | 引用核验的专用路径                                                                                   | `${endpoint}/validate`                          |
| `LAWMIND_OPEN_LAW_MODE`                                          | 开源语料车道：`local` / `npc_flk` / `caseopen` / `courtlistener` / `eurlex` / `egov_jp` / `hybrid`   | 有直播车道则 hybrid，否则 local                 |
| `LAWMIND_OPEN_LAW_NPC`                                           | 国家法律法规数据库直播（**默认开；`0`/`false`/`no`/`off` 等任何非肯定值才关**）                      | 开                                              |
| `LAWMIND_OPEN_LAW_NPC_ENDPOINT`                                  | NPC 端点覆盖                                                                                         | `https://flk.npc.gov.cn/law-search/search/list` |
| `LAWMIND_OPEN_LAW_CORPUS`                                        | 外部语料 JSONL 绝对路径                                                                              | 内嵌示例语料                                    |
| `LAWMIND_OPEN_LAW_CORPUS_DEMO`                                   | `1`/`true`/`yes` 时外部语料整体按演示处理（覆盖单条 `demo:false`）                                   | 关                                              |
| `LAWMIND_OPEN_LAW_CASEOPEN`                                      | 自建类案库                                                                                           | 关                                              |
| `LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT`                             | 类案端点（仅该适配器允许回环地址）                                                                   | `http://127.0.0.1:8081/api/search`              |
| `LAWMIND_OPEN_LAW_COURTLISTENER`                                 | CourtListener 直播                                                                                   | 关                                              |
| `LAWMIND_OPEN_LAW_COURTLISTENER_ENDPOINT`                        | 端点覆盖                                                                                             | 官方 v4 search                                  |
| `LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN`                           | API token                                                                                            | 无                                              |
| `LAWMIND_OPEN_LAW_EURLEX` / `LAWMIND_OPEN_LAW_EURLEX_ENDPOINT`   | EUR-Lex                                                                                              | 关                                              |
| `LAWMIND_OPEN_LAW_EGOV_JP` / `LAWMIND_OPEN_LAW_EGOV_JP_ENDPOINT` | 日本 e-Gov                                                                                           | 关                                              |
| `LAWMIND_PKULAW_MODE`                                            | 法宝协议：`rest_compat` / `search_post` / `mcp_tools_call`（端点像 MCP 网关时自动 `mcp_tools_call`） | `rest_compat`                                   |
| `LAWMIND_PKULAW_MCP_LAW_TOOL` / `LAWMIND_PKULAW_MCP_CASE_TOOL`   | MCP 工具名                                                                                           | `search_article` / `search_case`                |
| `LAWMIND_PKULAW_CASE_ENDPOINT`                                   | 案例端点（缺省同法规端点）                                                                           | 无                                              |
| `LAWMIND_COMPANY_REGISTRY_URL` / `LAWMIND_COMPANY_REGISTRY_KEY`  | 工商查询源（空 → 工具报未配置）                                                                      | 无                                              |
| `LAWMIND_ALLOW_CROSS_MATTER_SEARCH`                              | `1` 开启跨案先例检索（**伦理墙默认关**）                                                             | 关                                              |
| `LAWMIND_ALLOW_INDEX_REBUILD`                                    | `1` 允许通过 API 重建索引。独立拉起的服务默认关；桌面壳拉起本机 API 且未显式设置时自动注入 `1`       | 独立服务关；桌面注入开                          |
| `LAWMIND_RETRIEVAL_MODE`                                         | 检索通道：`single` / `dual`                                                                          | `single`                                        |
| `LAWMIND_RETRIEVAL_TIMEOUT_MS`                                   | 检索模型超时。未设则回落 `LAWMIND_AGENT_TIMEOUT_MS`，再回落 120000                                   | 120000                                          |
| `LAWMIND_RECALL_PREFER_SMALL_FILES`                              | 记忆召回偏好小文件                                                                                   | 关                                              |
| `LAWMIND_EMBEDDING_ENABLED`                                      | 开启本地 embedding 桩（**不是语义模型**）                                                            | 关                                              |
| `LAWMIND_EMBEDDING_MODEL` / `LAWMIND_EMBEDDING_DIMS`             | 模型名与维度                                                                                         | `local-hash-stub-v1` / 64                       |

### 联网检索

| 变量                         | 说明                                                           | 默认                       |
| ---------------------------- | -------------------------------------------------------------- | -------------------------- |
| `LAWMIND_WEB_SEARCH_API_KEY` | 联网搜索密钥（Brave；keychain `wizard.webSearch.apiKey` 注入） | 空 → 网搜未配置            |
| `BRAVE_API_KEY`              | 同上（Brave 官方变量名，作回退认）                             | 无                         |
| `LAWMIND_VISION_MODEL`       | OCR/图像理解模型                                               | 回退 `LAWMIND_AGENT_MODEL` |
| `LAWMIND_OCR_CLOUD`          | `1` 时启用云 OCR（**材料出域**，需供应商密钥）                 | 关                         |
| `LAWMIND_OCR_LANGS`          | tesseract 语言包                                               | `chi_sim+eng`              |
| `LAWMIND_OCR_BUDGET_MS`      | OCR / 视觉兜底时间预算（PDF 三环共用）                         | `90000`                    |
| `LAWMIND_OCR_CACHE_DIR`      | 语言包缓存目录（按需下载一次，带完整性校验）                   | 用户缓存目录               |
| `LAWMIND_OCR_DATA_DIR`       | 已有语言包的只读目录（缺文件报错，不联网）                     | 空                         |
| `LAWMIND_DOC_READ_MODE`      | 文档读取模式（`ocr_only` 时禁用原生文本层）                    | 空                         |

### 邮箱

| 变量                               | 说明                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `LAWMIND_MAIL_SECRETS_KEY`         | 邮箱凭证 AES-256-GCM 密钥（桌面经 keychain `mail.secretsKey` 注入；headless 降级 `~/.lawmind/keys/mail-secrets.key`） |
| `LAWMIND_MAIL_GRAPH_CLIENT_SECRET` | Graph 应用密钥                                                                                                        |
| `LAWMIND_MAIL_SEED`                | `1` 时注入演示邮件（**仅开发**；非 `1` 一律 403）                                                                     |
| `LAWMIND_GRAPH_CLIENT_ID`          | Graph 客户端 id（空 = 占位实现）                                                                                      |

### 版本、策略与出口

| 变量                                                   | 说明                                                                                                                                   | 默认                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `LAWMIND_EDITION`                                      | `solo` / `firm` / `private_deploy`（policy 文件优先于它）                                                                              | `solo`                                          |
| `LAWMIND_CITATION_MODE`                                | `grounded` / `assisted` / `off`。env > policy > edition 缺省                                                                           | solo→`assisted`；firm/private_deploy→`grounded` |
| `LAWMIND_POLICY_FORCE_NO_WEB_SEARCH`                   | 由策略文件写入，`1` 表示强制关联网（policy 镜像，别手设）                                                                              | 关                                              |
| `LAWMIND_HOST_ACCESS_FILE`                             | 本机挂载授权文件路径                                                                                                                   | 无                                              |
| `LAWMIND_PROJECT_DIR`                                  | 关联项目目录                                                                                                                           | 无                                              |
| `LAWMIND_KEY_DIR`                                      | 本机密钥目录                                                                                                                           | `~/.lawmind/keys`                               |
| `LAWMIND_PRIVILEGE_SENTINEL`                           | `0`/`false` 关闭特权提示                                                                                                               | 开                                              |
| `LAWMIND_LEGAL_GUARDIAN`                               | `0`/`false`/`off`/`no` 关闭独立审稿                                                                                                    | 开                                              |
| `LAWMIND_JUDGMENT_TIERING`                             | 判据分级三态：`off` / `shadow` / `on`（policy 优先）                                                                                   | `shadow`                                        |
| `LAWMIND_JUDGMENT_ESCALATION`                          | 律师升级通道：`off` / `on`                                                                                                             | `off`                                           |
| `LAWMIND_JUDGMENT_ESCALATION_POSTURE`                  | 升级卡姿态：`advisory` / `block`；缺省随 edition（solo→advisory，firm/private_deploy→block）                                           | 随 edition                                      |
| `LAWMIND_JUDGMENT_DISABLED_VERIFIERS`                  | 逗号分隔停用机器验证器 id（未知 id 静默忽略）                                                                                          | 空                                              |
| `LAWMIND_DECISION_MODEL_MODE`                          | 第三方判定模型三态：`off` / `shadow` / `on`（policy 优先；egress 离线时强制 off）                                                      | `off`                                           |
| `LAWMIND_DECISION_MODEL_BASE_URL` / `_API_KEY` / `_ID` | 判定模型连接。**缺任一项自动降级 off**；密钥也可写策略文件 `decisionModelApiKey`                                                       | 空                                              |
| `LAWMIND_DECISION_MODEL_TIMEOUT_MS`                    | 判定模型超时                                                                                                                           | 8000                                            |
| `LAWMIND_ROUTE_DIVERGENCE`                             | 路由分歧记录（纯影子、零行为影响）。`0`/`false`/`off`/`no` 关                                                                          | 开                                              |
| `LAWMIND_ROUTE_DIVERGENCE_POSTURE`                     | 分歧姿态：`off` / `shadow` / `escalate`（policy 优先；**主开关关时强制 off**）                                                         | `shadow`                                        |
| `LAWMIND_PROMPT_VERBOSITY`                             | 系统提示工具目录详略：`compact` / `full`（env 优先于 policy）                                                                          | `compact`                                       |
| `LAWMIND_INTAKE`                                       | 接诊澄清启发式。`0`/`false`/`off`/`no` 关                                                                                              | 开                                              |
| `LAWMIND_HOST_ACCESS_MODE` / `LAWMIND_HOST_COMMANDS`   | **已移除，代码不再读取**（`host-policy.ts` 里 `void env`）。解析结果固定为 `command` 档（本机查找 + 命令），策略文件窄档位同样不再生效 | —                                               |

### 审计

| 变量                                | 说明                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LAWMIND_AUDIT_CHAIN_KEY`           | 审计链 HMAC 密钥（hex，**必须放在工作区外**；桌面经 keychain `audit.hashChainKey` 注入，headless 降级 `~/.lawmind/keys` key 文件）。没有 `LAWMIND_AUDIT_HASH_CHAIN_KEY` 这个别名，设了不读 |
| `LAWMIND_AUDIT_EXTERNAL_ANCHOR_URL` | 审计摘要外部锚定同步地址（`file://` 或 HTTP PUT）                                                                                                                                          |

### 技能签名

| 变量                           | 说明                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `LAWMIND_SKILL_SIGNING_SECRET` | 技能包签名密钥（**生产必须走 env**；不设则签出的 `.sig` 只是「看起来可信」） |

### 本机服务与桌面

| 变量                                           | 说明                                                                                                       | 默认                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `LAWMIND_LOCAL_API_TOKEN`                      | 旧式单一回环 bearer（**仅开发/E2E 覆盖路径**；打包态仍走派生鉴权，且不会传进守护子进程）                   | 自动生成随机 token                                                            |
| `LAWMIND_SKIP_API_AUTH`                        | `1` 跳过本机 API 鉴权（**打包构建显式忽略并告警**，见 A.4）                                                | 关                                                                            |
| `LAWMIND_LOCAL_API_CLIENTS_FILE`               | CLI 凭据文件位置覆盖                                                                                       | `<userData>/LawMind/local-api-clients.json`（开发态常在 `Electron/LawMind/`） |
| `LAWMIND_LOCAL_HOST` / `LAWMIND_LOCAL_HOST_V6` | **不是环境变量**。监听地址写死在 `apps/lawmind-desktop/server/lawmind-server-helpers.ts:49,57`             | `127.0.0.1` / `::1`                                                           |
| `LAWMIND_DESKTOP_PORT`                         | 本机 HTTP API 端口。**headless 必须显式给**；桌面由 Electron `listen(0)` 临时端口注入                      | 无                                                                            |
| `LAWMIND_WORKSPACE_DIR`                        | 工作区根目录                                                                                               | `cwd()/workspace`                                                             |
| `LAWMIND_ENV_FILE`                             | 环境文件路径                                                                                               | `<lawMindRoot>/.env.lawmind`                                                  |
| `LAWMIND_USER_DATA_DIR`                        | 用户数据目录（E2E 隔离用；**打包版一律忽略**）                                                             | 系统 userData                                                                 |
| `LAWMIND_ALLOW_MULTI_INSTANCE`                 | `1` 关闭单实例锁（**仅非打包生效**）                                                                       | 关                                                                            |
| `LAWMIND_DEVTOOLS`                             | `1` 打开停靠式开发者工具（非打包且非 E2E）                                                                 | 关                                                                            |
| `LAWMIND_SKIP_AUTO_UPDATE`                     | `1` 关闭应用内更新                                                                                         | 关                                                                            |
| `LAWMIND_DOWNLOAD_PAGE_URL`                    | 下载页地址                                                                                                 | jsDelivr 上的页面                                                             |
| `LAWMIND_DESKTOP_ACTOR_ID`                     | 审计/归因 actor id                                                                                         | `lawyer:desktop`                                                              |
| `LAWMIND_ENGINE_ACTOR_ID`                      | 引擎 actor id（CLI / 引擎规划审稿用；回退 `LAWMIND_DESKTOP_ACTOR_ID` → `lawyer:system`）。桌面审计只读前者 | 无                                                                            |
| `LAWMIND_PACKAGED`                             | 打包态标记，由桌面壳给本机服务端子进程设 `1`                                                               | 无                                                                            |
| `LAWMIND_ENABLE_COLLABORATION`                 | 多助手协作。**默认关**，必须显式设 `true` 才开；policy `enableCollaboration:false` 会镜像写入 `false`      | 关                                                                            |
| `LAWMIND_REPO_ROOT`                            | 仓库根（开发/CLI；vendor 布局解析用）                                                                      | 探测                                                                          |

### 打包与签名

| 变量                                                         | 说明                                                                                                                 | 默认                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `LAWMIND_OFFICECLI`                                          | officecli 可执行文件路径覆盖（解析顺序：env → resources → vendor → cwd）                                             | 无                              |
| `LAWMIND_OFFICECLI_BIN` / `LAWMIND_OFFICECLI_VERSION`        | vendor 本地二进制 / 钉版                                                                                             | 空 / **1.0.149**                |
| `LAWMIND_VENDOR_OFFICECLI` / `LAWMIND_SKIP_OFFICECLI_VENDOR` | vendor 强拉/跳过（CI 默认跳过）                                                                                      | 无                              |
| `LAWMIND_RESOURCES_PATH`                                     | 打包 extraResources 路径                                                                                             | 无                              |
| `LAWMIND_NODE_BIN` / `LAWMIND_DESKTOP_NODE_VERSION`          | 子进程 Node 二进制 / 桌面 vendor Node 钉版                                                                           | 解析到的 node / **22.23.2**     |
| `LAWMIND_MAC_SIGN_IDENTITY` / `CSC_NAME`                     | macOS 签名身份（`CSC_NAME` 优先）                                                                                    | 自动探测                        |
| `LAWMIND_REQUIRE_NOTARIZED`                                  | `1` 时未公证直接让构建失败                                                                                           | 关                              |
| `LAWMIND_APP_DATA_DIR`                                       | CLI 发现文件用的 appData 根。`LAWMIND_APP_ID` / `LAWMIND_PRODUCT_NAME` 来自 `branding/manifest.json`，设环境变量无效 | `~/Library/Application Support` |
| `LAWMIND_WORD_ADDIN_DIR`                                     | Word 加载项资源目录覆盖                                                                                              | vendor 布局                     |

## A.2 引擎调参（一般不用动）

### 护栏

| 变量                                             | 说明                                                                                                                                                                                                                | 默认   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` | `1`/`true` 允许危险工具免审批。`strictDangerousToolApproval` 为真（firm 等）时无效；**打包构建内仍生效**，见 A.4                                                                                                    | 关     |
| `LAWMIND_TOOL_SANDBOX`                           | 高风险工具子进程沙箱（POC），仅认 `=1`。policy `toolSandbox` 已被拒绝，**不再读取**                                                                                                                                 | 关     |
| `LAWMIND_TOOL_SANDBOX_INLINE`                    | `1` 强制沙箱内联执行（VITEST 内自动 inline）                                                                                                                                                                        | 关     |
| `LAWMIND_TOOL_TIMEOUT_MS`                        | 工具墙钟超时。**显式 `0` 才表示不限**；长时工具（`draft_worker` / `explore_folder` / `deep_research` / `research_task` / `delegate_task` / `render_document` / `render_tracked_draft`）在默认值下自动放宽到 12 分钟 | 180000 |
| `LAWMIND_MAX_TOOL_CONCURRENCY`                   | 单会话工具并发（夹 ≤16）                                                                                                                                                                                            | 4      |
| `LAWMIND_MAX_MODEL_CONCURRENCY`                  | 进程级模型并发。429 减半、连续 8 次成功 +1，动态区间 1..8；**env 只能把天花板调低**（夹 ≤8，想抬高抬不动）                                                                                                          | 8      |
| `LAWMIND_READONLY_WORKER_MAX_ROUNDS`             | 只读 worker 工具轮数（夹到 12）                                                                                                                                                                                     | 5      |
| `LAWMIND_TOOL_RESULT_TOKEN_LIMIT`                | 单条工具回包入史 token 上限。未设按窗口派生 `min(max(4000, 窗/8), ~25000)`；env 夹 [1, 200000]                                                                                                                      | 8000   |
| `LAWMIND_COLLAB_STEP_TIMEOUT_MS`                 | 协作单步超时（夹 30s–60min）                                                                                                                                                                                        | 900000 |
| `LAWMIND_AUTO_DELIVERABLE_WF`                    | ESG/报告自动交付物工作流。`0`/`false`/`off`/`no` 才关；policy `autoDeliverableWorkflow:false` 同样关                                                                                                                | 开     |
| `LAWMIND_ALLOW_RENDER_GATE_BYPASS`               | `1`/`true` 允许 `?strict=false` 绕过渲染验收门（每次生效落审计；**打包构建内仍生效**）                                                                                                                              | 关     |
| `LAWMIND_ALLOW_CHECKLIST_BYPASS`                 | `1`/`true` 允许绕过必核清单（VITEST 视同开；**打包构建内仍生效**）                                                                                                                                                  | 关     |
| `LAWMIND_ALLOW_STALE_COVERAGE`                   | 允许覆盖率棘轮绕行（pre-commit 用）                                                                                                                                                                                 | 关     |
| `LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER`            | 允许工作流 `force_render` 跳过审批直接渲染，仅认 `=1`（demo/测试旁路）                                                                                                                                              | 关     |
| `LAWMIND_ACTION_PRE_REVIEW`                      | 动作级审前评审：`off` / `shadow` / `on`                                                                                                                                                                             | `off`  |

### 上下文与压缩

| 变量                         | 说明                                                                                                 | 默认          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| `LAWMIND_COMPACT_LLM`        | LLM 摘要总开关。优先级：env 显式值（运维一刀切）> policy `context.digest.llmDigestEnabled` > 默认开  | 开            |
| `LAWMIND_STRICT_TOOL_STREAM` | 严格工具流式（服务端启动时若未设会**写入 `0`**）                                                     | 关            |
| `LAWMIND_CHARS_PER_TOKEN`    | 非 CJK 字符/token 换算（估算用）                                                                     | 4             |
| `LAWMIND_CONTEXT_TUNING`     | JSON，覆盖整个上下文/压缩调参表（与 policy `context.*` 等价）。**policy 有 `context` 段时 env 不读** | 空 → 全表缺省 |
| `LAWMIND_LLM_JSON_SCHEMA`    | 强制开/关 json_schema 响应格式                                                                       | 自动探测      |

### 改稿幅度门

| 变量                                  | 说明                                                                                              | 默认 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ---- |
| `LAWMIND_SURGICAL_ENFORCE`            | `1`/`true`/`on` 开启最小编辑强制门（只进指标与教练；产品路径不按字数拒稿，不拦截 `update_draft`） | 关   |
| `LAWMIND_SURGICAL_MAX_ABS_CHAR_DELTA` | 绝对字符差上限                                                                                    | 400  |
| `LAWMIND_SURGICAL_MAX_RATIO`          | 改动比例上限，取值 (0,1]                                                                          | 0.25 |

### 路由与模型角色

| 变量                                                                                                                                                               | 说明                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `LAWMIND_ROUTER_MODE`                                                                                                                                              | 模型路由开关（空 → keyword 路由）                                       |
| `LAWMIND_ROUTER_MODEL` / `LAWMIND_ROUTER_BASE_URL` / `LAWMIND_ROUTER_API_KEY`                                                                                      | 路由模型凭据（回退 `LAWMIND_AGENT_*` / `QWEN_*`）                       |
| `LAWMIND_ROUTER_TEMPERATURE` / `LAWMIND_ROUTER_TIMEOUT_MS`                                                                                                         | 路由采样参数（缺省请求体不带这两个字段）                                |
| `LAWMIND_REASONING_MODE`                                                                                                                                           | 起草推理走模型还是关键词（空 → keyword 关）                             |
| `LAWMIND_REASONING_MODEL` / `LAWMIND_REASONING_BASE_URL` / `LAWMIND_REASONING_API_KEY`                                                                             | 独立推理模型凭据（回退 `LAWMIND_AGENT_*`）                              |
| `LAWMIND_REASONING_TEMPERATURE` / `LAWMIND_REASONING_TIMEOUT_MS`                                                                                                   | 推理采样参数（缺省请求体不带这两个字段）                                |
| `LAWMIND_DEFAULT_UPSTREAM_MODEL` / `LAWMIND_DEFAULT_BUILTIN_MODEL_ID` / `LAWMIND_DEFAULT_PLATFORM_MODEL_ID` / `LAWMIND_BUILTIN_MODELS` / `LAWMIND_PLATFORM_MODELS` | **不是环境变量**。`models/catalog.ts` 与 `platform-catalog.ts` 里的常量 |

**注意：没有 `LAWMIND_WORKER_MODEL` 这个环境变量。** 设置页里的更快模型存在工作区模型设置的 `workerModelId`（`models/custom-store.ts`、`models/types.ts`），只用于审稿和回合内摘要，不接管对话里的工具循环。照 `LAWMIND_WORKER_MODEL` 去 grep 会一无所获。

### 平台代理（私有化/商业通道）

| 变量                                                           | 说明                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `LAWMIND_PLATFORM_PROXY_URL`                                   | 平台代理地址（空 → 平台模型不可用）                                                                           |
| `LAWMIND_PLATFORM_API_TOKEN` / `LAWMIND_PLATFORM_ACCESS_TOKEN` | 代理凭据                                                                                                      |
| `LAWMIND_PLATFORM_AUTHORITY_PROXY`                             | 商业版法源走代理                                                                                              |
| `LAWMIND_PLATFORM_PROVIDER_*_API_KEY`                          | 运营方代付的供应商密钥（DASHSCOPE / OPENAI / DEEPSEEK / MOONSHOT / ZHIPU；**从不在 `GET /api/models` 暴露**） |
| `LAWMIND_PLATFORM_QWEN_API_KEY`                                | DashScope 的**别名**（`models/platform-providers.ts` 两名字都认）                                             |
| `LAWMIND_COMMERCIAL_BFF_PORT`                                  | 商业 BFF stub 端口，默认 `8787`                                                                               |
| `LAWMIND_BUILD_CHANNEL`                                        | `oss` / `commercial`。只在进程启动时读取；策略文件改不了（§1.14）                                             |

### 各版本自检与门禁

| 变量                                                        | 说明                                              |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `LAWMIND_REQUIRE_TRUE_MANUSCRIPT`                           | `1` 时真稿门 SKIP 就非零退出                      |
| `LAWMIND_REQUIRE_HUMAN_BASELINE`                            | `1` 时人类基准非通过就非零退出                    |
| `LAWMIND_BENCHMARK_STRICT` / `LAWMIND_BENCHMARK_REAL_MODEL` | benchmark 严格模式与真模型（真模型需显式 opt-in） |
| `LAWMIND_SHADOW_REAL_MODEL`                                 | 影子回放走真模型                                  |
| `LAWMIND_SMOKE_DEEP`                                        | 冒烟做深度检查                                    |
| `LAWMIND_BACKUP_INCLUDE_ENV`                                | 备份包含环境文件（**含密钥，危险**）              |

### 案件云与副本（stub 服务器）

| 变量                                                                       | 说明                         | 默认                      |
| -------------------------------------------------------------------------- | ---------------------------- | ------------------------- |
| `LAWMIND_MATTER_CLOUD_DIR`                                                 | 案件云数据目录               | `.lawmind-matter-cloud`   |
| `LAWMIND_MATTER_CLOUD_PORT`                                                | 端口                         | `8788`                    |
| `LAWMIND_MATTER_CLOUD_HOST`                                                | 监听地址                     | `127.0.0.1`               |
| `LAWMIND_MATTER_CLOUD_TENANT`                                              | 初始化租户名（`--setup` 用） | `示范律所`                |
| `LAWMIND_MATTER_CLOUD_ADMIN_NAME` / `LAWMIND_MATTER_CLOUD_ADMIN_LAWYER_ID` | 初始化管理员（`--setup` 用） | `管理员` / `lawyer_admin` |
| `LAWMIND_COMMERCIAL_BFF_PORT`                                              | 商业 BFF stub 端口           | `8787`                    |

### 集成（DMS / 电子签）

| 变量                                                              | 说明                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `LAWMIND_SHAREPOINT_CLIENT_SECRET` / `LAWMIND_SHAREPOINT_FIXTURE` | SharePoint 连接 / 夹具模式                                                                              |
| `LAWMIND_IMANAGE_CLIENT_SECRET` / `LAWMIND_IMANAGE_FIXTURE`       | iManage 连接 / 夹具                                                                                     |
| `LAWMIND_FEISHU_APP_SECRET` / `LAWMIND_FEISHU_FIXTURE`            | 飞书连接 / 夹具                                                                                         |
| `LAWMIND_ESIGN_PROVIDER`                                          | 电子签占位（`fadada` / `esign` / `docusign`）。`LAWMIND_ESIGN_API_KEY` 只出现在提示字符串里，运行时不读 |

## A.3 内部与测试（改了可能出怪事）

### 进程注入 / E2E

| 变量                                                                                     | 说明                                                                                         | 默认                        |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| `LAWMIND_E2E`                                                                            | `1` 走打包路径的渲染层（loadFile、禁 DevTools/自更新）                                       | 关                          |
| `LAWMIND_E2E_CHANNEL`                                                                    | 用本机 Chrome 跑 E2E 而非 Playwright 钉版 chromium                                           | 无                          |
| `LAWMIND_E2E_MOCK_PORT` / `LAWMIND_E2E_VITE_PORT`                                        | mock API 端口 / E2E 专用 Vite 端口                                                           | `48888` / `52473`           |
| `LAWMIND_E2E_MOCK_TOKEN`                                                                 | mock API bearer（空 → 不校验）                                                               | 空                          |
| `LAWMIND_E2E_SUPERVISION_BASE_DELAY_MS` / `_FACTOR` / `_MAX_DELAY_MS` / `_MAX_ATTEMPTS`  | 子进程监督退避重启参数                                                                       | `500` / `2` / `30000` / `5` |
| `LAWMIND_ENABLE_E2E_TEST_ROUTES`                                                         | `1` 打开 E2E 专用路由（崩坏/建草稿）                                                         | 关                          |
| `LAWMIND_DAEMON` / `LAWMIND_DAEMON_SUPERVISOR` / `LAWMIND_DAEMON_RESTART_COUNT`          | 守护进程 / 监督进程标记与重启次数（由进程自己设置，不应手设）                                | —                           |
| `LAWMIND_LOCAL_API_INSTALLATION_SECRET` / `_EPOCH` / `_REVOKED_CLIENTS` / `_INSTANCE_ID` | 派生凭据参数（`credential=HMAC(secret, clientId:epoch)`；由桌面端经 keychain 注入子进程）    | —                           |
| `LAWMIND_MCP_SECRET`                                                                     | 由 `mcp-client-bridge.ts:102` 注入 MCP stdio 子进程的密钥；safe-command extra 白名单唯一例外 | —                           |
| `LAWMIND_DEBUG_RUN_ID`                                                                   | 调试 run id                                                                                  | `pre-fix`                   |
| `LAWMIND_INTERACTIVE_REVIEW`                                                             | 冒烟交互审核模式                                                                             | 关                          |
| `LAWMIND_UI_DPR`                                                                         | 界面截图倍率（生成 mockup 用）                                                               | `3`                         |
| `LAWMIND_PLATFORM_CONTRACTS_V1`                                                          | 平台契约 v1 响应字段。设 `0` 关掉；不是律师设置                                              | `1`                         |

### 动态构造的环境变量（keychain → 子进程）

以下两族按设置面录入动态生成，名字本身不写在代码里（`apps/lawmind-desktop/electron/local-server.mjs:216,225`）：

| 模式                                  | 构造来源                           | 含义                            |
| ------------------------------------- | ---------------------------------- | ------------------------------- |
| `LAWMIND_CUSTOM_<模型ID大写>_API_KEY` | keychain `custom.<modelId>.apiKey` | 每个自定义模型的 key 注入子进程 |
| `LAWMIND_MCP_<服务器ID大写>_SECRET`   | keychain `mcp.<serverId>.secret`   | 每个 MCP server 的 secret 注入  |

另有通用按名读取器（健康检查/CLI）：`apps/lawmind-desktop/server/lawmind-server-helpers.ts:189`、`scripts/lawmind/lawmind-agent.ts:27`、`scripts/lawmind/lawmind-env-check.ts:68`。

### 渲染层 `VITE_LAWMIND_*` 注入族

从 Vite 前端读的变量全名带 `VITE_` 前缀（`apps/lawmind-desktop/src/renderer/global.d.ts:5-8`），机械提取 `LAWMIND_*` 会剥掉前缀，写配置时必须用全名：

| 变量                                  | 说明                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `VITE_LAWMIND_INTERNAL_EXPERIMENT_UI` | 内部实验界面（默认仅 vite dev 开；`1`/`0` 显式覆盖，含生产构建内测） |
| `VITE_LAWMIND_DOCS_BASE`              | 文档基址                                                             |
| `VITE_LAWMIND_GITHUB_BLOB_BASE`       | GitHub 链接基址                                                      |
| `VITE_LAWMIND_DOWNLOAD_PAGE_URL`      | 下载页地址                                                           |

### 不是环境变量的 `LAWMIND_*` 常量（防误收）

以下名字会被 `rg "LAWMIND_[A-Z0-9_]+"` 抓到，但只是代码常量 / DOM 事件 / localStorage key，**设环境变量无效**：

| 类别             | 名字                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 品牌/产品        | `LAWMIND_PRODUCT_NAME`、`LAWMIND_APP_ID`（`electron/brand.mjs:27-28`，来自 `branding/manifest.json`）                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 网络常量         | `LAWMIND_LOCAL_HOST`、`LAWMIND_LOCAL_HOST_V6`（`lawmind-server-helpers.ts:49,57`）                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SSE              | `LAWMIND_SSE_HEARTBEAT_MS`（=15000）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 模型目录         | `LAWMIND_BUILTIN_MODELS`、`LAWMIND_PLATFORM_MODELS`、`LAWMIND_DEFAULT_UPSTREAM_MODEL`、`LAWMIND_DEFAULT_BUILTIN_MODEL_ID`、`LAWMIND_DEFAULT_PLATFORM_MODEL_ID`、`LAWMIND_MODEL_PROVIDERS`                                                                                                                                                                                                                                                                                                                              |
| 提示词           | `LAWMIND_AGENT_BEHAVIOR_EPOCH`、`LAWMIND_PROMPT_DYNAMIC_BOUNDARY`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 内容信任         | `UNTRUSTED_DOCUMENT_OPEN`（`<<<LAWMIND_UNTRUSTED_DOC>>>`）                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 路由表           | `LAWMIND_ROUTE_HANDLERS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 法律文案         | `LAWMIND_ATTORNEY_DISCLAIMER_SHORT`、`LAWMIND_ATTORNEY_DISCLAIMER_EXPORT_FOOTER`                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 出口模式表       | `LAWMIND_EGRESS_MODES`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 评测             | `LAWMIND_Q1_GOLDEN_JOURNEYS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 安全正则         | `SAFE_COMMAND_LAWMIND_SECRET_RE`（`platform/safe-command.ts:132`）                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 加载项注入       | `window.LAWMIND_ADDIN`、`window.LAWMIND_ADDIN_INTERNALS`（服务端/窗格运行时注入）                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| localStorage key | `LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY`、`LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY`（渲染层偏好键名常量）                                                                                                                                                                                                                                                                                                                                                                                                                   |
| UI 常量          | `LAWMIND_SETTINGS_DEFAULT_SECTION`、`LAWMIND_SETTINGS_SCROLL_ANCHORS`、`LAWMIND_USER_MANUAL`、`LAWMIND_GITHUB_BLOB_BASE`（由 `VITE_` 派生的常量）、`LAWMIND_MAIN_VIEWS`、`LAWMIND_CASE_SUBDIR_ROLE_FILE`                                                                                                                                                                                                                                                                                                               |
| DOM 自定义事件族 | `LAWMIND_CANVAS_COMPOSER_EVENT`、`LAWMIND_CANVAS_EXPORT_EVENT`、`LAWMIND_FOCUS_CHAT_SEARCH_EVENT`、`LAWMIND_MATERIAL_CHOSEN_EVENT`、`LAWMIND_OPEN_CONTRACT_REVISION_EVENT`、`LAWMIND_OPEN_DRAFT_DESK_EVENT`、`LAWMIND_OPEN_MATTER_ON_DESK`、`LAWMIND_OPEN_MATTER_OUTBOUND`、`LAWMIND_OPEN_WORKSPACE_FILE_EVENT`、`LAWMIND_PREPARE_WORKSPACE_FILE_EVENT`、`LAWMIND_REPLICA_JOINED_EVENT`、`LAWMIND_REVEAL_FILE_LINE_EVENT`、`LAWMIND_SHOW_WORD_SURFACE_EVENT`、`LAWMIND_VIEW_MATTER_INTENT`、`LAWMIND_OUTBOUND_CHANGED` |

机械提取还会抓到**前缀片段或测试用假值**，同样不是真变量：`LAWMIND_AGENT` / `LAWMIND_AGENT_` / `LAWMIND_QWEN_` / `LAWMIND_DEEPSEEK_` / `LAWMIND_MCP_` / `LAWMIND_CUSTOM_` / `LAWMIND_PLATFORM_` / `LAWMIND_REASONING_` / `LAWMIND_FOO` / `LAWMIND_FOO_SECRET` / `LAWMIND_BAR_KEY` / `LAWMIND_MCP_FOO_SECRET`。

## A.4 最容易搞错的

1. **`LAWMIND_OPEN_LAW_NPC` 要设 `0` 才是关。** 默认是开的（官方公开源）。想关 NPC 直播得显式写 `0`（或 `false`/`no`/`off`）。
2. **四个 dev 绕行开关的打包行为不一样。** `LAWMIND_SKIP_API_AUTH` 在**打包构建里被显式忽略并告警**（`electron/local-server.mjs:1017,1051`，测试可隔离、生产不可被环境变量改状态）；而 `LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` / `LAWMIND_ALLOW_RENDER_GATE_BYPASS` / `LAWMIND_ALLOW_CHECKLIST_BYPASS` 三个**在打包构建内仍生效**——dev 便利、生产炸弹，发布环境不要设。
3. **`LAWMIND_AGENT_TIMEOUT_MS` 不是全局唯一超时。** 默认 120000 只管 chat/classify；draft/review 任务静默享受 4 倍（`REVIEW_MODEL_TIMEOUT_MS=480000`，`capability-envelope.ts:33-35`）。拿 120s 当唯一超时会误判 review 卡顿。
4. **`LAWMIND_AUDIT_CHAIN_KEY` 和 `LAWMIND_SKILL_SIGNING_SECRET` 都不要放在工作区里。** 工作区是模型可写面，放进去等于把锁放到被审材料手边。

## A.5 怎么核对这份清单

```bash
# 列出代码里出现的全部 LAWMIND_* 变量名
rg -o "LAWMIND_[A-Z0-9_]+" --no-filename -g '!node_modules' -g '!docs/**' | sort -u
```

注意输出里会混进常量名与假值（见 A.3 末尾两节）。要判断某个名字是不是真环境变量，看它出现在 `process.env.` 或 `env.` 后面，还是只是被定义成常量。这条命令抓不到 `VITE_LAWMIND_*`（全名带前缀，见 A.3），也抓不到 `BRAVE_API_KEY`、`OPENAI_API_KEY` 这类厂商官方名，以及 A.3 里按 keychain 动态构造的两族。逐条审计口径与读取点见 `docs/LAWMIND-HARDCODED-CATALOG.md` A 节（2026-10-17 基线）。
