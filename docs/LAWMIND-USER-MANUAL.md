# LawMind 使用手册

本文档面向**一键安装后的日常使用**，随功能与脚本变更持续维护。若你尚未安装，请先执行：

```bash
curl -fsSL https://raw.githubusercontent.com/sunhl4/LawMind/main/scripts/install-lawmind.sh | bash
```

---

## 1) 安装完成后第一步

一键安装会：

- 将 LawMind 克隆到 **`~/.lawmind/openclaw`**（可通过环境变量 `LAWMIND_INSTALL_DIR` 自定义）
- 执行 `pnpm install`、onboard（生成 `workspace/` 与 `.env.lawmind` 模板）、环境检查

**进入安装目录并确认环境：**

```bash
cd ~/.lawmind/openclaw
npm run lawmind:env:check
```

若有报错，请先完成 **2) 配置 `.env.lawmind`**，再继续。

**建议首次自检（可选）：**

```bash
npm run lawmind:smoke -- --fail-on-empty-claims
```

---

## 1b) 桌面应用（Electron）

### 开发模式（仓库克隆）

从 **本仓库根目录**（需已 `pnpm install`）启动：

```bash
pnpm lawmind:desktop
```

- 对话、任务列表与交付摘要在应用内查看；数据默认在 **Electron 用户数据目录**下的 `LawMind/workspace` 与 `LawMind/.env.lawmind`（与你在安装目录里用的 `workspace/` 不是同一路径）。
- **开发模式下**（`pnpm lawmind:desktop`）：本地服务会先加载 **仓库根目录**的 `.env.lawmind`（与命令行一致），再加载用户目录下的 `LawMind/.env.lawmind`；**后者覆盖前者**。若命令行正常而桌面报 **401 / invalid API key**，多半是向导在用户目录里写错了 Key——请打开该文件核对，或删掉其中的 `LAWMIND_*` / `QWEN_*` 行后重启桌面，让它回落到仓库配置。可在浏览器开发者工具 Network 里查看 `GET /api/health` 返回的 `envHint`（各 env 文件是否存在，**不含**密钥明文）。

#### 界面概览

桌面端采用**深色暖铜色调**专业风格，左侧边栏 + 右侧对话区两栏布局：

- **侧边栏**（左）：品牌栏（含齿轮设置按钮）→ 助手选择器 → 项目药丸 → 可折叠工作记录（任务/历史列表）。
- **主区域**（右）：对话消息流 + 快捷操作 Chip 栏 + 输入框。消息采用无气泡直排风格（AI 回复无边框无背景，内容即布局）。

#### 设置面板（齿轮图标）

点击侧边栏品牌栏的**齿轮图标**打开设置面板，包含三个分区：

1. **助手管理**：查看当前助手详情、切换助手、新建/编辑/删除助手、查看使用统计。
2. **模型与检索**：查看模型连接状态、切换检索策略（统一模型 / 通用+法律专用）、打开 API 配置向导。
3. **工作区与项目**：查看工作区路径、选择/关闭项目目录。

#### 项目目录

- 点击设置面板中的「切换项目」或侧边栏项目药丸，可通过**系统文件对话框**选择本机目录作为当前项目。
- 选中后，项目路径随每次对话请求发送到后端（`projectDir` 字段），后续版本将支持基于项目文件的检索与上下文注入。
- 侧边栏和主区域顶栏均会显示当前项目目录名。

#### 配置模型 Key

应用内 **配置向导**（设置面板 → 模型与检索 → API 配置向导），或编辑用户目录 `.env.lawmind`，变量与 **2) 配置 `.env.lawmind`** 一节相同。

#### 检索模式

设置面板中可选 **统一模型**（通用与法律检索共用向导里的 API）或 **通用 + 法律专用**（引擎检索：通用仍用 `LAWMIND_AGENT_*` / `LAWMIND_QWEN_*`，法律专线需在 `.env.lawmind` 配置 `LAWMIND_CHATLAW_*`、`LAWMIND_LAWGPT_*` 或 `LAWMIND_PARTNER_LEGAL_*`；未配置法律端点时自动回退为通用模型）。切换模式会重启本地 API，并注入 `LAWMIND_RETRIEVAL_MODE`。`GET /api/health` 中的 `dualLegalConfigured` 表示是否检测到法律端点。

