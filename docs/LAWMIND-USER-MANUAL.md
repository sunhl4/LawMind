# LawMind 使用手册（完整版）

本文档面向**正式交付后的律师与运维**，覆盖 **桌面应用（主路径）** 与可选的命令行/Git 工作流。功能随版本迭代，请以随版本发布的说明为准。

**重要声明**：LawMind 输出为**辅助草稿与研判材料**，**不构成法律意见**。对外提交、签署或送达前，须由执业律师完成复核与定稿。数据处理边界见 [LawMind 数据处理说明](/LAWMIND-DATA-PROCESSING)。

---

## 目录

1. [产品定位与重要声明](#1-产品定位与重要声明)
2. [桌面版快速上手（推荐路径）](#2-桌面版快速上手推荐路径)
3. [推荐工作流：从接案到可交付件](#3-推荐工作流从接案到可交付件)
4. [设置、多助手与版本](#4-设置多助手与版本)
5. [文件、材料与对话上下文](#5-文件材料与对话上下文)
6. [联网检索与策略](#6-联网检索与策略)
7. [案件工作台与各面板](#7-案件工作台与各面板)
8. [技术附录：案件 ID 与本地 API 要点](#8-技术附录案件-id-与本地-api-要点)
9. [命令行与 Git 安装（可选）](#9-命令行与-git-安装可选)
10. [配置 `.env.lawmind`](#10-配置-envlawmind)
11. [日常使用命令（安装目录下）](#11-日常使用命令安装目录下)
12. [工作区目录说明](#12-工作区目录说明)
13. [更新 LawMind](#13-更新-lawmind)
14. [常见问题](#14-常见问题)
15. [相关文档索引](#15-相关文档索引)
16. [离线阅读与打印（PDF）](#16-离线阅读与打印pdf)

---

## 1. 产品定位与重要声明

**LawMind** 是面向律师的 **本机优先（local-first）工作台风**：在受控工作区内完成任务拆解、检索与草稿、**人工审核**与 **Word/PPT 等交付**，并保留可导出的审计线索。

- **我们不是**泛用聊天框或 Word 替代品，而是 **「任务 + 材料 + 审核 + 交件」** 闭环工具。
- **您的材料默认留在本机工作区**；大模型由您配置的 API 提供，适用您的采购与合规安排。

一页英文客户概览：[LawMind customer overview](/LAWMIND-CUSTOMER-OVERVIEW)。

---

## 2. 桌面版快速上手（推荐路径）

### 2.1 获取与安装

| 方式           | 说明                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **智能下载页** | 浏览器打开 [桌面下载页](https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html)（按系统高亮推荐包）；企业 fork 可在 URL 加 `?repo=组织/仓库`。 |
| **安装说明**   | 图文步骤见仓库 [`apps/lawmind-desktop/INSTALL.md`](https://github.com/lawmind/lawmind/blob/main/apps/lawmind-desktop/INSTALL.md)。                                                |
| **交付包**     | 自 [LawMind 客户交付](/LAWMIND-DELIVERY) 或供应商处获取对应 **Windows / macOS / Linux** 的 `exe` / `dmg` / `zip` / `AppImage` 等。                                                |

**打包版无需单独安装 Node.js**：安装包内含运行本地 API 所需的 Node 运行时。

- **macOS** 未签名测试包：首次可 **右键 → 打开**；广泛分发需 **签名与公证**（见交付清单）。
- **Windows** 遇 SmartScreen：建议使用 **Authenticode 签名** 的安装包（见交付文档）。

### 2.2 首次启动

1. 完成 **API 配置向导**（模型 Key、可选 Base URL、模型名、工作区路径等）。配置写入本机用户目录下的 LawMind 数据区（含 `.env.lawmind` 与 `desktop-config.json`）。
2. 开发模式（`pnpm lawmind:desktop`）下：本地服务会合并 **仓库根目录** 与 **用户目录** 的环境配置，**后者覆盖前者**；若命令行正常而桌面报 **401 / API Key 无效**，请优先核对用户目录 `.env.lawmind`。
3. （可选）跟随 **首次引导**：选择角色与模板、创建首个案件与首条提示，见 [Deliverable-First 与首跑](/LAWMIND-DELIVERABLE-FIRST) 中 P5 说明。

### 2.3 主界面：四大模块

桌面端为 **左侧边栏 + 右侧主工作台**（详见 [桌面端 UI 约定](/LAWMIND-DESKTOP-UI)）。

| 模块     | 用途（律师可这样理解）                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| **对话** | 与当前选中的 **智能体** 自然语言协作；可附带「本回合重点材料」（顶栏引用标签）。                                 |
| **文件** | 浏览、编辑工作区/项目内文本，并把文件标为对话上下文；详见 [文件页与上下文](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)。 |
| **案件** | **案件驾驶舱**：本案材料、任务、草稿、CASE 档案与进度摘要。                                                      |
| **审核** | **对外交付前的律师把关**：批准 / 退回 / 修改、引用完整性、**验收门禁**、可选导出验收包。                         |

**侧边栏**：帮助「?」、设置齿轮、文件树、助手切换、项目药丸、可折叠的工作记录（按助手过滤）。

### 2.4 交付、验收门禁与审核台

- **Deliverable-First**：每一类交付物有可执行的 **规格与验收清单**；渲染前可触发 **验收门禁**（validator），避免「未完稿就导出」。产品化说明见 [Deliverable-First 架构](/LAWMIND-DELIVERABLE-FIRST)。
- **审核台**可勾选将学习摘要写入 **助手档案**（`PROFILE.md`）或 **律师档案**（`LAWYER_PROFILE.md`）指定章节；失败时接口会区分「草稿状态已更新 / 档案未写入」。

### 2.5 更新与支持

- **应用内更新**：菜单 **帮助 → 检查更新**；设置中 **应用更新**。依赖 **GitHub Release** 与 `electron-builder` 生成的 `latest*.yml`（发布检查单见 `apps/lawmind-desktop/RELEASE-CHECKLIST.md`）。企业可设置 **`LAWMIND_SKIP_AUTO_UPDATE=1`** 关闭自动检查。
- **下载页**：**帮助 → 下载安装包** 或智能下载页。
- **排障**：律师向常见问题见本文 [§14](#14-常见问题)；运维见 [Support runbook](/LAWMIND-SUPPORT-RUNBOOK)。

---

## 3. 推荐工作流：从接案到可交付件

1. **建案件**：在案件模块创建符合规则的 `matterId`（格式见 [§8](#8-技术附录案件-id-与本地-api-要点)），将材料放入工作区或关联项目目录。
2. **对话下指令**：在对话中说明交付物类型、事实与立场；在文件页把关键证据/合同标为本轮上下文。
3. **跟任务与草稿**：在案件或侧栏查看任务；草稿成熟后进入 **审核**。
4. **审核通过再渲染**：对对外文件执行 **审核通过** 后再导出 Word 等；关注 **引用完整性** 与 **验收清单**。
5. **沉淀（可选）**：审核时勾选写入档案，便于下个案子复用风格与禁忌。

---

## 4. 设置、多助手与版本

打开 **设置**（齿轮图标）：

1. **就绪 / 首次引导**：API 与路径就绪情况。
2. **协作与多智能体**：后台委派与流程（受环境与策略控制）；详见 [集成与边界](/LAWMIND-INTEGRATIONS)。
3. **智能体（助手）**：新建/编辑/删除助手、岗位预设、使用统计；对话请求带 `assistantId`。默认助手 `default` 不可删。侧栏工作记录按当前助手过滤。
4. **模型与检索**：**统一模型** 或 **通用 + 法律专用**；法律端点未配置时回退通用。`GET /api/health` 中 `dualLegalConfigured` 等字段可自检。
5. **工作区与项目**：工作区目录、项目目录；项目路径会随对话请求传给后端。
6. **模板 / 版本与交付物**：文书模板、**Edition（solo/firm/private）** 可见功能；详见 [Deliverable-First](/LAWMIND-DELIVERABLE-FIRST) 与策略文件 [policy file](/LAWMIND-POLICY-FILE)。
7. **应用更新**：版本号、检查更新、打开下载页（见 §2.5）。

**超时**：模型默认约 **120s**（`LAWMIND_AGENT_TIMEOUT_MS`）；工具超时默认跟随，可单独调大 `LAWMIND_TOOL_TIMEOUT_MS`（见 §10）。

---

## 5. 文件、材料与对话上下文

「文件」页用于浏览、编辑文本，以及把路径标为 **本轮对话重点材料**。多文件可多次添加；上限与注意点见 [桌面端：文件页、对话引用](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)。

澄清类问题可能在输入区上方显示 **待澄清提示条**（[UI 约定](/LAWMIND-DESKTOP-UI) §4.1）。

---

## 6. 联网检索与策略

- 主界面可勾选 **允许联网检索**（需配置 `LAWMIND_WEB_SEARCH_API_KEY` 或 `BRAVE_API_KEY`）。未勾选时仅用工作区与本地检索工具。
- 工作区 **`lawmind.policy.json`** 可将 `allowWebSearch` 设为 `false`，服务器将**强制关闭**联网检索（即使 UI 勾选）。健康检查中的 `policy` 字段可确认是否加载。

选型说明：[LawMind 联网检索路径](/LAWMIND-NETWORK-OPTIONS)。

---

## 7. 案件工作台与各面板

可把 **案件工作台** 理解为「本案驾驶舱」：左边是本案材料、任务、草稿、CASE 与审计；右边是根据您最近操作生成的 **进度摘要与下一步建议**。

下列区块按 **从事实到判断** 阅读（**不是法律结论**，不替代您的专业判断）：

1. **最近律师动作**：如进入审核、写回 CASE、沉淀记忆等事实记录。
2. **律师行为摘要**：在审核/CASE/记忆等面上的集中程度，帮助回答「主工作面在哪」。
3. **交互收敛建议**：**本案下一步** 操作建议（入口级）。
4. **产品改造建议**：从重复操作中抽象出的 **体验改进方向**（给产品/技术沟通用）。
5. **产品实验清单**：可验证的实验假设与信号。
6. **跨案件实验累积板**：多案件重复模式，区分偶发与共性问题。
7. **Roadmap 候选池 / 路线图决策卡**：更接近排期语言的归纳（非必须细读）。

**易误解点**：这些区块**不是监控律师**，而是减少重复路径；**不自动替您决定**是否批准对外文书。

**若看起来不准**：常见于样本少、尚未使用审核/CASE 等入口；继续使用后会逐步稳定。

**案件 ID（`matterId`）**：须以 **字母或数字** 开头，总长 **2–128**，仅含字母数字与 `.` `_` `-`。示例合法：`matter-2026-001`；非法：`-x`、`../escape`。桌面「新建案件」与 `POST /api/matters/create` 使用同一规则。

---

## 8. 技术附录：案件 ID 与本地 API 要点

以下供 **运维、集成与进阶用户** 自查（桌面本地 API 默认仅监听 **127.0.0.1**）。

### 8.1 案件与草稿接口（节选）

- **`POST /api/matters/create`**：体 `{"matterId":"…"}`；成功返回 `caseFilePath`、`created`。幂等。
- **`GET /api/matters/detail`**：查询 `matterId`；含任务、草稿列表与 **`draftCitationIntegrity`**（引用完整性视图）。
- **`POST /api/chat`**：可选 `matterId`；非法 ID 返回 **400** `invalid matter id`。
- **`POST /api/drafts/<taskId>/review`**：审核；可选 `appendToProfile`、`profileAssistantId`、`appendToLawyerProfile`。档案写入失败时返回 **500** 及 `profileAppendFailed` / `lawyerProfileAppendFailed` 等标志。

### 8.2 健康与审计

- **`GET /api/health`**：含 `workspaceDir`、`modelConfigured`、`retrievalMode`、`lawMindRoot`、`doctor`（审计文件数、任务/草稿/研究快照计数等）、**`policy`**（是否加载 `lawmind.policy.json`）。
- **`GET /api/audit/export`**：Markdown 审计导出；支持 `compliance=true`、时间范围与 `matterId` / `taskId` 过滤。

### 8.3 其他

- **`GET /api/templates/built-in`**：内置模板列表（含 `category`）。
- **`GET /api/collaboration/summary`**：协作开关与委派摘要。
- **`POST /api/lawyer-profile/learning`**：向 `LAWYER_PROFILE.md` 追加学习记录。
- **`GET /api/assistants/<id>/profile-sections`**：档案段落展示用。

开发回归可参考仓库内 `lawmind-health-payload`、`export-report` 等测试。

---

## 9. 命令行与 Git 安装（可选）

> **说明**：若贵司交付包提供 **独立一键安装脚本**（历史上有基于其他 Git 宿主的脚本），请以 **交付方书面文档** 中的仓库与命令为准。以下以 **本仓库（LawMind 桌面与引擎同源）** 为例。

从源码安装目录（示例为 `~/.lawmind/checkout`，可用 `LAWMIND_INSTALL_DIR` 自定义）：

```bash
cd ~/.lawmind/checkout
pnpm install
npm run lawmind:env:check
```

桌面**开发**（需在仓库根已 `pnpm install`）：

```bash
pnpm lawmind:desktop
```

打包桌面应用（在对应 OS 上构建，与 CI 一致）：

```bash
pnpm lawmind:desktop:dist
```

若为 **git 仓库**更新：

```bash
cd <安装目录>
git pull --rebase origin main
pnpm install
```

（勿将不可信的 `curl | bash` 用于生产环境，除非已完成贵司安全审批。）

---

## 10. 配置 `.env.lawmind`

LawMind 会自动加载 **项目/工作区** 使用的 `.env.lawmind`。一键 onboard 会生成模板；桌面向导也会写入用户目录副本。

**Agent / 对话模型**：

- 常见：`LAWMIND_QWEN_API_KEY`、`LAWMIND_QWEN_MODEL`；与 `LAWMIND_AGENT_*` 对齐方式见环境检查输出。
- **超时 / 中止**：慢任务可调大 `LAWMIND_AGENT_TIMEOUT_MS`、**`LAWMIND_TOOL_TIMEOUT_MS`**。
- **404 / model 不存在**：确认在安装目录执行、cwd 正确；用服务商 API 列出可用模型 ID。

**预设**：`qwen-only`、`qwen-chatlaw`、deepseek-lawgpt 等所需变量见 `lawmind:env:check` 与示例 `.env.lawmind.example`。切换到本地法律服务时，配置 `LAWMIND_CHATLAW_*` 等并重新自检。

---

## 11. 日常使用命令（安装目录下）

在 **克隆后的 monorepo 根目录**（或使用交付方约定的命令前缀）执行：

| 用途            | 命令                                                               |
| --------------- | ------------------------------------------------------------------ |
| 智能助理        | `pnpm lawmind:agent`（或 `npm run lawmind:agent`，以交付文档为准） |
| 案件列表/详情   | `pnpm lawmind:case` / `pnpm lawmind:case -- --matter <id>`         |
| 草稿审核（CLI） | `pnpm lawmind:review`                                              |
| 运维状态/体检   | `pnpm lawmind:ops -- status` / `doctor` / `doctor --deep`          |
| 烟雾测试        | `pnpm lawmind:smoke -- --fail-on-empty-claims`                     |
| 客户演示        | `pnpm lawmind:demo`（`--ppt` 生成演示 PPT）                        |

具体脚本名以仓库 `package.json` 为准（部分文档写作 `npm run` 等价）。

---

## 12. 工作区目录说明

`workspace/` 为运行数据与产出目录，建议定期备份，勿手工删改关键 JSON/任务文件。

| 路径                                 | 说明                |
| ------------------------------------ | ------------------- |
| `workspace/MEMORY.md`                | 运行日志与上下文    |
| `workspace/LAWYER_PROFILE.md`        | 律师画像与偏好      |
| `workspace/cases/<matterId>/CASE.md` | 案件档案            |
| `workspace/tasks/*.json`             | 任务状态            |
| `workspace/drafts/*.json`            | 草稿与审核状态      |
| `workspace/artifacts/`               | Word/PPT 等渲染产出 |
| `workspace/audit/*.jsonl`            | 审计事件            |
| `workspace/memory/`                  | 按日记忆（若有）    |

助手档案：`LawMind/assistants.json`、各助手 `PROFILE.md`（路径随桌面 `lawMindRoot` 配置，健康检查可见）。

---

## 13. 更新 LawMind

| 形态           | 方式                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| **桌面打包版** | 应用内更新 + **帮助 → 下载安装包**；Release 须带 `latest*.yml` 与二进制。 |
| **Git 克隆**   | `git pull` + `pnpm install`（见 §9）。                                    |

---

## 14. 常见问题

| 现象                                       | 处理方向                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| **401 / API Key 无效**                     | 核对 `.env.lawmind`；桌面用户核对 **用户目录** 与 **仓库根** 两处合并规则（§2.2）。 |
| **命令找不到 / 模块缺失**                  | 确认在 monorepo 根目录且已 `pnpm install`。                                         |
| **模型超时 / aborted**                     | 调大 `LAWMIND_AGENT_TIMEOUT_MS`、`LAWMIND_TOOL_TIMEOUT_MS`。                        |
| **工具超时**                               | 同上；长流水线单独调 `LAWMIND_TOOL_TIMEOUT_MS`。                                    |
| **smoke 报 real model returned no claims** | 查看 Diagnostic；检查检索侧模型与 JSON；可先去掉 `--fail-on-empty-claims` 跑通。    |
| **无法加载发布页 / 更新**                  | 检查网络与 GitHub Release；私有环境用手动安装包或内网镜像。                         |
| **闸门 / 审核 422**                        | 草稿未满足交付物规范或验收清单；按审核台提示补全后再导出。                          |

备份脚本参考：`scripts/lawmind/lawmind-backup.sh`（设置 `LAWMIND_WORKSPACE_DIR`）。

---

## 15. 相关文档索引

| 文档                                                   | 用途                           |
| ------------------------------------------------------ | ------------------------------ |
| [客户交付](/LAWMIND-DELIVERY)                          | 交付清单、验收、演示、升级回滚 |
| [Deliverable-First](/LAWMIND-DELIVERABLE-FIRST)        | 交付物规格、门禁、产品化状态   |
| [愿景与边界](/LAWMIND-VISION)                          | 产品方向                       |
| [项目与记忆](/LAWMIND-PROJECT-MEMORY)                  | MEMORY、档案、CASE             |
| [桌面端 UI](/LAWMIND-DESKTOP-UI)                       | 布局、组件、可访问性约定       |
| [桌面文件与上下文](/LAWMIND-DESKTOP-FILES-AND-CONTEXT) | 文件页、引用、上限             |
| [数据处理](/LAWMIND-DATA-PROCESSING)                   | 隐私与子处理者                 |
| [集成与边界](/LAWMIND-INTEGRATIONS)                    | 与 DMS/计费的关系              |
| [私有化部署](/LAWMIND-PRIVATE-DEPLOY)                  | 企业内网                       |
| [Support runbook](/LAWMIND-SUPPORT-RUNBOOK)            | 运维排障                       |
| [客户一页概览](/LAWMIND-CUSTOMER-OVERVIEW)             | 英文对外口径                   |

本文档应与 `apps/lawmind-desktop/INSTALL.md`、`RELEASE-CHECKLIST.md` 及本地 API 变更同步维护。

---

## 16. 离线阅读与打印（PDF）

商业交付时，客户常需要 **可存档、可内部分发** 的静态副本，可按任选其一：

| 方式                 | 做法                                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **浏览器打印为 PDF** | 用浏览器打开在线手册（如 `https://docs.lawmind.ai/LAWMIND-USER-MANUAL`），使用 **打印 → 另存为 PDF**。若排版偏淡，可在打印对话框中勾选 **背景图形**（各浏览器名称可能为「背景」「背景颜色与图像」）。                                                                                                          |
| **从源码生成**       | 克隆仓库后打开 `docs/LAWMIND-USER-MANUAL.md`；可用任意 Markdown 编辑器阅读；若已安装 [Pandoc](https://pandoc.org/)，可在仓库根执行：`pandoc docs/LAWMIND-USER-MANUAL.md -o LawMind-使用手册.pdf`（具体样式可通过 `--pdf-engine`、模板等按贵司规范调整）。                                                      |
| **VitePress 文档站** | 仓库内 `apps/lawmind-docs` 为基于 **VitePress** 的独立站点（与 Vue / Vite 生态一致的主流选型）。本地执行 `pnpm lawmind:docs:dev`，构建执行 `pnpm lawmind:docs:build`；内容由脚本从 `docs/LAWMIND-*.md` 同步，部署静态文件目录为 `apps/lawmind-docs/docs/.vitepress/dist`。详见 `apps/lawmind-docs/README.md`。 |
| **内网镜像**         | 将 `docs/LAWMIND-USER-MANUAL.md` 或与文档站同步的构建产物放到 **仅内网可访问** 的 HTTPS 站点，打印步骤与上表相同。                                                                                                                                                                                             |

在线版本随发版更新；**PDF 宜在每次大版本发版时重新导出**并在文件名或封面标注版本号与日期，避免旧稿与产品不一致。

https://docs.lawmind.ai/LAWMIND-USER-MANUAL
