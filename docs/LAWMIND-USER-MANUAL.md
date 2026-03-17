# LawMind 使用手册

本文档面向**一键安装后的日常使用**，随功能与脚本变更持续维护。若你尚未安装，请先执行：

```bash
curl -fsSL https://raw.githubusercontent.com/openclaw/openclaw/main/scripts/install-lawmind.sh | bash
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

**Agent 对话所需（至少其一）：**

- `LAWMIND_AGENT_API_KEY`、`LAWMIND_AGENT_BASE_URL`、`LAWMIND_AGENT_MODEL`  
  或
- `QWEN_API_KEY`、`QWEN_BASE_URL`、`QWEN_MODEL`

**其他预设（如 qwen-chatlaw）** 需对应 ChatLaw/LawGPT/Partner Legal 等变量，详见 `lawmind:env:check` 输出或 `.env.lawmind.example`。

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
```

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
| `workspace/artifacts/`               | 渲染产出（如 Word）                                       |
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