#### 多助手与岗位

设置面板中可 **新建 / 编辑** 多个助手，填写简介并选择**内置岗位预设**（亦可补充自定义岗位说明）；系统会注入到对话的 system prompt。助手档案与 `LawMind/assistants.json`、使用统计 `LawMind/assistant-stats.json` 同目录（与 `desktop-config.json` 同级）。对话请求 `POST /api/chat` 可带 `assistantId`；管理接口：`GET/POST/PATCH/DELETE /api/assistants`、`GET /api/assistant-presets`。任务 JSON 中可含 `assistantId` 字段，便于按助手查看工作产出。默认助手 ID 为 `default`，不可删除。

**按助手过滤工作记录**：侧边栏的工作记录（任务/历史列表）会自动按当前选中的助手过滤，切换助手时列表同步更新，只显示该助手相关的记录。

#### 联网检索（可选）

主界面可勾选「允许联网检索」；勾选后本轮对话会注册 `web_search` 工具（Brave Search API）。在 `.env.lawmind` 中配置 `LAWMIND_WEB_SEARCH_API_KEY` 或 `BRAVE_API_KEY`（与 OpenClaw Brave 配置兼容）。未勾选时仅使用工作区与本地检索工具，不会调用联网搜索。`GET /api/health` 返回 `webSearchApiKeyConfigured` 表示是否检测到上述密钥。若工作区策略文件将 **`allowWebSearch` 设为 `false`**，服务器会**强制关闭**联网检索（即使 UI 勾选）。开发与选型层面的说明见 [LawMind 联网检索路径](/LAWMIND-NETWORK-OPTIONS)。

#### 超时

模型单次请求默认 **120 秒**（`LAWMIND_AGENT_TIMEOUT_MS`，可改）。**单次工具执行**（如整条工作流）默认与模型超时**一致**（`LAWMIND_TOOL_TIMEOUT_MS`，未设置时跟随模型超时），避免长任务在 30 秒工具上限处失败；更长合同流水线可单独调大 `LAWMIND_TOOL_TIMEOUT_MS`。

#### 任务与历史

每轮成功完成的对话会在工作区 `tasks/` 下写入一条 **对话指令**（`agent.instruction`）任务，含短标题与完整指令；侧栏工作记录区（默认折叠，点击标题栏展开）可 **搜索**、按 **时间范围** 筛选，并点开查看详情与 **会话 ID**（与引擎工作流产生的任务并存）。

#### 案件工作台怎么理解

如果你不是技术人员，可以把 **案件工作台** 理解成一个“案件驾驶舱”:

- 左边是这个案件本身的材料、任务、草稿、CASE 档案和审计记录。
- 右边是系统根据你最近的真实使用动作，帮你总结“你现在主要在忙什么”“下一步最值得点哪里”“产品哪里还不顺手”。

这部分不是让律师去研究算法，而是帮助你更快判断：

1. 当前案件卡住在哪里。
2. 你最近主要在审核、补 CASE，还是沉淀经验。
3. 系统给出的下一步建议，是“案件建议”还是“产品建议”。

#### 如何阅读案件工作台里的新面板

下面这些区块都在案件概览附近出现。它们虽然名字不同，但可以按“从事实到判断”的顺序来理解：

1. **最近律师动作**
   这里展示最近几次关键人工动作，例如进入审核台、把建议写回 `CASE.md`、把经验写入律师档案或助手档案。
   这是最原始的事实层，适合回答“我刚刚都做了什么”。

2. **律师行为摘要**
   这里会把前面的动作做简单汇总，例如：
   - 进入审核台多少次
   - 补 CASE 多少次
   - 记忆沉淀多少次
   - 最近主要在哪个界面来回切换
     适合回答“这个案件当前的主工作面到底在哪里”。

3. **交互收敛建议**
   这是给当前律师的下一步建议。
   例如系统发现你一直在审核台和案件页之间来回切换，它就可能提示你优先回到审核焦点；如果发现你不断补写 CASE，它可能直接引导你进入 CASE 对应 section。
   简单理解：这是“本案下一步怎么走”。

