# LawMind 仓库目录结构

本文说明 **本 monorepo 在 GitHub 上的职责划分**：哪些目录是产品代码、哪些是文档源、哪些是本地运行数据，便于贡献者与发布流程对齐。

## 当前仓库状态（2026-09）

近两轮改动后，引擎侧新增多个专业模块：`src/lawmind/clause/` 提供合同条款 DSL 与 AST；`src/lawmind/platform/outbound-proxy.ts` 与 `runtime/tool-pipeline.ts` / `agent/dangerous-tool-policy.ts` 构成出口代理与命令网关；`src/lawmind/audit/hash-chain.ts` 与 `root-anchor.ts` 支撑审计完整性；`src/lawmind/evaluation/shadow-engine-replay.ts` 提供合成影子回放；`apps/lawmind-desktop/src/renderer/stores/` 承载前端局部状态。`src/lawmind/metrics/` 补齐运行时与产品质量指标。上述模块与既有 `agent/`、`memory/`、`deliverables/` 共同组成第十四期法律一致性编译器底座。

文档已做减法：现行有效入口仅顶部「现行文档清单」中的 9 篇，历史快照封存于 `docs/archive/`（只读）。新增或修改文档请优先刷新这 9 篇，并遵循 [LAWMIND-TERMINOLOGY.md](./LAWMIND-TERMINOLOGY.md) 的一动作一词规范。

运行验收：引擎与桌面单测使用 `pnpm test`；桌面类型检查使用 `pnpm --filter lawmind-desktop typecheck`；文档站构建使用 `pnpm lawmind:docs:build`； nightly CI 还跑 `pnpm lawmind:verify` 与 `pnpm lawmind:compiler-gate`。

## 现行文档清单（2026-09-03 起）

「文档体系减法」后，**现行文档仅以下 9 篇**；其余历史文档只读封存于 [`docs/archive/`](./archive/README.md)，口径以现行文档为准。

| 文档                                                                     | 职责                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`GOALS.md`](../GOALS.md)（根目录）                                      | 目标与进度单一入口：产品原则、当前期次、未完成项；历史期次见 `CHANGELOG.md` |
| [`SECURITY.md`](../SECURITY.md)（根目录）                                | 安全策略、信任模型与加固基线                                                |
| [LAWMIND-ARCHITECTURE.md](./LAWMIND-ARCHITECTURE.md)                     | 架构与模块边界（现状版）                                                    |
| [LAWMIND-LAWYER-QUICKSTART.md](./LAWMIND-LAWYER-QUICKSTART.md)           | 律师图文快速指南（非技术语言）                                              |
| [LAWMIND-TERMINOLOGY.md](./LAWMIND-TERMINOLOGY.md)                       | 术语表：一动作一词 + 工程师语言禁词表（与 `lawmind:ui-copy-lint` 呼应）     |
| [LAWMIND-DELIVERY.md](./LAWMIND-DELIVERY.md)                             | 客户交付手册（安装、验收、备份升级）                                        |
| [LAWMIND-LEGAL-COMPILER-ROADMAP.md](./LAWMIND-LEGAL-COMPILER-ROADMAP.md) | 法律一致性编译器 500 人天计划（WS0–WS6）                                    |
| [LAWMIND-FUTURE-ISSUES.md](./LAWMIND-FUTURE-ISSUES.md)                   | 已识别、长期回看项（sprint 以外）                                           |
| [LAWMIND-REPO-LAYOUT.md](./LAWMIND-REPO-LAYOUT.md)                       | 本文：仓库职责划分与文档清单                                                |

写作规范：新增文档一律进 `docs/archive/` 之外需先评审；用词遵循 [LAWMIND-TERMINOLOGY.md](./LAWMIND-TERMINOLOGY.md)。

## 顶层一览

