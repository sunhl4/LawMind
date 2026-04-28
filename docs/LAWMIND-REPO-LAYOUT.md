# LawMind 仓库目录结构

本文说明 **本 monorepo 在 GitHub 上的职责划分**：哪些目录是产品代码、哪些是文档源、哪些是本地运行数据，便于贡献者与发布流程对齐。

## 顶层一览

| 路径                    | 职责                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lawmind/`          | **法律引擎**（任务、草稿、Agent、策略、模板、检索、审计等）。TypeScript ESM，`pnpm test` 覆盖此处与各桌面单测。                                                                             |
| `apps/lawmind-desktop/` | **Electron 桌面**：`electron/` 主进程、`src/renderer/` 前端、`server/` 本地 HTTP API 源码；构建产物见各子目录 `.gitignore`。                                                                |
| `apps/lawmind-docs/`    | **文档站**（VitePress）。开发/构建前会执行 `pnpm run sync`，把根目录 `docs/LAWMIND-*.md` 与 `docs/lawmind/` 复制进 `apps/lawmind-docs/docs/`（复制内容默认不单独提交，见根 `.gitignore`）。 |
| `docs/`                 | **文档单一事实来源**：对外手册与工程笔记；改文稿请只编辑此树。`docs/examples/` 含策略文件样例。                                                                                             |
| `scripts/`              | **CLI 与运维**：可执行入口集中在 **`scripts/lawmind/`**（`pnpm lawmind:*`）；**`scripts/pre-commit/`** 供 git hooks 使用。                                                                  |
| `test/`                 | Vitest 全局 `setupFiles`（如 `lawmind-setup.ts`）。                                                                                                                                         |
| `workspace/`            | **开发/演示用工作区盘面**：可提交 **模板、playbooks、示例 cases、通用 MEMORY 样例**；任务、草稿、会话、审计、产物等运行数据由 `workspace/.gitignore` 排除，勿推送到公开仓库。               |
| `.github/`              | CI（`lawmind-*.yml`、CodeQL 等）与模板。                                                                                                                                                    |

## 引擎分层（`src/lawmind/`）

以下为心智模型，不必与文件夹一一 rigid 对应，但利于导航：

- **`agent/`** — Agent 循环、工具、协作、会话持久化约定（磁盘布局仍落在「工作区」根目录，见用户手册）。
- **`application/`** — 应用层服务（如 matter/queue）。
- **`artifacts/`** — DOCX/PPTX 渲染与法律排版辅助。
- **`audit/`** — 审计事件写入约定。
- **`deliverables/`、`drafts/`、`delivery/`** — 交付物注册、草稿与验收包等。
- **`memory/`** — 工作区记忆加载与来源报告。
- **`policy/`** — 版本、工作区策略、治理报告。
- **`reasoning/`、`retrieval/`、`router/`、`tasks/`、`templates/`** — 推理、检索、路由、任务状态、模板填充。

## 工作区与工作副本

- **仓库内 `workspace/`**：适合放**可公开的骨架**（templates、`playbooks/`、`cases/demo-matter-001/`、示例 `MEMORY.md` 等）。
- **真实律师数据**（任务 JSON、草稿、session、审计、artifacts）应只在本地或私有化部署磁盘上存在；公开推送前请确认未被 `git add`（由 `workspace/.gitignore` 与根 `.gitignore` 兜底）。

## 文档站同步

```bash
pnpm lawmind:docs:dev    # 开发（会先 sync）
pnpm lawmind:docs:build  # 构建静态站
```

源文件始终在 **`docs/`**；不要在只存在于 `apps/lawmind-docs/docs/` 的同步副本上长期改稿。

## 本地克隆目录名

Git 克隆后的**父文件夹名称可以随意**（例如 `lawmind` 或仍名为历史目录）；工具链只认 **`package.json` 位于仓库根**与可选环境变量 **`LAWMIND_REPO_ROOT` 指向该根**。无需为「改名磁盘目录」而改代码。

## CI 相关

- **`fixtures/lawmind-workspace/`**（可选）：若存在 `fixtures/lawmind-workspace/tasks/`，交付门禁工作流会对该目录做严格扫描；无则跳过。
- 锁文件：**`pnpm-lock.yaml` 应提交**，以便 `pnpm install --frozen-lockfile` 可在 CI 复现依赖。

## 与私有化部署的关系

Electron 默认将用户数据（含工作区、`.env.lawmind`）放在操作系统 **用户数据目录** 下的 `LawMind/`，与克隆下来的仓库内 `workspace/` 相互独立；详情请见 `LAWMIND-PRIVATE-DEPLOY` 与用户手册。