4. **产品改造建议**
   这不是让律师立刻去做的动作，而是系统根据本案重复操作，反推“LawMind 以后应该把哪里做得更顺手”。
   例如：
   - 把审核决策前置到概览
   - 为 CASE 补录增加结构化表单
   - 把认知升级做成快捷采纳通道
     简单理解：这是“系统自己哪里还可以改进”。

5. **产品实验清单**
   这里会把“产品改造建议”进一步拆成更容易验证的实验项，并写清楚：
   - 假设是什么
   - 应该怎么验证
   - 当前已经出现了什么信号
   - 优先级高不高
     如果你要和技术团队沟通，这一层会比只说“感觉这里不好用”更容易讨论。

6. **跨案件实验累积板**
   这一层不只看当前案件，而是看整个工作区里多个案件有没有出现类似模式。
   如果同一个问题在多个案件中反复出现，就说明它更可能是“共性问题”，而不是这个案件的偶发现象。

7. **Roadmap 候选池 / 路线图决策卡**
   这是目前最上层的判断。
   系统会把多个案件里反复出现的模式，压缩成更接近产品排期语言的候选项，并补充：
   - 现在做 / 下一波 / 后续观察
   - 已验证 / 正在成形 / 继续观察
   - 预期收益
   - 主要风险
   - 建议 owner
     对律师来说，不需要把它理解成“技术计划表”，只需要把它看成：系统已经能分辨哪些问题只是偶发，哪些问题已经值得优先解决。

#### 这些区块最容易被误解的地方

- **它们不是法律结论。**  
  这些区块描述的是你的工作路径和系统改进方向，不是法律意见本身。

- **它们不是自动替你做决定。**  
  系统只会给出建议和入口，是否采纳、是否写入档案、是否进入审核，仍然由律师决定。

- **它们不是“监控律师”，而是帮助减少重复劳动。**  
  系统记录的是与案件推进直接相关的关键动作，目的是让后续入口更贴近你的真实工作习惯。

#### 律师最实用的阅读顺序

如果你第一次使用这些区块，建议按下面顺序看：

1. 先看 **最近律师动作**，确认系统记录的事实有没有明显偏差。
2. 再看 **律师行为摘要**，确认系统对“主工作面”的判断是不是符合你的直觉。
3. 然后看 **交互收敛建议**，决定是否直接点击进入下一步。
4. 如果你在和产品/技术团队讨论体验问题，再继续看 **产品改造建议**、**产品实验清单** 和 **路线图决策卡**。

#### 什么时候这些区块最有价值

以下几种情况尤其有帮助：

- 同一案件已经来回处理了多轮，感觉入口越来越分散。
- 你总觉得自己在重复补 CASE、重复进审核台，但说不清问题在哪里。
- 你希望把“经验”沉淀成长期规则，而不是每次都重新解释一遍。
- 你需要向技术团队说明“不是功能缺失，而是路径不顺”。

#### 如果看起来不准确怎么办

这几类判断都依赖真实交互记录，因此在以下情况下可能暂时不够稳定：

- 当前案件刚开始，动作样本还很少。
- 你还没有实际点过审核、CASE 写回、记忆采纳这些入口。
- 不同案件工作方式差别很大，跨案件信号还没形成共性。

遇到这种情况，不代表系统坏了，更常见的是“证据还不够”。继续真实使用几轮后，这些判断会逐步变得更可信。

#### 案件 ID、新建案件与审核记入档案

**案件 ID（`matterId`）规则**（与引擎 `matter_id`、CLI `--matter` 一致）：

- 必须以 **字母或数字** 开头，总长 **2–128** 个字符；
- 后续字符仅可为 **字母、数字、英文点 `.`、下划线 `_`、连字符 `-`**；
- 示例合法：`matter-2026-001`、`client_a.v2`；非法示例：`-x`、空字符串、`../escape`。

**`POST /api/matters/create`**（桌面「新建案件」调用）

- 请求体 JSON：`{ "matterId": "<id>" }`（必填，trim 后不能为空）。
- 成功 **200**：`{ "ok": true, "matterId", "caseFilePath", "created" }`。`created` 为 `true` 表示本次首次创建 `cases/<matterId>/CASE.md`；已存在则幂等，不覆盖正文。
- 失败 **400**：`matterId required`（未提供或全空白）、或 `invalid matter id`（格式不合法）。

