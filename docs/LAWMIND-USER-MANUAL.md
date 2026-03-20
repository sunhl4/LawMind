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

## 2) 配置 `.env.lawmind`

所有 LawMind 命令都会自动加载项目根目录下的 `.env.lawmind`，无需手动 `source`。

- 安装时 onboard 会生成 `.env.lawmind`（或从 `.env.lawmind.example` 复制）。
- 按你使用的预设填写 API Key、Base URL、模型名等；未填时 `lawmind:env:check` 会提示缺失项。

**Agent 对话（`npm run lawmind:agent`）：**

- Agent 会优先读取 `LAWMIND_QWEN_API_KEY`、`LAWMIND_QWEN_MODEL`（与 smoke/demo 共用），无需再配 `LAWMIND_AGENT_*`。
- 若出现 **This operation was aborted**：多为模型响应超时（如起草合同等任务较慢）。默认已改为 60 秒；仍超时可设 `LAWMIND_AGENT_TIMEOUT_MS=120000`（2 分钟）。
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

- **客户交付与验收**：`docs/LAWMIND-DELIVERY.md`（交付清单、验收命令、演示）
- **产品与架构**：`docs/LAWMIND-VISION.md`、`docs/LAWMIND-PROJECT-MEMORY.md`

本文档与 `scripts/install-lawmind.sh`、`LAWMIND-DELIVERY.md` 保持同步；新增或变更用户可见命令时请一并更新本使用手册。