| 路径                    | 职责                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lawmind/`          | **法律引擎**（任务、草稿、Agent、策略、模板、检索、审计等）。TypeScript ESM，`pnpm test` 覆盖此处与各桌面单测。                                                                                  |
| `apps/lawmind-desktop/` | **Electron 桌面**：`electron/` 主进程、`src/renderer/` 前端、`server/` 本地 HTTP API 源码；构建产物见各子目录 `.gitignore`。                                                                     |
| `apps/lawmind-docs/`    | **文档站**（VitePress）。开发/构建前会执行 `pnpm run sync`，把根目录 `docs/LAWMIND-*.md` 与 `docs/lawmind/` 复制进 `apps/lawmind-docs/docs/`（复制内容默认不单独提交，见根 `.gitignore`）。      |
| `docs/`                 | **文档单一事实来源**：现行文档见顶部「现行文档清单」；历史文档封存于 **`docs/archive/`**（只读，口径以现行为准）。`docs/examples/` 含策略文件样例。长期回看项见 **`LAWMIND-FUTURE-ISSUES.md`**。 |
| `scripts/`              | **CLI 与运维**：可执行入口集中在 **`scripts/lawmind/`**（`pnpm lawmind:*`）；**`scripts/pre-commit/`** 供 git hooks 使用。                                                                       |
| `test/`                 | Vitest 全局 `setupFiles`（如 `lawmind-setup.ts`）。                                                                                                                                              |
| `workspace/`            | **开发/演示用工作区盘面**：可提交 **模板、playbooks、示例 cases、通用 MEMORY 样例**；任务、草稿、会话、审计、产物等运行数据由 `workspace/.gitignore` 排除，勿推送到公开仓库。                    |
| `.github/`              | CI（`lawmind-*.yml`、CodeQL 等）与模板。                                                                                                                                                         |

## 引擎分层（`src/lawmind/`）

以下为心智模型，不必与文件夹一一 rigid 对应，但利于导航：

- **`agent/`** — Agent 循环、工具、协作、会话持久化约定（磁盘布局仍落在「工作区」根目录，见用户手册）。
- **`application/`** — 应用层服务（如 matter/queue）。
- **`artifacts/`** — DOCX/PPTX 渲染与法律排版辅助。
- **`audit/`** — 审计事件写入约定。
- **`deliverables/`、`drafts/`、`delivery/`** — 交付物注册、草稿与验收包等。
- **`lint/`** — 机械一致性核对（advisory；通过 ≠ 法律正确）。
- **`metrics/`** — 律师可观测性指标与 north-star 统计。`lawyer-dashboard.ts` 提供案件级真实指标（机械核对覆盖率、律师编辑率、一次通过率、待拍板/逾期任务等），不输出无法验证的「安全分」。详见 `src/lawmind/metrics/README.md`。
- **`historical-scan/`** — 历史材料多根扫描与习惯入队。
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

## 文档索引

现行文档见顶部「**现行文档清单**」，不再单列。历史文档（原桌面 UI 约定、三条铁律改动清单、集成矩阵、借鉴清单、用户手册等）全部封存于 [`docs/archive/`](./archive/README.md)；`docs/lawmind/` 为平台契约与 multitask 工程笔记树（被 `lawmind:multitask:validate` 等脚本读取，保持原位）。

## CI 相关

- **`fixtures/lawmind-workspace/`**（可选）：若存在 `fixtures/lawmind-workspace/tasks/`，交付核对工作流会对该目录做严格扫描；无则跳过。
- 锁文件：**`pnpm-lock.yaml` 应提交**，以便 `pnpm install --frozen-lockfile` 可在 CI 复现依赖。

## 与私有化部署的关系

Electron 默认将用户数据（含工作区、`.env.lawmind`）放在操作系统 **用户数据目录** 下的 `LawMind/`，与克隆下来的仓库内 `workspace/` 相互独立；详情请见归档文档 `docs/archive/LAWMIND-PRIVATE-DEPLOY.md` 与 `docs/archive/LAWMIND-USER-MANUAL.md`（历史快照）。