**`GET /api/matters/detail`**（桌面「案件详情」）

- 查询参数：**`matterId`**（必填；格式校验与上文一致，非法时 **400**）。
- 成功 **200**：JSON 含案件索引、任务、草稿列表等；另含 **`draftCitationIntegrity`**：以草稿的 **`taskId`** 为键的对象，值为该草稿的**引用完整性**视图（例如是否缺少 `*.research.json` 快照、是否有待核对引用），供 UI 在任务列表中的草稿行旁展示状态标识。无对应草稿的键可省略。

**`POST /api/chat` 与 `matterId`**

- 请求体可带可选字段 **`matterId`**（字符串）。省略或传 `""` 表示本轮**不**关联案件。
- 若传入非空字符串且**不符合**上述规则，接口返回 **400**，`error` 为 **`invalid matter id`**（与 `GET /api/matters/detail` 等查询参数校验一致）。

**`POST /api/drafts/<taskId>/review` 与记入助手档案**

- 除 `status`（`approved` / `rejected` / `modified`）与可选 `note` 外，可传：
  - **`appendToProfile`**：为 `true` 时，在审核成功后把一条摘要行追加到 **`assistants/<assistantId>/PROFILE.md`**（与 [LawMind 项目与记忆](/LAWMIND-PROJECT-MEMORY) 中的 per-assistant 档案一致）。
  - **`profileAssistantId`**：可选；指定写入哪个助手的档案，默认 `default`。桌面「审核」页勾选「记入本助手档案」时，与当前选中的助手 ID 对齐。
- 审核主流程（更新草稿状态）成功后再写档案；若 **PROFILE 写入失败**，返回 **500**，响应中含 **`profileAppendFailed: true`** 以及 `draft`（已更新后的草稿），便于客户端提示「状态已保存，档案未写入」。
- **`appendToLawyerProfile`**：为 `true` 时，将本条审核学习摘要写入工作区 **`LAWYER_PROFILE.md`** 的 **「八、个人积累」**（与助手级 `PROFILE.md` 区分）。写入失败时 **500**，含 **`lawyerProfileAppendFailed: true`** 与已更新的 `draft`。桌面「审核」页可单独勾选。

#### 体检（Health）与审计导出

**`GET /api/health`** 除原有 `workspaceDir`、`modelConfigured`、`retrievalMode` 等外，另返回：

- **`lawMindRoot`**：助手配置所在目录（`assistants.json`、各助手 `PROFILE.md` 同级的 LawMind 根路径）。
- **`doctor`**：`auditJsonlFileCount`（`workspace/audit` 下 `.jsonl` 文件数）、`taskCount`、`draftCount`、**`researchSnapshotCount`**（`drafts/` 下 `*.research.json` 数量）、`nodeVersion`、**`openclawPackageVersion`**（开发态若设置 `LAWMIND_REPO_ROOT` 指向 monorepo 根，可读 `package.json` 版本；安装包内可能为 `null`）。
- **`policy`**：若工作区根存在 `lawmind.policy.json` 且解析成功，则 `loaded: true` 并含 `path`、`applied`（已生效的策略键）及文件中的声明字段；否则 `loaded: false`。详见 [LawMind policy file](/LAWMIND-POLICY-FILE)。

便于 IT 或律师截图自检：**工作区路径、模型是否配置、审计文件是否在增长**。

**`GET /api/audit/export`**（Markdown 正文，`Content-Type: text/markdown`）

- 查询参数（均可选）：**`matterId`**、**`taskId`**、**`since`**、**`until`**（ISO 8601）。`matterId` 非法时 **400**。
- **`compliance=true`**（或 `compliance=1`）：输出 **合规向摘要**（含免责声明、按 `kind` 聚合计数 + 完整事件表），仍为非法律意见，供内控归档。审计中若存在 **`draft.citation_integrity`** 事件（引用完整性检查、**非阻断**），会与其他 `kind` 一并计入并出现在事件表中；其时间顺序通常早于同任务的 **`draft.reviewed`**。
- **`artifact.rendered`**：**仅在**草稿已 **approved** 且渲染成功并产生输出路径后写入 **一条** 事件；`detail` 中含解析后的模板信息、格式与磁盘路径（内控解读见 [LawMind compliance audit trail](/lawmind/compliance-audit-trail)）。
- 同时传 `taskId` 与 `matterId` 时以 **`taskId`** 为准。
- 按 `matterId` 过滤时，依据当前工作区 **`tasks/*.json`** 中的 `matterId` 与审计事件里的 `taskId` 关联。
- 响应为一段 Markdown 报告（含表头与事件表），可保存为 `.md` 备查。

**`GET /api/templates/built-in`**

- 返回内置文书模板列表（含 **`category`**：`contracts` / `litigation` / `client` / `internal`，便于 UI 分组）。

**`GET /api/collaboration/summary`**

- 返回 **`collaborationEnabled`**（环境 `LAWMIND_ENABLE_COLLABORATION` 未设为 `false` 时为开启）、**`delegationCount`**、近期 **`delegations`**，以及 **`collaboration-audit.jsonl`** 中最近若干条事件（若存在）。无委派时 **`delegationCount` 为 0** 属正常空态。集成边界见 [LawMind integrations](/LAWMIND-INTEGRATIONS)。

**`POST /api/lawyer-profile/learning`**

- 请求体：`{ "note": "…", "source": "manual" | "review" }`（`note` 必填）。向 **`LAWYER_PROFILE.md`**「八、个人积累」追加一条显式学习记录（默认 `source` 按 `review` 处理）。

**`GET /api/assistants/<assistantId>/profile-sections`**

- 返回 JSON：`{ ok, assistantId, sections }`。每个 **`sections[]`** 项含 **`stamp`**（区块时间标题）、**`body`**、**`sourceHint`**（`review` 表示正文含「草稿审核」句式，否则 `unknown`），用于展示「档案里最近写了什么、是否来自审核台」。

**开发侧回归（与本节功能对应）**

```bash
pnpm test -- src/lawmind/audit/export-report.test.ts src/lawmind/assistants/profile-md.test.ts \
  src/lawmind/integration/phase-a-golden-engine.test.ts \
  src/lawmind/memory/lawyer-profile-learning.test.ts src/lawmind/skills/bundle-manifest.test.ts \
  apps/lawmind-desktop/server/lawmind-health-payload.test.ts --run
```

#### 开发要求

本机 **Node 22+**、`tsx` 随 monorepo；若 Electron 未正确安装，在仓库根执行 `pnpm approve-builds` 并允许 `electron`。

### 安装包 / 绿色版（解压或安装后即用）

从交付方获取 **`dist:electron` 打出的产物**（详见客户交付手册 <https://docs.openclaw.ai/LAWMIND-DELIVERY> 第 6 节）：

- **macOS**：可用 **`zip`** 解压出 `LawMind.app`，双击运行；也可用 `dmg` 安装。
- **Windows**：可用 **`portable`** 绿色版，或 `nsis` 安装程序。

此类包内已包含 **Node 运行时**（用于本地 API），**无需**再在电脑上单独安装 Node。若你自行用未签名 macOS 包，首次打开可能被系统拦截，可尝试右键「打开」或按系统提示在安全设置中允许。

仓库说明：`apps/lawmind-desktop/README.md`。

---

## 2) 配置 `.env.lawmind`

所有 LawMind 命令都会自动加载项目根目录下的 `.env.lawmind`，无需手动 `source`。

- 安装时 onboard 会生成 `.env.lawmind`（或从 `.env.lawmind.example` 复制）。
- 按你使用的预设填写 API Key、Base URL、模型名等；未填时 `lawmind:env:check` 会提示缺失项。

**Agent 对话（`npm run lawmind:agent`）：**

- Agent 会优先读取 `LAWMIND_QWEN_API_KEY`、`LAWMIND_QWEN_MODEL`（与 smoke/demo 共用），无需再配 `LAWMIND_AGENT_*`。
- 若出现 **This operation was aborted**：多为模型 HTTP 超时（如起草合同等任务较慢）。CLI 默认 **60 秒**，可设 `LAWMIND_AGENT_TIMEOUT_MS=120000`（2 分钟）或更大。
- 若工具报错含 **`timed out after ...ms`**：为**单次工具**执行超时（默认与 `LAWMIND_AGENT_TIMEOUT_MS` 一致；未单独设置时桌面与 CLI 均不再固定为 30 秒）。仍不够可设 `LAWMIND_TOOL_TIMEOUT_MS=180000`（3 分钟）等。
- 若出现 **Model API error 404**：
  1. **必须在安装目录下运行**：`cd ~/.lawmind/openclaw` 后再执行 `npm run lawmind:agent`，否则不会加载该目录下的 `.env.lawmind`。
  2. 启动时会有 `[LawMind Agent] model=xxx baseUrl=xxx cwd=xxx`，请确认 **model** 和 **cwd** 是否符合预期（cwd 应为安装目录）。
  3. 若 model 正确仍 404，可尝试改为 DashScope 文档中列出的其他 ID（如 `qwen-plus`、`qwen-turbo`），或用 `curl -sS "https://dashscope.aliyuncs.com/compatible-mode/v1/models" -H "Authorization: Bearer $LAWMIND_QWEN_API_KEY"` 查看当前可用模型列表，使用返回的 `id` 作为 `LAWMIND_AGENT_MODEL` / `LAWMIND_QWEN_MODEL`。

**预设说明：**

- **qwen-only**（一键安装默认）：无本地法律模型时，通用与法律检索均走 Qwen。只需填写 `LAWMIND_QWEN_API_KEY`、`LAWMIND_QWEN_MODEL`，并将 `LAWMIND_CHATLAW_API_KEY` 设为与 Qwen 相同的 Key，即可通过 `lawmind:env:check --strict` 和 `lawmind:smoke --fail-on-empty-claims`。
- **qwen-chatlaw**：需本地 ChatLaw 服务（如 `http://127.0.0.1:8000/v1`），并配置 `LAWMIND_CHATLAW_*`。
- 其他预设（deepseek-lawgpt、general-lexedge、general-partner）需对应变量，详见 `npm run lawmind:env:check` 输出。

**从 qwen-only 改用本地法律模型：**

- **方式一（推荐）**：直接编辑 `.env.lawmind`，把法律模型相关变量改为本地服务即可，例如：
  - `LAWMIND_CHATLAW_BASE_URL=http://127.0.0.1:8000/v1`
  - `LAWMIND_CHATLAW_API_KEY=local`（若本地无需 key 可填 `local`）
  - `LAWMIND_CHATLAW_MODEL=chatlaw`（与本地服务实际模型名一致）
- **方式二**：重新生成模板（会覆盖现有 `.env.lawmind`，注意备份已填的 Key）：
  - `npm run lawmind:onboard -- --preset qwen-chatlaw --yes --skip-smoke`
  - 然后按提示补全 `LAWMIND_QWEN_*` 与 `LAWMIND_CHATLAW_*`。

切换后执行 `npm run lawmind:env:check` 确认，再跑 `npm run lawmind:smoke -- --fail-on-empty-claims` 验证。

---

## 3) 日常使用命令（均在安装目录下执行）

以下命令均需在 **`~/.lawmind/openclaw`**（或你的 `LAWMIND_INSTALL_DIR`）下执行。

### 3.1 智能助理（Agent）

```bash
npm run lawmind:agent
```

- 交互式对话，可查案件、查任务、写文书、看审计等。
- 恢复历史对话：`npm run lawmind:agent -- --session <sessionId>`
- 关联案件：`npm run lawmind:agent -- --matter <matterId>`
- 单次指令（非交互）：`npm run lawmind:agent -- --message "请列出当前所有案件"`
- 列出历史会话：`npm run lawmind:agent -- --list-sessions`

### 3.2 案件与任务

**查看案件列表：**

```bash
npm run lawmind:case
```

**查看某一案件详情与检索：**

```bash
npm run lawmind:case -- --matter <matterId>
npm run lawmind:case -- --matter <matterId> --search <query>
```

### 3.3 任务审核（草稿审批）

```bash
npm run lawmind:review
```

- 按提示对草稿执行：approve / reject / modified / render / skip。
- 指定任务：`npm run lawmind:review -- --task <taskId>`

### 3.4 运维与健康

**状态面板（matter / task / draft / session 数量与分布）：**

```bash
npm run lawmind:ops -- status
```

**健康检查：**

```bash
npm run lawmind:ops -- doctor
```

**深度检查（含 smoke）：**

```bash
npm run lawmind:ops -- doctor --deep
```

### 3.5 烟雾测试与演示

**烟雾测试：**

```bash
npm run lawmind:smoke -- --fail-on-empty-claims
```

**客户演示（一键流程接单→执行→交付）：**

```bash
npm run lawmind:demo
# 一键生成 PPT：
npm run lawmind:demo -- --ppt
```

Demo 使用内置指令，无需输入：默认「合同审查 + 法律备忘录」→ `.docx`；加 `--ppt` 为「案件进展汇报」→ `.pptx`。结束后终端会打印**生成结果位置**（如 `workspace/artifacts/...docx` 或 `.pptx`），可用 Word / PowerPoint 或 `open <路径>` 打开。

---

## 4) 工作区目录说明（workspace）

安装目录下的 `workspace/` 为运行数据与产出目录，建议不要手动乱改，便于备份与排查。

| 路径                                 | 说明                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| `workspace/MEMORY.md`                | 运行日志与日常上下文                                      |
| `workspace/LAWYER_PROFILE.md`        | 律师画像/偏好                                             |
| `workspace/cases/<matterId>/CASE.md` | 案件上下文与进展                                          |
| `workspace/tasks/*.json`             | 任务状态（researched / drafted / reviewed / rendered 等） |
| `workspace/drafts/*.json`            | 草稿与审核状态                                            |
| `workspace/artifacts/`               | 渲染产出（Word / PPT）                                    |
| `workspace/audit/*.jsonl`            | 审计事件                                                  |
| `workspace/memory/YYYY-MM-DD.md`     | 按日记忆（若有）                                          |

Agent 会话数据在 `workspace/` 下由引擎维护（如 sessions）。

---

## 5) 更新安装

若安装目录已是 git 仓库，再次执行**同一安装命令**会执行拉取与更新：

```bash
curl -fsSL https://raw.githubusercontent.com/openclaw/openclaw/main/scripts/install-lawmind.sh | bash
```

脚本会检测 `~/.lawmind/openclaw` 下已有 `.git`，执行 `git fetch` / `checkout` / `pull`，然后 `pnpm install` 和 onboard。也可在安装目录内手动：

```bash
cd ~/.lawmind/openclaw
git pull --rebase origin main
pnpm install
```

---

## 6) 常见问题

- **命令找不到 / 报错找不到模块**  
  确认当前目录为安装目录（`~/.lawmind/openclaw`），且已执行过 `pnpm install`。

- **Agent 报未设置 API Key**  
  在安装目录下编辑 `.env.lawmind`，填写 `LAWMIND_AGENT_*` 或 `QWEN_*` 等变量，保存后重试。

- **env check 报缺少某服务变量**  
  按提示补全对应预设所需的环境变量；参考 `.env.lawmind.example` 或交付文档中的预设说明。

- **smoke 报 `real model returned no claims`**  
  表示检索阶段使用的真实模型返回了 0 条结论。请查看报错上方的 Diagnostic 输出（`riskFlags` / `missingItems`）。常见原因：模型返回非 JSON、HTTP 鉴权失败、或返回的 JSON 中 `claims` 为空/格式不符合要求。处理：运行 `npm run lawmind:env:check` 确认检索用变量（如 ChatLaw/LawGPT/Qwen 等）正确；或先不加 `--fail-on-empty-claims` 跑通流程后再排查模型输出格式。

- **想改安装目录**  
  安装前设置：`export LAWMIND_INSTALL_DIR=/your/path`，再执行一键安装。

---

## 7) 相关文档

- **客户交付与验收**：[LawMind 交付](/LAWMIND-DELIVERY)（交付清单、验收命令、演示）
- **产品与架构**：[LawMind 愿景](/LAWMIND-VISION)、[LawMind 项目与记忆](/LAWMIND-PROJECT-MEMORY)
- **私有化与包校验**：[LawMind 私有化部署](/LAWMIND-PRIVATE-DEPLOY)、[LawMind 包清单与校验](/LAWMIND-BUNDLES)

本文档与 `scripts/install-lawmind.sh`、`LAWMIND-DELIVERY.md` 保持同步；新增或变更用户可见命令、桌面本地 API（如 `matters/create`、聊天 `matterId`、审核 `appendToProfile`）时请一并更新本使用手册。
