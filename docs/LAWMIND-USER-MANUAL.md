# LawMind 使用手册（完整版 · 工程级扩充）

本文档面向**正式交付后的律师、运维与二次开发读者**，覆盖 **桌面应用（主路径）**、**本机 HTTP API**、**工作区落盘约定**与**引擎 / Agent 实现要点**。功能随版本迭代，请以随版本发布的说明为准。

**重要声明**：LawMind 输出为**辅助草稿与研判材料**，**不构成法律意见**。对外提交、签署或送达前，须由执业律师完成复核与定稿。数据处理边界见 [LawMind 数据处理说明](/LAWMIND-DATA-PROCESSING)。

**与工程文档的关系**：本手册在「律师可操作面」之外，增加了**实现级索引**（源码路径、路由、数据文件），便于企业内集成与排障。纯研发路线图见 [LawMind 工程开发记忆](/LAWMIND-PROJECT-MEMORY)（**不等于**工作区内的 `MEMORY.md`）。

---

## 目录

### A. 产品与上手

1. [产品定位与重要声明](#1-产品定位与重要声明)
2. [桌面版快速上手（推荐路径）](#2-桌面版快速上手推荐路径)
3. [推荐工作流：从接案到可交付件](#3-推荐工作流从接案到可交付件)
4. [设置、多助手、角色（Role）与版本](#4-设置多助手角色role与版本)
   - [4.1 协作委派完整流程（多助手派活）](#41-协作委派完整流程多助手派活)
   - [4.2 团队工作流与异步 Job](#42-团队工作流与异步-job)
5. [文件、材料与对话上下文](#5-文件材料与对话上下文)（正文内分 **5.1–5.4**：HTTP/Electron、并发写、`contextPins`、澄清门禁）
6. [联网检索、策略与工作区策略文件](#6-联网检索策略与工作区策略文件)

### B. 案件与审核

7. [案件工作台与各面板（含 Insights）](#7-案件工作台与各面板含-insights)
   - [7.1 案件团队会议室](#71-案件团队会议室)
8. [审核台、验收门禁、推理门禁与来源预览](#8-审核台验收门禁推理门禁与来源预览)
9. [合同修订积累与学习队列](#9-合同修订积累与学习队列)

### C. 工程与集成

10. [仓库与运行时拓扑](#10-仓库与运行时拓扑)
11. [本机 HTTP API 全量参考](#11-本机-http-api-全量参考)
    - [11.3 `fs` 与 `artifact` 接口细节](#113-fs-与-artifact-接口细节)
    - [11.4 Jobs：列表、详情、SSE、取消](#114-jobs列表详情sse取消)
    - [11.5 `POST /api/chat` 响应体与错误码](#115-post-apichat-响应体与错误码)
    - [11.6 审核、渲染、重开审核](#116-审核渲染重开审核)
    - [11.7 模板与上传登记](#117-模板与上传登记)
    - [11.8 `desk-settings` 与记忆采纳 API](#118-desk-settings-与记忆采纳-api)
    - [11.9 团队工作流模板 JSON](#119-团队工作流模板-json)
    - [11.10 Roles API](#1110-roles-api)
12. [Agent 工具与 Clarify–Execute](#12-agent-工具与-clarifyexecute)
13. [引擎管线与 Matter 写侧 JSON](#13-引擎管线与-matter-写侧-json)
14. [记忆采纳（Memory Adoption）](#14-记忆采纳memory-adoption)
15. [审计、合规导出与 Edition 功能开关](#15-审计合规导出与-edition-功能开关)
16. [Electron IPC 与本地文件桥](#16-electron-ipc-与本地文件桥)
17. [命令行、Git 与日常脚本](#17-命令行git-与日常脚本)
18. [配置 `.env.lawmind` 与环境变量索引](#18-配置-envlawmind-与环境变量索引)
19. [工作区目录说明（扩展）](#19-工作区目录说明扩展)
20. [更新 LawMind](#20-更新-lawmind)
21. [常见问题（扩展）](#21-常见问题扩展)
22. [相关文档索引](#22-相关文档索引)

### D. 附录（工程深度）

23. [GET /api/health 与运维自检字段](#23-get-apihealth-与运维自检字段)
24. [GET /api/audit/export 与合规导出](#24-get-apiauditexport-与合规导出)
25. [案件与 Matter 相关 HTTP 细节](#25-案件与-matter-相关-http-细节)
26. [Insights 计算与事件管道](#26-insights-计算与事件管道)
27. [Agent 工具名全表（OpenAI function name）](#27-agent-工具名全表openai-function-name)
28. [测试与质量门禁入口](#28-测试与质量门禁入口)
29. [根目录 package.json 脚本对照](#29-根目录-packagejson-脚本对照)
30. [源代码导航速查](#30-源代码导航速查)
31. [路径参数与 ID 安全规则](#31-路径参数与-id-安全规则)
32. [异步 Job 公开 JSON 形状](#32-异步-job-公开-json-形状)
33. [Electron `window.lawmindDesktop` 接口一览](#33-electron-windowlawminddesktop-接口一览)
34. [`POST /api/collaboration/workflow-run` 请求体](#34-post-apicollaborationworkflow-run-请求体)
35. [离线阅读与打印（PDF）](#35-离线阅读与打印pdf)
36. [验收与推理报告 JSON 语义](#36-验收与推理报告-json-语义)
37. [Edition `features` 全量对照](#37-edition-features-全量对照)
38. [Records API](#38-records-api)
39. [首跑向导 firstrun-wizard](#39-首跑向导-firstrun-wizard)

---

## 1. 产品定位与重要声明

**LawMind** 是面向律师的 **本机优先（local-first）工作台风**：在受控工作区内完成任务拆解、检索与草稿、**人工审核**与 **Word/PPT 等交付**，并保留可导出的审计线索。

| 维度         | 说明                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| **我们不是** | 泛用聊天框或 Word 替代品                                                           |
| **我们是**   | 「任务 + 材料 + 审核 + 交件」闭环；北极星是**任务级可验收交付**（见 `GOALS.md`）   |
| **数据驻留** | 材料默认在本机工作区；大模型由您配置的 API 提供                                    |
| **责任模型** | 高风险工具与渲染在 **Deliverable-First** 与 **Edition** 策略下可强制门禁或二次确认 |

一页英文客户概览：[LawMind customer overview](/LAWMIND-CUSTOMER-OVERVIEW)。

---

## 2. 桌面版快速上手（推荐路径）

### 2.1 获取与安装

| 方式           | 说明                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **智能下载页** | 浏览器打开 [桌面下载页](https://cdn.jsdelivr.net/gh/lawmind/lawmind@main/apps/lawmind-desktop/download/index.html)；企业 fork 可在 URL 加 `?repo=组织/仓库`。 |
| **安装说明**   | [`apps/lawmind-desktop/INSTALL.md`](https://github.com/lawmind/lawmind/blob/main/apps/lawmind-desktop/INSTALL.md)。                                           |
| **交付包**     | 自 [LawMind 客户交付](/LAWMIND-DELIVERY) 或供应商处获取 **Windows / macOS / Linux** 安装介质。                                                                |

**打包版无需单独安装 Node.js**：安装包内含运行本地 API 所需的 Node 运行时。

- **macOS** 未签名测试包：首次可 **右键 → 打开**；广泛分发需 **签名与公证**。
- **Windows** SmartScreen：建议使用 **Authenticode 签名** 的安装包。

### 2.2 首次启动

1. 完成 **API 配置向导**（模型 Key、可选 Base URL、模型名、工作区路径等）。配置写入本机用户目录下的 LawMind 数据区（含 `.env.lawmind` 与 `desktop-config.json`）。
2. **开发模式**（`pnpm lawmind:desktop`）：本地服务会合并 **仓库根目录** 与 **用户目录** 的环境配置，**后者覆盖前者**；若命令行正常而桌面报 **401 / API Key 无效**，请优先核对用户目录 `.env.lawmind`。
3. **首次引导（P5）**：无案件时可能弹出 `LawmindFirstRunDialog`（角色 → 模板 → 自动建案 + seed prompt）；可永久关闭。产品说明见 [Deliverable-First 与首跑](/LAWMIND-DELIVERABLE-FIRST)。

### 2.3 主界面：默认交办、在办总览与文书台

桌面端为 **左侧边栏 + 右侧主工作台**（详见 [桌面端 UI 约定](/LAWMIND-DESKTOP-UI)）。

| 表面           | 用途                                                                                              | 主要渲染入口（实现参考）                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **对话**       | **默认入口**：向 Agent 下达任务、引用材料、澄清和中途调整                                         | `lawmind-chat-shell.tsx`、`LawmindAssignmentCommitmentCard.tsx`                    |
| **在办**       | 并行总览：进行中 / 交出去的活 / 按流程办（含原协作能力）                                          | `AgentFleetView.tsx`、`LawmindAgentFleetPanel.tsx`、`LawmindCollaborationDesk.tsx` |
| **自动办件**   | 定时或邮件触发的办件（配置向）；在 **设置 → 自动办件** 管理；结果进「待我拍板」                   | `LawmindAutomationsPanel.tsx`（设置分区）                                          |
| **会议室**     | 多助手讨论（可绑案件或临时开会）；经顶栏 **会议室** 进入                                          | `MeetingView.tsx`、`MatterTeamMeetingPanel.tsx`                                    |
| **案件工作台** | 材料、任务、期限、草稿、CASE、进度与 Insights 的长期真相源                                        | `MatterWorkbench.tsx` 与 `matter/*` 子视图                                         |
| **文书台**     | 有稿可审时进入：正文修改、批注、来源核验、交付预览与导出；正式签批主路径在「在办」                | `ReviewWorkbench.tsx`、`LawmindAcceptanceGate.tsx`                                 |
| **待我拍板**   | 跳转「在办」并只看待决（`awaiting_*`）；缺信息时在办表格「提交补充并继续」；对话多为弱引导/短确认 | `AgentFleetView.tsx`、`LawmindAgentFleetPanel.tsx`、`LawmindClarificationForm.tsx` |
| **文件**       | 浏览、编辑工作区内文本，标记本回合重点材料                                                        | `FileWorkbench.tsx`；服务端 `GET/POST /api/fs/*` 与 Electron `lawmind:fs:*`        |

**顶栏一级**：**对话**、**在办**、**会议室**、**文书台**。自动办件在 **设置 → 自动办件**。对话区在有待审草稿时固定显示「打开此稿」条，可直达文书台对应任务。案件工作台首页有 **「本案下一步」** 轨（打开本案对话 / 待我拍板 / 进入文书台）。侧栏待办角标共用 action-summary，对话回合结束后会即时刷新。

正式签批主路径仍在「在办」；文书台侧重改稿、批注与交付预览。系统不会因为后台修订完成而强制打断当前页面。

**侧边栏**：设置齿轮、案件材料树（或案件列表）、有待决时底部 **待我拍板**。

### 2.4 交付、验收门禁与文书台

- **Deliverable-First**：每类交付物有 **规格（DeliverableSpec）** 与 **验收清单**；渲染前默认 **strict 验收门禁**（HTTP `422 acceptance_gate_blocked`）。架构见 [Deliverable-First](/LAWMIND-DELIVERABLE-FIRST)。
- **推理门禁（Reasoning Gate）**：部分高风险内置 spec 配置 `reasoningGate`；`reasoning-validator` 在 strict 渲染路径与 acceptance **并联**校验。桌面 `LawmindAcceptanceGate` 同列展示 reasoning 报告。
- **文书台学习勾选**：可将摘要写入 **助手** `PROFILE.md` 或 **律师** `LAWYER_PROFILE.md`；失败时接口区分 `profileAppendFailed` / `lawyerProfileAppendFailed` 等标志；审核通过且草稿带 `contractRevisionCapture` 时可能触发 **合同修订积累**（见 §9）。

### 2.4.1 Skills 主路径（分诊 · 必核 · 专案组 · 矩阵 · 技能）

| 能力                | 怎么用                                    | 说明                                                                  |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| **分诊**            | 对话「写材料」→ 填表交办 → 确认黄/红档    | 推荐工作流（含中国包 `cn-*`）；确认后写入分诊会话                     |
| **律师必核**        | 文书台右侧清单                            | 未勾完时在办「通过」或文书台高级签批返回 `422 checklist_incomplete`   |
| **严格援引**        | 设置 / Edition 的 `citationMode=grounded` | 无源或无理论锚点时严格导出可被拦截                                    |
| **审查专案组**      | 文书台 Sticky「用审查专案组」             | ≥4 角色 + Safety Score；报告可 Markdown 下载；可选「更快模式」        |
| **案件简报 / 理论** | 案件概览                                  | Ops 可追加阶段与 RAID；理论三块可锚定；文书台可将推理图「采纳到理论」 |
| **审查矩阵**        | 案件工作台 → 审查矩阵                     | CSV 导出含 citation；版本比对看危险变更摘要                           |
| **技能库**          | 设置 → 技能库                             | 本地 `SKILL.md` + 签名校验；中国法务包状态；篡改签名拒载              |

更多工程闸门见 [500 人周计划](/LAWMIND-AGENT-SKILLS-500PW-PLAN) §9.1；Edition 矩阵见 [Edition 功能矩阵](/LAWMIND-EDITION-FEATURE-MATRIX)。

### 2.5 更新与支持

- **应用内更新**：菜单 **帮助 → 检查更新**；依赖 **GitHub Release** 与 `electron-builder` 的 `latest*.yml`（`apps/lawmind-desktop/RELEASE-CHECKLIST.md`）。**`LAWMIND_SKIP_AUTO_UPDATE=1`** 可关闭自动检查。
- **排障**：律师向见 [§21](#21-常见问题扩展)；运维见 [Support runbook](/LAWMIND-SUPPORT-RUNBOOK)。

---

## 3. 推荐工作流：从接案到可交付件

1. **建案件**：创建符合规则的 `matterId`（见 §11 与 `isValidMatterId`）；材料放入 `workspace/cases/<matterId>/` 或关联项目目录。
2. **对话下指令**：说明交付物类型、事实与立场；文件页把关键材料标为**本回合重点**（`contextPins` / 消息前缀，见 `lawmind-server-route-chat.ts`）。
3. **跟任务与草稿**：案件或侧栏查看任务；引擎工具链产出 `workspace/tasks/*.json` 与 `workspace/drafts/*.json`。
4. **审核通过再渲染**：`POST /api/drafts/:taskId/review` 批准后，再 `POST /api/drafts/:taskId/render`（默认 strict）；关注 **引用完整性** 与 **验收清单**。
5. **沉淀（可选）**：审核勾选写入档案；学习队列 `GET /api/learning/suggestions` 可后续采纳/忽略。
6. **（进阶）Matter 写侧**：审批、待办队列、节点记录落在 `workspace/matters/<id>/` JSON/JSONL，与 CASE.md 双轨；Agent 工具 `request_approval`、`open_work_queue_item`、`record_deadline` 等（见 §13）。

### 3.1 日流程自检（IT / 培训用）

上线或版本升级后，可用下列 **5 分钟** 清单确认主链可用（无需逐条读 API 文档）：

| 步骤 | 操作                                                                       | 预期                                                       |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | 工作台对话产出带 `taskId` 的助手回复                                       | 消息下方显示「当前交办」和 gate 摘要或「进入文书台」       |
| 2    | 侧栏 **待我拍板** 进入「在办」处理 `requiresAction`（或会话内澄清/批准卡） | 批准/拒绝后任务继续                                        |
| 3    | 点 **进入文书台** → 选草稿 → 签批 → 渲染                                   | strict 模式下未过 gate 时渲染返回 422                      |
| 4    | 案件工作台 → **认知** → 记忆采纳「预览变更」                               | diff 预览可用；采纳写入 CASE/PROFILE                       |
| 5    | 审核台 Redline：**将当前稿设为基准** → 改正文 → **生成修订提案** → 接受    | 段落写回草稿正文                                           |
| 6    | 案件 **案件** Tab 搜索关键词                                               | 无索引时提示到 **设置→系统体检** 重建；重建后命中出现      |
| 7    | 左栏 `cases/` 或 **案件** 快捷列表选案                                     | cockpit 打开；有待决时底栏 **待我拍板** 跳转「在办」决策区 |

索引未建立时，本机开发可在 loopback 环境设置 `LAWMIND_ALLOW_INDEX_REBUILD=1` 后于体检页重建（见 [工作区标准](/LAWMIND-WORKSPACE-STANDARD)）。

---

## 4. 设置、多助手、角色（Role）与版本

打开 **设置**（齿轮图标）：

| 设置区              | 用户能力                                           | 实现要点                                                                                     |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **就绪 / 首次引导** | API 与路径自检                                     | 健康检查 `GET /api/health`                                                                   |
| **团队工作流**      | 摘要 +「在在办中打开按流程办」                     | `LawmindSettingsCollaborationBrief`；完整运行 UI 在 **在办 · 按流程办**                      |
| **助手与岗位**      | CRUD、`assistantId`、岗位预设、关系统计            | `GET/POST /api/assistants`、`PATCH/DELETE /api/assistants/:id`、`GET /api/assistant-presets` |
| **角色（Role）**    | 岗位级工具白名单、交付物类型、风险上限、记忆 scope | `GET /api/roles`、`GET /api/roles/:id`；定义 `src/lawmind/core/role.ts`                      |
| **模型与检索**      | single/dual、`dualLegalConfigured` 等              | `GET /api/health`；适配器见 `src/lawmind/retrieval/`                                         |
| **工作区与项目**    | `workspaceDir`、`projectDir` 传入对话请求          | `lawmind-server-route-chat.ts` 中 `projectDir`                                               |
| **模板 / Edition**  | 内置 + 上传模板；Solo/Firm/Private 功能开关        | `GET /api/templates`、`GET /api/policy/edition`                                              |
| **应用更新**        | 版本与更新通道                                     | Electron `lawmind:check-updates`                                                             |

**超时**：模型默认约 **120s**（`LAWMIND_AGENT_TIMEOUT_MS`）；工具超时 `LAWMIND_TOOL_TIMEOUT_MS`（见 §18）。

### 4.1 协作委派完整流程（多助手派活）

**定义**：当前助手 **A** 在对话中通过内置工具（如 **`delegate_task`**）把子任务交给助手 **B** **异步**执行；记录在 `workspace/delegations/` 与审计 `collaboration-audit.jsonl`。与 **团队工作流**（`lawmind/workflows/*.json`）是两条线。

**环境**：`LAWMIND_ENABLE_COLLABORATION=false` 时服务端关闭协作注册；`lawmind.policy.json` 中 `enableCollaboration: false` 亦会约束行为（与 summary 中的 hint 一致）。

**推荐顺序**（与原版一致，补充实现索引）：

1. 在 **设置 → 助手与岗位** 至少配置两名助手（`assistants.json` + `assistants/<id>/PROFILE.md`）。
2. 顶栏选中 **主办助手 A**（`assistantId` 进入 `POST /api/chat`）。
3. **关联案件**、任务/草稿，并添加 **本回合重点**，便于模型派活。
4. 自然语言下达；也可在对话或「在办」工作台使用 **委派给助手**；模型可调用 `delegate_task` / 协调类工具。
5. 在 **顶栏「在办」→「交出去的活」** 查看委派进度（`GET /api/delegations` / `GET /api/collaboration-events`）；**刷新**走壳层 `refreshCollaboration()`（见 [协作 UI ↔ API 对照](/LAWMIND-COLLABORATION-UI-API-MAP)）。

**状态**：等待中 / 进行中 / 已完成 / 失败 / 超时——与委派注册表字段一致。

**护栏（默认）**：不可委派给自己；并发委派上限与链路深度见 orchestrator 配置（工程记忆与 `delegate.ts`）；定向白名单为可选企业特性。

**API 补充**：`GET /api/delegations/:id` 详情、`DELETE /api/delegations/:id` 取消委派——桌面「交出去的活」已支持撤销；详情以列表与打开目标对话为主。

### 4.2 团队工作流与异步 Job

| 能力                   | HTTP                                        | 持久化 / 行为                                                                              |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 列出模板               | `GET /api/collaboration/workflow-templates` | 读取 `workspace/lawmind/workflows/*.json`                                                  |
| 运行模板               | `POST /api/collaboration/workflow-run`      | body：`templateId`、`matterId?`、`assistantId?`、`vars?`、`async: true`、`idempotencyKey?` |
| 同步运行（API 仍支持） | 同上 `async` 非 true                        | **200** + `report`；桌面 UI **始终 async**                                                 |
| 协作被环境关闭         | 同上                                        | **503** `collaboration_disabled`                                                           |
| Job 查询               | `GET /api/jobs`、`GET /api/jobs/:id`        | `workspace/lawmind/jobs/<jobId>.json`                                                      |
| SSE                    | `GET /api/jobs/:id/stream`                  | `text/event-stream`；首包快照；**25s** 注释心跳 `: ping`                                   |
| 取消                   | `POST /api/jobs/:id/cancel`                 | `queued` 立即终态；`running` 在步骤批次间协作式中止                                        |

实现：`lawmind-server-route-collaboration.ts`、`lawmind-server-route-jobs.ts`、`lawmind-server-jobs.ts`、`src/lawmind/agent/orchestrator/`。

---

## 5. 文件、材料与对话上下文

### 5.1 两条访问路径：HTTP 与 Electron

| 路径             | 适用场景                                 | 说明                                                                        |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| **本地 HTTP**    | 渲染进程内 `fetch`、自动化脚本、同源调试 | `GET /api/fs/tree                                                           | read`、`POST /api/fs/write`；根键 `root=workspace | project`（§11.3） |
| **Electron IPC** | 需更高权限或与主进程一致的路径解析时     | `preload.cjs` 暴露 `window.lawmindDesktop.fsList/fsRead/fsWrite/...`（§33） |

二者均受 **`resolveFsPath` / `safeArtifactPath`** 约束：相对路径不得含 `..`，解析后须落在 workspace 或（若配置了）`LAWMIND_PROJECT_DIR` 对应 project 根之下；符号链接若穿出根会拒绝。

### 5.2 编辑与并发

- **`GET /api/fs/read`** 返回 `mtimeMs`；前端保存时应把该值作为 **`POST /api/fs/write` 的 `expectedMtimeMs`**，否则多人或外程序改文件时会收到 **409** `conflict: true`。
- 读接口仅支持**文本**（二进制检测失败返回 **415**）；大文件上限约 **1MB**（见 §11.3）。

### 5.3 本回合重点与 `POST /api/chat`

- **`contextPins`**：结构化列表，与顶栏「本回合重点」一致，由 `lawmind-server-route-chat.ts` 与客户端组装逻辑消费。
- **关联案件 / 任务**：`matterId`、`linkedTaskId` 影响记忆加载与工具默认 `matter_id`。
- **会议室**：同接口 `meetingMode` + `matterId`；`meetingAgenda` 仅注入模型上下文，**不**单独写入 JSONL 用户行（见 §11.5）。

### 5.4 澄清（Clarify–Execute）

工具返回 **`clarificationQuestions`** 后，下一轮应优先在界面填写澄清项再触发重流程；服务端在同轮内会阻止并行重型工具（见 §12）。

上限与交互细节：[桌面文件与上下文](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)。

---

## 6. 联网检索、策略与工作区策略文件

| 层级           | 行为                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **UI**         | 主界面勾选「允许联网检索」→ 请求体 `allowWebSearch`                                                                           |
| **环境**       | `LAWMIND_WEB_SEARCH_API_KEY` 或 `BRAVE_API_KEY`（见 `lawmind-web-search.ts`）                                                 |
| **工作区策略** | `workspace/lawmind.policy.json`（或桌面解析路径）中 `allowWebSearch: false` 时 **强制关闭**（`isWebSearchForcedOffByPolicy`） |
| **健康检查**   | `GET /api/health` 的 `policy` 字段可确认是否加载                                                                              |

**`lawmind.policy.json` 常用键**（完整类型见 `src/lawmind/policy/workspace-policy.ts`）：

| 键                                                | 作用                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `schemaVersion`                                   | 必填                                                            |
| `allowWebSearch`                                  | 是否允许联网                                                    |
| `retrievalMode`                                   | 提示检索模式（与 env 协同）                                     |
| `enableCollaboration`                             | 是否允许协作工具链                                              |
| `edition`                                         | `solo` / `firm` / `private_deploy`                              |
| `agentMandatoryRules` / `agentMandatoryRulesPath` | 注入 Agent system prompt 的强制规则（上限 8192 字符）           |
| `agentMaxToolCallsPerTurn`                        | 单轮工具调用上限（与 `LAWMIND_AGENT_MAX_TOOL_CALLS` 协同）      |
| `productInsightsCollection`                       | `off` / `local-only` / `synced` — 控制 `ux.matter_action` 采集  |
| `highSecurityMode`                                | 为 `true` 时倾向关闭联网与产品遥测（设置 → 工具治理可一键写入） |
| `context.*`                                       | 自动 compact 缓冲、`maxConsecutiveCompactFailures` 等           |

选型说明：[LawMind 联网检索路径](/LAWMIND-NETWORK-OPTIONS)。

---

## 7. 案件工作台与各面板（含 Insights）

**定位**：本案驾驶舱——左栏材料/任务/草稿/CASE/审计相关入口；右栏 **Insights**（从 `ux.matter_action` / `ui.matter_action` 聚合，受 `productInsightsCollection` 影响）。

**右栏区块（阅读顺序）**：

1. **最近律师动作**：进入审核、写回 CASE、沉淀记忆等（审计驱动）。
2. **律师行为摘要**：各工作面集中度。
3. **交互收敛建议**：本案下一步入口级建议。
4. **产品改造建议** / **产品实验清单** / **跨案件实验累积** / **Roadmap 候选**：给产品与技术沟通用信号。

**易误解**：非绩效监控；**不自动**批准对外文书。

**案件 ID 规则**：以字母或数字开头，总长 **2–128**，仅 `[a-zA-Z0-9._-]`。与 `POST /api/matters/create`、`POST /api/chat` 校验一致。

**Matter 相关 HTTP**：除 §11 表格外，案件工作台会调用 **`POST /api/matters/interaction`**（记录 UX 事件）、**`POST /api/matters/case-note`**（写 CASE 片段）、**`GET /api/matters/overviews`**、**`GET /api/matters/interaction-rollup`**、**`GET/POST /api/matters/role`**（子目录角色标记 `.lawmind-role.txt`）等——见 `lawmind-server-route-matters.ts`。

**子视图（`matter/` 目录）**：如 `MatterCockpit.tsx`、`MatterMemoryInspector.tsx`、`MatterQualityCockpit.tsx`、`MatterReasoningBoard.tsx`、`MatterReviewQueuePanel.tsx`、`MatterRoleBoard.tsx` 等，用于拆分原巨型工作台能力。

### 7.1 团队会议室

- **入口**：顶栏 **会议室**（`mainView = "meeting"` → `MeetingView`）。可绑定案件，或选「不绑定案件 · 临时讨论」（API 仍用哨兵 id `临时讨论`，磁盘落在 `meetings/adhoc/team-meeting.jsonl`，不占用案件列表）。
- **案件侧深链**：案件概览「打开会议室」跳到会议室视图并带上本案。
- **UI**：`MatterTeamMeetingPanel.tsx`；**数据**：`GET /api/matters/team-meeting?matterId=&limit=&skipFromEnd=` → `readTeamMeetingWindow`（`src/lawmind/cases/team-meeting.ts`）。
- **发言**：`POST /api/chat`，`meetingMode: true` 且 **必须**合法 `matterId`；否则 **400** `meeting_matter_required`。
- **`meetingAgenda`**：注入系统侧上下文，**不**写入 JSONL 用户行。
- **磁盘**：`workspace/cases/<matterId>/team-meeting.jsonl`（`user` / `assistant` / `system`）。
- **委派系统条**：`delegate_task` 带 `matter_id` 时在 JSONL 追加 **system** 行。
- **材料**：可先在「对话」附上文件再进会议室；页内会提示当前已附带材料（议程仍由律师/助手在会中使用）。

---

## 8. 审核台、验收门禁、推理门禁与来源预览

| 步骤         | 用户操作       | API / 引擎                                                                                                                                                   |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 打开草稿     | 审核列表       | `GET /api/drafts`、`GET /api/drafts/:taskId`                                                                                                                 |
| 自检摘要     | 首屏聚合       | `LawmindReviewSelfCheckSummary`；数据来自 draft + acceptance + citation                                                                                      |
| 验收详情     | 门禁组件       | `GET /api/drafts/:taskId/acceptance`；或详情接口内嵌 `acceptance`                                                                                            |
| 推理报告     | 与验收并列     | `readReasoningSnapshot` + `serializeLegalReasoningGraph`；`validateReasoningForDraft`                                                                        |
| 来源悬停     | Citation pill  | `GET /api/sources/:id/preview?taskId=`（`lawmind-server-route-sources.ts`）                                                                                  |
| 审核决定     | 批准/退回/修改 | `POST /api/drafts/:taskId/review`；body 含 `status`、`note`、`appendToProfile`、`appendToLawyerProfile`、`profileAssistantId`、`labels`、`deferMemoryWrites` |
| 重新打开审核 | 修正后再审     | `POST /api/drafts/:taskId/reopen-review`                                                                                                                     |
| 渲染         | 导出 Word/PPT  | `POST /api/drafts/:taskId/render?strict=`（默认 strict；`false` 为显式弱化门禁，**不推荐**）                                                                 |
| 带修订 Word  | 审核台按钮     | `POST /api/drafts/:taskId/render-tracked`：将 Redline 提案写入 Word 修订痕迹；需本机 **officecli**，未安装时回退为普通 docx 并提示                           |
| 验收包       | 对外证明       | `GET /api/drafts/:taskId/acceptance-pack`（Markdown 或 `?format=json`）；受 Edition `acceptancePackExport` 控制（Solo 可能 **403**）                         |

**Word 修订导出限制**：`render-tracked` 依赖主机已安装 `officecli` 且草稿具备 Redline 基准/提案；无 CLI 时仍会得到 docx 文件但不含原生修订痕迹。清洁版请用「导出 Word」（`/render` strict 路径）。

**内置交付物类型（DeliverableSpec.type）**（工作区可追加自定义 spec，见 `workspace/lawmind/deliverables/*.json`）：

| `type`               | 说明            |
| -------------------- | --------------- |
| `contract.rental`    | 房屋租赁合同    |
| `contract.general`   | 通用商务合同    |
| `letter.demand`      | 律师函 / 催告   |
| `contract.review`    | 合同审查意见    |
| `litigation.outline` | 诉讼方案 / 纲要 |
| `document.general`   | 通用文书        |

注册表：`src/lawmind/deliverables/registry.ts`；校验：`validateDraftAgainstSpec`、`validateReasoningForDraft`。

**字段级说明**：`AcceptanceReport` / `ReasoningReport` 各键、acceptance-pack 的 `format` 与 **403** 条件，见附录 [§36](#36-验收与推理报告-json-语义)。Edition 下各 **`features`** 布尔含义见 [§37](#37-edition-features-全量对照)。

### 8.1 与 Harvey 式引用对照（简表）

LawMind 不复制 Harvey 等企业云台的部署形态，但在**可核对来源**上对齐律师预期：

| 能力           | Harvey 类企业台  | LawMind                                                           |
| -------------- | ---------------- | ----------------------------------------------------------------- |
| 段落级来源锚点 | 强（企业语料库） | 强：`source preview` + 审查矩阵 + acceptance pack                 |
| 点击回原文     | 依赖 DMS / 语料  | 本机 `cases/` + 检索索引；SharePoint 外链（若已配置）             |
| 对外交付证明   | 企业审计栈       | 本地 JSONL + hash-chain + 验收包导出                              |
| Word 修订痕迹  | 常经 DMS / 插件  | 审核台 `render-tracked`（`officecli`；无 CLI 时 plain docx 回退） |

**律师可读结论**：Harvey 优势在律所级语料与 DMS 一体部署；LawMind 优势在**本机闭环**——同一 matter 内从研判 → 审核门禁 → 带来源的可交付件，无需把案件材料默认上传第三方 SaaS。详见 [集成路线图](/LAWMIND-INTEGRATIONS#与-harvey--spellbook-对照phase-12)。

---

## 9. 合同修订积累与学习队列

**修订积累包**：审核通过且满足捕获条件时，`applyContractRevisionAccumulationAfterApprovedReview` 写入 `workspace/learning/contract-revisions/`。详见 [LAWMIND-CONTRACT-REVISION-ACCUMULATION](./LAWMIND-CONTRACT-REVISION-ACCUMULATION.md)。

**桌面偏好**：`workspace/lawmind/desk-settings.json`（如 `contractBatchRelativeDir`）；**`GET/POST /api/workspace/desk-settings`**。

**合同审查学习草稿**：`GET/POST /api/learning/contract-review/drafts`、`POST /api/learning/contract-review/drafts/accept`（`lawmind-server-route-contract-review.ts`）。

**修订定稿接口**：`POST /api/learning/contract-revision/finalize`、`GET /api/learning/contract-revisions`（`lawmind-server-route-learning-contract.ts`）。

**学习建议队列**：`GET /api/learning/suggestions`、`POST /api/learning/suggestions/:id/adopt`、`POST /api/learning/suggestions/:id/dismiss`。

---

## 10. 仓库与运行时拓扑

| 路径                    | 职责                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lawmind/`          | **引擎与域逻辑**：memory、retrieval、drafts、deliverables、agent、orchestrator、application services、matter-storage 适配器、insights、audit 等 |
| `apps/lawmind-desktop/` | **Electron + Vite 渲染进程**；`server/` 下为嵌入的 **127.0.0.1** HTTP 服务                                                                      |
| `apps/lawmind-docs/`    | VitePress 文档站；`pnpm lawmind:docs:dev`                                                                                                       |
| `scripts/lawmind/`      | CLI：`lawmind-case`、`lawmind-review`、`lawmind-acceptance`、`lawmind-quarterly-demo` 等                                                        |

**HTTP 调度入口**：`apps/lawmind-desktop/server/lawmind-server-dispatch.ts` 按顺序尝试各 `handle*Route`（健康 → 模板 → 验收 → 来源 → 审核 → 聊天 → …）。

**架构五层 + 横向能力**（摘要）：Instruction Router、Memory、Retrieval、Reasoning、Artifact；叠加 Matter 写侧、Role + ToolPolicy、Memory Adoption、Insights（见 [LAWMIND-ARCHITECTURE.md](./LAWMIND-ARCHITECTURE.md)）。

---

## 11. 本机 HTTP API 全量参考

**约定**：默认仅 **`127.0.0.1`** 监听；JSON 请求/响应为主；CORS 头由 `lawmind-server-helpers.ts` 处理。**`taskId`/`jobId`/`assistantId`** 等须匹配服务端 **safe segment** 校验，防止路径穿越。

### 11.1 路由速查表

| 方法      | 路径                                          | 说明                                                                     |
| --------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| GET       | `/api/health`                                 | 工作区、模型、策略、doctor 计数、edition 等                              |
| GET       | `/api/metrics/team-growth`                    | 团队成长内测指标快照；`?windowDays=`（默认 30）                          |
| POST      | `/api/metrics/team-growth/baseline`           | 冻结当前窗口为基线（body：`windowDays?`、`note?`）                       |
| GET       | `/api/templates`                              | 内置 + 已上传模板列表                                                    |
| GET       | `/api/templates/built-in`                     | 内置模板（含 `category`）                                                |
| POST      | `/api/templates/scan`                         | 扫描工作区内 `.docx` 占位符                                              |
| POST      | `/api/templates/register`                     | 登记上传模板；`id` 须匹配 `upload/<segment>`；`format`：`docx` \| `pptx` |
| POST      | `/api/templates/enabled`                      | body：`id`、`enabled` 布尔，启停已登记模板                               |
| GET       | `/api/templates/uploaded`                     | 仅列出上传模板                                                           |
| DELETE    | `/api/templates/uploaded?id=`                 | 删除上传模板（query `id`）                                               |
| GET       | `/api/deliverables/specs`                     | 所有 DeliverableSpec 摘要（含 workspace 扩展标记）                       |
| GET       | `/api/acceptance-summary`                     | 按 matter 或全工作区汇总草稿验收状态                                     |
| GET       | `/api/policy/edition`                         | Edition 与功能开关                                                       |
| GET       | `/api/drafts/:taskId/acceptance`              | 单草稿验收报告                                                           |
| GET       | `/api/drafts/:taskId/acceptance-pack`         | 验收包 Markdown 或 JSON                                                  |
| GET       | `/api/sources/:id/preview`                    | 来源预览（可选 `taskId`）                                                |
| GET       | `/api/learning/suggestions`                   | 学习建议；`?filter=all`                                                  |
| POST      | `/api/learning/suggestions/:id/adopt`         | 采纳建议                                                                 |
| POST      | `/api/learning/suggestions/:id/dismiss`       | 忽略建议                                                                 |
| POST      | `/api/lawyer-profile/learning`                | 追加 `LAWYER_PROFILE.md`                                                 |
| POST      | `/api/assistants/profile/learning`            | 追加助手 `PROFILE.md`                                                    |
| GET       | `/api/tasks/:taskId`                          | 任务详情 + checkpoints + executionPlan                                   |
| GET       | `/api/drafts/:taskId`                         | 草稿详情 + citation + reasoningMarkdown + memorySources + acceptance     |
| POST      | `/api/drafts/:taskId/review`                  | 审核                                                                     |
| POST      | `/api/drafts/:taskId/render`                  | 渲染交付物                                                               |
| POST      | `/api/drafts/:taskId/reopen-review`           | 重开审核                                                                 |
| POST      | `/api/chat`                                   | Agent 单轮对话（含 meetingMode 等）                                      |
| GET       | `/api/assistant-presets`                      | 岗位预设列表                                                             |
| GET       | `/api/assistants`                             | 助手列表 + 统计                                                          |
| POST      | `/api/assistants`                             | 创建助手                                                                 |
| PATCH     | `/api/assistants/:id`                         | 更新助手                                                                 |
| DELETE    | `/api/assistants/:id`                         | 删除助手（不可删 `default`）                                             |
| GET       | `/api/assistants/:id/profile-sections`        | PROFILE.md 分段解析展示                                                  |
| GET       | `/api/matters`                                | 列表 matterId                                                            |
| GET       | `/api/matters/search`                         | 搜索案件索引                                                             |
| GET       | `/api/matters/detail`                         | 详情 + 任务 + 草稿 + `draftCitationIntegrity`                            |
| GET       | `/api/matters/team-meeting`                   | 会议室窗口                                                               |
| POST      | `/api/matters/create`                         | 建案（幂等）                                                             |
| POST      | `/api/matters/display-name`                   | 展示名称；可创建 CASE.md                                                 |
| POST      | `/api/matters/delete`                         | 删除 `cases/<matterId>`                                                  |
| POST      | `/api/matters/case-note`                      | 写回 CASE 结构块                                                         |
| POST      | `/api/matters/interaction`                    | 记录工作台交互（审计/Insights）                                          |
| GET       | `/api/matters/overviews`                      | 多案件摘要列表                                                           |
| GET       | `/api/matters/interaction-rollup`             | 交互汇总                                                                 |
| GET/POST  | `/api/matters/role`                           | 子目录角色读/写                                                          |
| GET       | `/api/approvals`                              | 审批请求列表（Matter JSON 真相源优先）                                   |
| GET       | `/api/queues`                                 | 待办队列列表                                                             |
| POST      | `/api/onboarding/firstrun-wizard`             | 首次引导完成记录                                                         |
| GET/POST  | `/api/workspace/desk-settings`                | 桌面偏好 JSON                                                            |
| GET/POST  | `/api/learning/contract-review/drafts`        | 合同审查草稿                                                             |
| POST      | `/api/learning/contract-review/drafts/accept` | 验收通过写入积累                                                         |
| GET       | `/api/learning/contract-revisions`            | 列出修订包                                                               |
| POST      | `/api/learning/contract-revision/finalize`    | 定稿修订包                                                               |
| GET       | `/api/tasks`                                  | 任务列表（records 路由）                                                 |
| GET       | `/api/sessions`                               | 会话列表（含 `lastPreview`）                                             |
| GET       | `/api/sessions/:id/context-budget`            | 当前会话 token 用量与 compact 级别                                       |
| POST      | `/api/sessions/:id/compact`                   | 手动压缩对话历史（可选 `distill` 沉淀学习）                              |
| POST      | `/api/sessions/:id/messages/mutate`           | 按气泡下标截断/删除问答对                                                |
| POST      | `/api/sessions/:id/abort`                     | 协作式停止进行中的对话轮                                                 |
| POST      | `/api/sessions/:id/resume`                    | 从 JSONL transcript 修复并加载会话                                       |
| GET/PATCH | `/api/policy/workspace`                       | 读取/更新工作区策略（含 **高安全模式**）                                 |
| GET       | `/api/drafts`                                 | 草稿列表                                                                 |
| GET       | `/api/history`                                | 历史                                                                     |
| GET       | `/api/jobs`                                   | 异步 Job 列表；支持 `limit`、`since`、重复 `status`                      |
| GET       | `/api/jobs/:id`                               | Job 详情                                                                 |
| GET       | `/api/jobs/:id/stream`                        | SSE                                                                      |
| POST      | `/api/jobs/:id/cancel`                        | 取消 Job                                                                 |
| GET       | `/api/collaboration/summary`                  | 协作摘要                                                                 |
| GET       | `/api/delegations`                            | 委派列表；可选 `status`、`assistantId`、`matterId`                       |
| GET       | `/api/delegations/:id`                        | 委派详情                                                                 |
| DELETE    | `/api/delegations/:id`                        | 取消委派                                                                 |
| GET       | `/api/collaboration/workflow-templates`       | 工作流模板                                                               |
| POST      | `/api/collaboration/workflow-run`             | 运行工作流                                                               |
| GET       | `/api/collaboration-events`                   | 协作事件时间线；`?since=`                                                |
| GET       | `/api/audit/export`                           | Markdown 审计导出；支持合规模式与过滤                                    |
| GET       | `/api/memory/sources`                         | 记忆来源报告                                                             |
| GET       | `/api/memory/adoptions`                       | （与 adoption 路由并存时见实现）                                         |
| GET       | `/api/memory/adoption`                        | 列出记忆采纳建议；`scope`、`state`、`matterId`/`targetId`                |
| POST      | `/api/memory/adoption/suggest`                | 新建建议                                                                 |
| POST      | `/api/memory/adoption/adopt`                  | 采纳                                                                     |
| POST      | `/api/memory/adoption/dismiss`                | 拒绝/忽略                                                                |
| GET       | `/api/roles`                                  | Role 列表                                                                |
| GET       | `/api/roles/:roleId`                          | Role 详情                                                                |
| GET       | `/api/artifact`                               | 下载/定位渲染产物（参数见路由实现）                                      |
| GET       | `/api/fs/tree`                                | 工作区文件树                                                             |
| GET       | `/api/fs/read`                                | 读文件                                                                   |
| POST      | `/api/fs/write`                               | 写文件                                                                   |

### 11.2 `POST /api/chat` 请求体（核心字段）

| 字段                     | 类型    | 说明                                           |
| ------------------------ | ------- | ---------------------------------------------- |
| `message`                | string  | **必填**，用户消息                             |
| `sessionId`              | string  | 会话延续                                       |
| `matterId`               | string  | 关联案件；非法 ID → **400**                    |
| `assistantId`            | string  | 助手；默认 `default`                           |
| `allowWebSearch`         | boolean | 联网开关（受策略覆盖）                         |
| `enableCollaboration`    | boolean | 是否注册协作工具（与策略/env 交集）            |
| `projectDir`             | string  | 项目根路径（经 `safeOptionalProjectDir` 校验） |
| `includeTurnDiagnostics` | boolean | Firm/Private 或显式开启时附带诊断              |
| `contextPins`            | unknown | 本回合重点材料结构化列表                       |
| `linkedTaskId`           | string  | 关联任务/草稿                                  |
| `meetingMode`            | boolean | 会议室模式                                     |
| `meetingAgenda`          | string  | 会议室注入（不写用户 JSONL 行）                |

### 11.3 fs 与 artifact 接口细节

实现：`apps/lawmind-desktop/server/lawmind-server-route-fs.ts`。根解析：`resolveFsRoots(workspaceDir)` → 恒有 `workspace`；若进程环境 **`LAWMIND_PROJECT_DIR`** 非空且为已存在目录，则额外暴露 **`project`** 根（绝对路径）。

#### `GET /api/fs/tree`

| 查询参数 | 默认        | 说明                                                                  |
| -------- | ----------- | --------------------------------------------------------------------- |
| `root`   | `workspace` | 仅允许 `workspace` 或 `project`（无 project 根时传 `project` 会报错） |
| `path`   | `""`        | 相对根的路径片段，经 `normalizeRelPath`；含 `..` 或越出根 → 抛错      |

**响应**：`{ ok: true, entries: [{ name, path, kind: "directory"|"file", size?, mtimeMs }] }`；目录优先排序。

#### `GET /api/fs/read`

| 查询参数 | 说明             |
| -------- | ---------------- |
| `root`   | 同 tree          |
| `path`   | 目标文件相对路径 |

**限制**：单文件最大 **`MAX_TEXT_READ_BYTES` = 1_000_000** 字节；超出 → **413** `file too large`。内容经 `isLikelyBinary` 检测（前 4KB 含 `\0`）→ **415** `binary file is not supported`。

**响应**：`{ ok: true, content, size, mtimeMs }`。

#### `POST /api/fs/write`

**Body（JSON）**：

| 字段              | 说明                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `root`            | 默认 `workspace`                                                                         |
| `path`            | 相对路径                                                                                 |
| `content`         | UTF-8 全文替换写入                                                                       |
| `expectedMtimeMs` | 可选；若与磁盘 `mtimeMs` 差大于 1ms → **409** `file was modified externally`（乐观并发） |

**响应**：`{ ok: true, mtimeMs, size, previousMtimeMs? }`。父目录不存在时会 `mkdir` 递归创建。

#### `GET /api/artifact`

| 查询参数 | 说明                                                                  |
| -------- | --------------------------------------------------------------------- |
| `path`   | 经 `safeArtifactPath(workspaceDir, rel)` 约束在工作区内的产物相对路径 |

**响应**：**200** `application/octet-stream` 原始字节（非 JSON）；不存在 → **404**。

---

### 11.4 Jobs：列表、详情、SSE、取消

实现：`lawmind-server-route-jobs.ts`、`lawmind-server-jobs.ts`。**内存注册表**最多保留约 **200** 条 Job（进程重启后不恢复执行中的工作流；磁盘 `workspace/lawmind/jobs/*.json` 行为见架构文档）。

#### `GET /api/jobs`

| 查询参数 | 说明                                              |
| -------- | ------------------------------------------------- |
| `limit`  | 默认字符串 `"20"` → `parseInt`；非有限数则回退 20 |
| `status` | 可 **重复多次** 传参；解析为单状态或数组过滤      |
| `since`  | 创建时间下界（传入 `listWorkflowJobs`）           |

**响应**：`{ ok: true, jobs: PublicWorkflowJob[] }`。

#### `GET /api/jobs/:id` 与 `GET /api/jobs/:id/stream`

- **`:id`** 必须满足 `isSafeWorkflowJobId`：长度 **1–128**，仅 `[a-zA-Z0-9._-]`，无 `/`、`..`。
- **404 `job_not_found`**：不存在，或磁盘记录中的 `workspaceDir` 与**当前请求 ctx 工作区**解析结果不一致（防串租户）。
- **SSE**：`Content-Type: text/event-stream`；首行即 `data: {"ok":true,"job":...}`；终态后关闭；运行中每 **25s** 写 `: ping\n\n`。

#### `POST /api/jobs/:id/cancel`

- **200**：接受取消请求。
- **404**：job 不存在。
- **409**：`job_already_terminal` 已终态。

#### 幂等提交

`POST /api/collaboration/workflow-run` 的 **`idempotencyKey`**（长度上限 **128**）在同一进程内可合并重复提交（见 `lawmind-server-jobs.ts`）。

---

### 11.5 POST /api/chat 响应体与错误码

实现：`lawmind-server-route-chat.ts`。成功 **200** 时 JSON 主体字段：

| 字段                             | 说明                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reply`                          | 助手自然语言回复                                                                                                                                            |
| `sessionId`                      | 会话 id（续聊传入）                                                                                                                                         |
| `assistantId`                    | 本轮实际使用的助手                                                                                                                                          |
| `toolCalls` / `toolCallSequence` | 工具执行摘要（序列仅为名称列表）                                                                                                                            |
| `status`                         | 回合状态（与 Agent 内部一致）                                                                                                                               |
| `clarificationQuestions`         | 待澄清问题数组（若有则触发 Clarify–Execute 后续门禁）                                                                                                       |
| `taskId`                         | 此处为 **`result.turn.turnId`**（回合级标识；勿与引擎任务 JSON 混淆）                                                                                       |
| `taskTitle`                      | 由用户 `message` 推导的短标题                                                                                                                               |
| `memorySources`                  | `buildAgentMemorySourceReport` 结构化来源                                                                                                                   |
| `runtimeHints`                   | 仅当 `includeTurnDiagnostics === true` **或** Edition 为 **firm / private_deploy** 时附带：`lawmindRouterMode`、`lawmindReasoningMode`、`toolCallsExecuted` |

**会议室模式**：`meetingMode && matterId` 时，在返回前 **`appendTeamMeetingLinesSync`** 写入用户行（原始 `message`）与助手行（含 `assistantId` / `displayName` / `taskId` / `sessionId`）。

**典型错误**（`sendJsonError`）：**503** `missing_api_key`；**400** `invalid_matter_id`、`meeting_matter_required`；**409** `session_assistant_mismatch`（会话归属其他助手）；**500** `no_assistant_profile`。

**协作与联网**：`enableCollaboration` 为 **false** 或未定义时与 `built.config.enableCollaboration` 取交集；`allowWebSearch` 受 `isWebSearchForcedOffByPolicy()` 强制清零。

---

### 11.6 审核、渲染、重开审核

实现：`lawmind-server-route-review.ts`。

#### `POST /api/drafts/:taskId/review`

**Body**：

| 字段                    | 必填 | 说明                                                                                  |
| ----------------------- | ---- | ------------------------------------------------------------------------------------- |
| `status`                | 是   | 小写 **`approved`** \| **`rejected`** \| **`modified`**                               |
| `note`                  | 否   | 审核备注                                                                              |
| `appendToProfile`       | 否   | 为 true 时将审核摘要写入 **助手** `PROFILE.md`（`profileAssistantId` 默认 `default`） |
| `appendToLawyerProfile` | 否   | 写入 `LAWYER_PROFILE.md`                                                              |
| `profileAssistantId`    | 否   | 覆盖默认助手 id；须通过 `isSafeAssistantIdSegment`                                    |
| `labels`                | 否   | 经 `parseReviewLabels` 解析的结构化标签                                               |
| `deferMemoryWrites`     | 否   | true 时跳过档案追加（仍更新草稿审核状态）                                             |

**成功 200**：`draft`（更新后）、`citationIntegrity`；可选 `profileLearningSkipped` / `lawyerProfileLearningSkipped`；批准时可选 `contractRevisionAccumulatedId` / `contractRevisionAccumulationWarning`。**500** 且 `profileAppendFailed` / `lawyerProfileAppendFailed` 表示草稿已更新但档案写入失败。

#### `POST /api/drafts/:taskId/render`

- 可选 body：`{ "templateId": "word/..." }` 覆盖默认模板。
- 查询参数 **`strict`**：非 `false`/`0` 时默认 **strict**；未就绪 → **422** `acceptance_gate_blocked`，body 含 `acceptance` 报告。
- **200/400**：引擎 `render` 结果原样包装，并附带刷新后的 `citationIntegrity` 与 `acceptance`。

#### `POST /api/drafts/:taskId/reopen-review`

- 将草稿审核状态退回可编辑链；响应含新的 `acceptance` 与 `citationIntegrity`。

#### `GET /api/drafts/:taskId`

- 额外字段：`reasoningMarkdown`（由持久化推理图序列化）、`memorySources`、`acceptance`；并调用 `maybeEmitFirstrunAcceptanceReady`（首跑漏斗）。

---

### 11.7 模板与上传登记

#### `POST /api/templates/scan`

**Body**：`{ "path": "<相对 workspace 的 .docx 路径>" }` → 返回 `placeholders` 数组。

#### `POST /api/templates/register`

**Body**：`id`（正则 `upload/[a-z0-9][a-z0-9._-]{1,63}`）、`path` 或 `sourcePath`、`label`、`format`（`docx`|`pptx`）、可选 `placeholderMap`、`enabled`。源文件复制到 `lawmind/templates/stored/`（逻辑见 `registerUploadedTemplate`）。

#### `POST /api/templates/enabled`

**Body**：`id` + **`enabled` 布尔**（必填）。

#### `DELETE /api/templates/uploaded`

**Query**：`id=` 同上格式。

---

### 11.8 desk-settings 与记忆采纳 API

#### `GET/POST /api/workspace/desk-settings`

- **POST body**：仅 `{ "contractBatchRelativeDir": string | null }`；非法相对路径 → **400** `invalid_path`（code `invalid_contract_batch_dir`）。

#### `GET /api/memory/adoption`

**Query**：`scope`（`firm|lawyer|...`）、`state`（`pending|adopted|...`）、`matterId` 或 **`targetId`**（别名）。

#### `POST /api/memory/adoption/suggest`

**Body**：`scope`（必填合法枚举）、`kind`、`payload`（字符串）、可选 `targetId`、`sourceTaskId`、`note`、**`autoAdopt`**（boolean）。

#### `POST /api/memory/adoption/adopt` 与 `.../dismiss`

**Body**：`id`（必填）；可选 `note`。响应为服务层 `result` 对象（成功 **200**，业务失败 **400**）。

---

### 11.8.1 从工作流库启动任务（律师路径）

1. 在 **案件工作台** 选中案件 → **任务** Tab；若无进行中项，可点 **从工作流库启动**（或打开 **协作** → 工作流库）。
2. 在 **工作流库** 中按领域筛选模板，点击 **在本案件运行**（`POST /api/collaboration/workflow-run`，`async: true`）。
3. 运行中的团队流出现在任务看板 **Jobs** 行（`GET /api/jobs?matterId=`）；完成后草稿进入 **审核** 验收。
4. 标记 **需验收包** 的模板会在启动响应中带 `gateHint`；对外交付前请完成验收包导出。

模板文件位于 **`<workspace>/lawmind/workflows/`**。首次启动本机 LawMind 服务时，若目录为空会自动写入**内置命名工作流**（不覆盖已有文件）。

**内置命名工作流一览**（`namedAgent` 为律师可读的岗位名）：

| 模板 ID                    | 名称           | Named agent                 | 领域           |
| -------------------------- | -------------- | --------------------------- | -------------- |
| `nda-triage`               | 保密协议初审   | NDA Triager                 | 商事           |
| `contract-review`          | 合同审查意见   | Contract Review Analyst     | 商事           |
| `vendor-agreement-review`  | 供应商协议审查 | Vendor Agreement Reviewer   | 商事           |
| `demand-letter`            | 律师函起草     | Demand Letter Drafter       | 诉讼           |
| `matter-chronology`        | 案件时间线     | Chronology Builder          | 诉讼           |
| `evidence-index`           | 证据索引       | Evidence Indexer            | 诉讼           |
| `due-diligence-review`     | 尽调审查表     | Due Diligence Reviewer      | 尽调           |
| `client-update-memo`       | 客户邮件摘要   | Client Update Writer        | 客户           |
| `compliance-research-memo` | 合规研究报告   | Regulatory Research Analyst | 合规           |
| `renewal-monitor`          | 合同续签监控   | Contract Renewal Monitor    | 商事（可预约） |

预约后台运行：对 `schedulable: true` 的模板（如 `renewal-monitor`），`POST /api/collaboration/workflow-run` 请求体增加 `"scheduleRunAt": "2026-05-21T09:00:00.000Z"`（见 [LAWMIND-INTEGRATIONS.md](LAWMIND-INTEGRATIONS.md)）。工作流库卡片会显示 **可预约执行** 标签。

### 11.9 团队工作流模板 JSON

文件目录：**`<workspace>/lawmind/workflows/<templateId>.json`**。`templateId` 读取时经字符白名单净化；禁止路径穿越（`../evil` 无效）。

**顶层字段**（类型见 `workspace-workflow-templates.ts`）：

| 字段                     | 必填 | 说明                                                             |
| ------------------------ | ---- | ---------------------------------------------------------------- |
| `id`                     | 是   | 与文件名建议一致                                                 |
| `name`                   | 是   | 列表展示                                                         |
| `namedAgent`             | 否   | 律师可读岗位名（如 NDA Triager）                                 |
| `description`            | 否   | 列表展示                                                         |
| `steps`                  | 是   | 步骤数组                                                         |
| `acceptancePackRequired` | 否   | 为 true 时 UI 显示「需验收包」，运行后返回 `gateHint`            |
| `requiredSources`        | 否   | 建议绑定的来源标签（展示用）                                     |
| `schedulable`            | 否   | 为 true 时工作流库显示「可预约执行」；运行时可传 `scheduleRunAt` |

**每步 `WorkspaceWorkflowTemplateStep`**：

| 字段          | 说明                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `stepId`      | 唯一标识                                                                                                   |
| `assignee`    | **助手 id**（字符串），在工作流运行时作为该步承办人                                                        |
| `task`        | 自然语言任务说明；支持 **`{{varName}}`** 占位符；运行时用 `vars` + `matterId` 替换（未提供则保留占位文本） |
| `dependsOn`   | 前置 `stepId` 列表                                                                                         |
| `reviewBy`    | 可选；人类复核参与者                                                                                       |
| `autoApprove` | 可选；默认 true                                                                                            |

**最小示例**：

```json
{
  "id": "demo",
  "name": "Demo flow",
  "description": "本地验证用",
  "steps": [
    {
      "stepId": "a",
      "assignee": "default",
      "task": "阅读本案材料并列出要点 {{matterId}}",
      "dependsOn": []
    }
  ]
}
```

---

### 11.10 Roles API

- **`GET /api/roles`** → `{ ok: true, roles: Role[] }`，元素为 `src/lawmind/core/role.ts` 中完整 **Role** 对象（含 `allowedToolNames`、`allowedDeliverableTypes`、`memoryScope`、`riskCeiling`、`reviewChecklist` 等）。
- **`GET /api/roles/:roleId`** → 单个 `role`；未知 id → **404** `role not found`。

---

## 12. Agent 工具与 Clarify–Execute

**注册**：`createLegalToolRegistry`（`src/lawmind/agent/tools/legal-tools.ts`）聚合 **引擎桥接**（`engine-tools.ts`）、**协作**（`collaboration-tools.ts` / `coordination/*`）、**联网**（`lawmind-web-search.ts`）等。

**引擎桥接工具（摘要）**：

| 工具名             | 作用                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `plan_task`        | `engine.plan()`                                                                             |
| `research_task`    | `engine.research()`                                                                         |
| `draft_document`   | `engine.draft()`                                                                            |
| `render_document`  | `engine.render()`（内置 acceptance / reasoning gate；可 `bypass_acceptance_gate` 企业参数） |
| `execute_workflow` | plan → research → draft → render 一键；支持 `existing_task_id` + `restart_from`             |

**Matter 写侧（Agent 暴露的工具名）**：`open_work_queue_item`（参数含 `matter_id`、`kind`、`title`、`detail?`、`priority?`、`related_task_id?`、`related_deliverable_id?`，写入 `queue.jsonl`）、`request_approval`（`matter_id`、`risk_level`、`reason` 必填；可选 `deliverable_id`、`target_role`）、`record_deadline`（`matter_id`、`title`、`due_at`、`severity?`、`notes?`）。`transitionQueueItem` 在服务层供引擎热路径使用，**当前未注册为独立 Agent 工具**（见 `engine-tools.ts` 末尾 `void transitionQueueItem` 注释）。

**Clarify–Execute**：当工具返回待澄清问题时，同轮禁止并行调用 `research_task` / `draft_document` / `execute_workflow` / `render_document` 等重流程（`AgentContext.clarificationBlockingHeavyTools`）。

**Tool Policy 流水线**（`src/lawmind/runtime/tool-pipeline.ts`）：budget → roleAllowlist → approval → clarificationGate → argSchema → timeout → audit → execute。

**危险工具与显式批准**：Edition `strictDangerousToolApproval`（Firm/Private）；`LAWMIND_ALLOW_DANGEROUS_TOOLS_WITHOUT_APPROVAL` 在严格模式下不绕过（见 `dangerous-tool-policy.ts`、`runtime.ts`）。

---

## 13. 引擎管线与 Matter 写侧 JSON

**引擎模块拆分**（`src/lawmind/engine/`）：`factory`、`planning`、`researching`、`drafting`、`reviewing`、`rendering`、`queries`、`context`、`types`、`shared` 等 — 入口仍通过 `src/lawmind/index.ts` 对外 `createLawMindEngine`。

**Matter 写侧真相源**（与 Markdown 双轨）：`workspace/matters/<id>/matter.json`、`deliverables/*.json`、`approvals.jsonl`、`queue.jsonl`、`deadlines.jsonl` — 由 `src/lawmind/adapters/matter-storage/` 持久化；读侧 **优先 JSON**，缺失回退 `MatterIndex`（见 `LAWMIND-ARCHITECTURE.md` §Matter-centered）。

**Orchestrator**：`src/lawmind/agent/orchestrator/executor.ts` 执行工作流步骤；`assigneeRoleId`、`delegate_to_role` 与 `ApprovalRequest.targetRole` 支持角色到角色流程。

---

## 14. 记忆采纳（Memory Adoption）

**服务**：`src/lawmind/memory/adoption-service.ts` — 统一 Markdown 写入建议的 **pending / adopted / auto_adopted / dismissed** 四态。

**Scope**：`firm`、`lawyer`、`client`、`matter`、`playbook`、`opponent`、`project`、`assistant`。

**UI**：`MemoryInspector.tsx`；案件认知相关面板消费同一服务。

**HTTP**：见 §11.1 ` /api/memory/adoption*`。

---

## 15. 审计、合规导出与 Edition 功能开关

| 能力          | 位置                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| 审计事件      | `workspace/audit/*.jsonl`；核心 API `emit`（`src/lawmind/audit/`）                                       |
| Markdown 导出 | `GET /api/audit/export`；`buildAuditExportMarkdown`、`buildComplianceAuditMarkdown`                      |
| 合规模式      | 查询参数 `compliance=true` 等（见路由实现）                                                              |
| Edition       | `src/lawmind/policy/edition.ts` — `resolveEdition` 合并 **环境 + workspace policy**；桌面 `useEdition()` |

---

## 16. Electron IPC 与本地文件桥

**预加载暴露**（`apps/lawmind-desktop/electron/preload.cjs`）：`window.lawmindDesktop` — 包装 `ipcRenderer.invoke`。

**主进程 IPC 示例**（`electron/main.mjs`）：

| Channel                                                                              | 用途                                     |
| ------------------------------------------------------------------------------------ | ---------------------------------------- |
| `lawmind:get-config`                                                                 | 读取本地配置                             |
| `lawmind:check-updates`                                                              | 更新检查                                 |
| `lawmind:show-notification`                                                          | 系统通知（协作 Job 完成等）              |
| `lawmind:pick-workspace` / `lawmind:save-setup`                                      | 向导与工作区路径                         |
| `lawmind:set-retrieval-mode`                                                         | 检索模式                                 |
| `lawmind:pick-project` / `lawmind:set-project-dir`                                   | 项目目录                                 |
| `lawmind:fs:list` / `read` / `write` / `mkdir` / `rename` / `delete` / `copy`        | 本机文件（与 HTTP `/api/fs` 二选一路径） |
| `lawmind:dialog:open-files` / `lawmind:dialog:save-text-file`                        | 系统对话框                               |
| `lawmind:open-external` / `lawmind:show-item-in-folder` / `lawmind:open-with-system` | 打开外部/定位文件                        |

---

## 17. 命令行、Git 与日常脚本

> 以 **本仓库 monorepo 根目录** 为准；脚本名以 `package.json` 的 `scripts` 为准。

| 用途         | 命令                                                              |
| ------------ | ----------------------------------------------------------------- |
| 安装依赖     | `pnpm install`                                                    |
| 环境自检     | `npm run lawmind:env:check`                                       |
| 桌面开发     | `pnpm lawmind:desktop`                                            |
| 桌面打包     | `pnpm lawmind:desktop:dist`                                       |
| 智能助理 CLI | `pnpm lawmind:agent`                                              |
| 案件         | `pnpm lawmind:case` / `pnpm lawmind:case -- --matter <id>`        |
| 审核 CLI     | `pnpm lawmind:review`                                             |
| 运维         | `pnpm lawmind:ops -- status` / `doctor` / `doctor --deep`         |
| 烟雾测试     | `pnpm lawmind:smoke -- --fail-on-empty-claims`                    |
| 演示         | `pnpm lawmind:demo`（`--ppt` 等）                                 |
| 季末验收     | `pnpm lawmind:acceptance`（内部调用 `lawmind:quarterly-demo` 等） |
| 文档站       | `pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build`               |

**Git 更新**：`git pull --rebase` + `pnpm install`（勿对不可信脚本直接 `curl | bash`）。

---

## 18. 配置 `.env.lawmind` 与环境变量索引

**加载顺序**：桌面合并 **仓库根** 与 **用户目录** env，**后者覆盖**（见 §2.2）。

| 变量族                                          | 用途                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| `LAWMIND_QWEN_*` / `LAWMIND_AGENT_*` / `QWEN_*` | 主对话与检索的 OpenAI-compatible 端点                |
| `LAWMIND_AGENT_TIMEOUT_MS`                      | Agent 请求超时                                       |
| `LAWMIND_TOOL_TIMEOUT_MS`                       | 工具调用超时                                         |
| `LAWMIND_AGENT_MAX_TOOL_CALLS`                  | 单轮工具上限（policy 可覆盖）                        |
| `LAWMIND_RETRIEVAL_MODE`                        | `single` 或 `dual`                                   |
| `LAWMIND_CHATLAW_*` / 合作法律提供方            | dual 模式下法律适配器（见 `retrieval/providers.ts`） |
| `LAWMIND_WEB_SEARCH_API_KEY` / `BRAVE_API_KEY`  | 联网检索                                             |
| `LAWMIND_ENABLE_COLLABORATION`                  | `false` 关闭协作服务端行为                           |
| `LAWMIND_SKIP_AUTO_UPDATE`                      | `1` 跳过自动更新检查                                 |
| `LAWMIND_WORKSPACE_DIR`                         | 备份脚本等外部工具使用                               |

完整预设与对齐关系以 `lawmind:env:check` 输出为准。

---

## 19. 工作区目录说明（扩展）

`workspace/` 为运行数据与产出目录，建议定期备份。

| 路径                                  | 说明                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| `MEMORY.md`                           | 通用长期记忆（检索侧强相关；**不**整段进入主对话 system，见架构文档） |
| `LAWYER_PROFILE.md`                   | 律师偏好（**会**进入 Agent system）                                   |
| `memory/YYYY-MM-DD.md`                | 日日志                                                                |
| `cases/<matterId>/CASE.md`            | 案件档案                                                              |
| `cases/<matterId>/team-meeting.jsonl` | 会议室记录                                                            |
| `matters/<matterId>/`                 | Matter JSON 真相源（见 §13）                                          |
| `tasks/*.json`                        | 任务记录                                                              |
| `drafts/*.json`                       | 草稿与审核状态                                                        |
| `artifacts/`                          | 渲染产出                                                              |
| `audit/*.jsonl`                       | 审计                                                                  |
| `delegations/`                        | 委派持久化（若启用）                                                  |
| `collaboration-audit.jsonl`           | 协作审计节选                                                          |
| `lawmind/workflows/*.json`            | 团队工作流模板                                                        |
| `lawmind/jobs/*.json`                 | 异步 Job 状态                                                         |
| `lawmind/desk-settings.json`          | 桌面偏好                                                              |
| `lawmind/deliverables/*.json`         | 工作区私有 DeliverableSpec                                            |
| `learning/contract-revisions/`        | 合同修订积累                                                          |
| `learning/contract-reviews/drafts/`   | 合同审查草稿                                                          |

**助手档案根**：与 `assistants.json` 同级的 `LawMind/` 目录树（实际路径由 `resolveLawMindRoot` 与健康检查 `lawMindRoot` 字段提示）。

---

## 20. 更新 LawMind

| 形态           | 方式                        |
| -------------- | --------------------------- |
| **桌面打包版** | 应用内更新 + 手动安装包     |
| **Git 克隆**   | `git pull` + `pnpm install` |

---

## 21. 常见问题（扩展）

| 现象                                   | 处理方向                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| **401 / API Key**                      | 核对用户目录与仓库 `.env.lawmind` 合并规则                                           |
| **403 acceptance-pack**                | Edition Solo 关闭导出；切换 Firm/Private 或策略                                      |
| **422 acceptance_gate_blocked**        | 补齐章节、占位符、澄清项；或显式 `?strict=false`（不推荐生产）                       |
| **503 collaboration_disabled**         | 环境变量关闭协作                                                                     |
| **会议室 400 meeting_matter_required** | `meetingMode` 必须带合法 `matterId`                                                  |
| **Job SSE 断开**                       | 反向代理空闲超时；实现已每 25s `: ping`                                              |
| **委派不出现**                         | 助手数量、策略、`enableCollaboration`、模型是否调用工具；查 `workspace/delegations/` |
| **smoke 空 claims**                    | 模型/检索 JSON；可先去掉 `--fail-on-empty-claims`                                    |

备份：`scripts/lawmind/lawmind-backup.sh`（`LAWMIND_WORKSPACE_DIR`）。

---

## 22. 相关文档索引

| 文档                                                        | 用途                                     |
| ----------------------------------------------------------- | ---------------------------------------- |
| [客户交付](/LAWMIND-DELIVERY)                               | 交付清单、验收、升级回滚                 |
| [Deliverable-First](/LAWMIND-DELIVERABLE-FIRST)             | 交付物规格与门禁                         |
| [愿景与边界](/LAWMIND-VISION)                               | 产品方向                                 |
| [架构](./LAWMIND-ARCHITECTURE.md)                           | 五层模型、Job、Clarify–Execute、记忆规则 |
| [工程开发记忆](/LAWMIND-PROJECT-MEMORY)                     | 研发断点续作                             |
| [桌面端 UI](/LAWMIND-DESKTOP-UI)                            | 布局与组件                               |
| [桌面文件与上下文](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)      | 引用与上限                               |
| [协作 UI ↔ API 对照](/LAWMIND-COLLABORATION-UI-API-MAP)     | 协作页数据源                             |
| [合同修订积累](./LAWMIND-CONTRACT-REVISION-ACCUMULATION.md) | 学习落盘格式                             |
| [数据处理](/LAWMIND-DATA-PROCESSING)                        | 隐私与子处理者                           |
| [Support runbook](/LAWMIND-SUPPORT-RUNBOOK)                 | 运维                                     |

本文档应与 `apps/lawmind-desktop/INSTALL.md`、`RELEASE-CHECKLIST.md` 及 `lawmind-server-dispatch.ts` 路由变更同步维护。

---

## 23. GET /api/health 与运维自检字段

本地服务在启动向导与排障时依赖 **`GET /api/health`**。实现上由 `apps/lawmind-desktop/server/lawmind-server-route-health.ts` 组装，扩展统计来自 `lawmind-health-payload.ts`（`buildDoctorStats`、`buildMemoryTruthSourceFlags` 等）。

| 字段 / 分组                 | 说明                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceDir`              | 当前绑定的工作区根目录（绝对路径）                                                                                                                                                                         |
| `lawMindRoot`               | 助手存储根（`assistants.json` 与 `assistants/`）；可与 workspace 不同                                                                                                                                      |
| `modelConfigured`           | 是否检测到可用的对话模型环境变量组合                                                                                                                                                                       |
| `dualLegalConfigured` 等    | dual 检索模式下法律端点是否单独就绪                                                                                                                                                                        |
| `retrievalMode`             | 与 env / policy 对齐后的检索模式提示                                                                                                                                                                       |
| `policy`                    | `lawmind.policy.json` 是否加载及关键布尔开关（不泄露 `agentMandatoryRules` 全文）                                                                                                                          |
| `agentMandatoryRulesActive` | 强制规则是否注入 prompt（仅布尔/截断提示）                                                                                                                                                                 |
| `lawmindAgentMaxToolCalls`  | 单轮工具上限（env + policy 合并结果）                                                                                                                                                                      |
| **doctor 统计**             | `auditJsonlFileCount`：`workspace/audit` 下 `.jsonl` 文件数；`researchSnapshotCount`：`workspace/drafts/*.research.json` 数量；`taskCount` / `draftCount`：任务与草稿条数                                  |
| **记忆真相源**              | `memoryTruthSources`：`MEMORY.md`、`LAWYER_PROFILE.md`、`FIRM_PROFILE.md`、根 `CLIENT_PROFILE.md` 是否存在；`clientProfileFilesUnderClients`：`clients/<id>/CLIENT_PROFILE.md` 扫描计数（上限 200 目录项） |
| **版本**                    | 若设置 `LAWMIND_REPO_ROOT`，可尝试读取 monorepo 根 `package.json` 的 `version` 供 dev 对照                                                                                                                 |

**用法建议**：一线支持先保存 **整段 JSON** 再对照本文与 [Support runbook](/LAWMIND-SUPPORT-RUNBOOK)；不要向外部系统粘贴含路径的完整响应（可能暴露本机目录结构）。

---

## 24. GET /api/audit/export 与合规导出

**路由**：`apps/lawmind-desktop/server/lawmind-server-route-audit-export.ts`。

| 查询参数     | 说明                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| `matterId`   | 可选；非法 ID → **400** `invalid matter id`                                    |
| `taskId`     | 可选；过滤单任务相关事件                                                       |
| `since`      | 可选；时间下界（传入 `buildAuditExportMarkdown` / compliance 变体）            |
| `until`      | 可选；时间上界                                                                 |
| `compliance` | `1` 或 `true`（大小写不敏感）→ 使用 `buildComplianceAuditMarkdown`             |
| `integrity`  | `1` 或 `true` → JSON 完整性链摘要（Firm/Private，`auditIntegrityExport`）      |
| `replay`     | `1` 或 `true` → **JSON** 机器可读时间线（Agent Replay 风格；与 Markdown 互斥） |

**响应**：

- 默认：`200`，`Content-Type: text/markdown; charset=utf-8`；适合落盘为 `.md`。
- `?replay=true`：`200`，`application/json`，body 含 `{ ok, replay: { schemaVersion, events, tasks, summary } }`。

示例：`GET /api/audit/export?replay=true&matterId=matter-001`

**记忆采纳预览 diff**（Inspector）：`GET /api/memory/adoption/<suggestionId>/preview-diff?matterId=` 返回行级 `hunks`（采纳前模拟写入）。

**工作区全文检索（FTS）**：

- `GET /api/search/workspace?q=&matterId=&source=audit,session,knowledge|all&limit=30` — 查询 `lawmind/search-index.sqlite`（审计 + 会话 turns + 个人知识库 FTS hybrid；`source=knowledge` 仅知识语料）。
- `POST /api/search/workspace/rebuild` — 全量重建含知识语料（需环境变量 `LAWMIND_ALLOW_INDEX_REBUILD=1`）。
- `GET /api/health` → `doctor.searchIndex` — 行数、上次重建时间。
- 案件工作台搜索会并行合并 `GET /api/matters/search` 与 FTS 命中（「审计」「会话」分组）。

**审核台修订提案（Redline MVP）**：

- `GET /api/drafts/<taskId>/redline` · `POST .../redline/generate` · `POST .../hunks/<hunkId>/resolve`（`decision`: `accept` | `reject`）。
- 真相源：`drafts/<taskId>.redline.json`；接受后写回 `draft.sections`。

---

## 25. 案件与 Matter 相关 HTTP 细节

实现主文件：`apps/lawmind-desktop/server/lawmind-server-route-matters.ts`，域逻辑在 `src/lawmind/cases/` 与 `src/lawmind/application/services/`。

### 25.1 `GET /api/matters/detail`

- **查询参数**：`matterId`（须通过 `isValidMatterId`）。
- **典型用途**：案件工作台首屏、任务/草稿列表、**每草稿引用完整性**视图（`draftCitationIntegrity`）。
- **读侧**：若存在 `workspace/matters/<id>/` JSON 真相源，列表类数据与 `/api/approvals`、`/api/queues` 一致——**优先结构化存储**，否则回退从 `cases/`、`tasks/` 等推导的索引。

### 25.2 `POST /api/matters/interaction`

- **用途**：记录律师在案件工作台的 **UI 级动作**，供 Insights 聚合与审计。
- **服务端**：`describeMatterInteraction` 生成规范化中文描述，`parseMatterInteractionDetail` 在 `GET /api/matters/interaction-rollup` 侧做归类；**自定义任意字符串**可能落入 `unknown`，Insights 权重较低。

### 25.3 `POST /api/matters/case-note`

**用途**：直接向 `CASE.md` 追加一条结构化笔记（不经过 `interaction` 审计句式）。

**Body（JSON）**：

| 字段       | 必填 | 取值                                                | 说明                                                         |
| ---------- | ---- | --------------------------------------------------- | ------------------------------------------------------------ |
| `matterId` | 是   | 合法 matter id                                      | 否则 **400** `invalid matter id`                             |
| `section`  | 是   | `core_issue` \| `risk` \| `artifact` \| `task_goal` | 决定写入 CASE 的哪一类段落；非法 → **400** `invalid section` |
| `note`     | 是   | 非空 trim 字符串                                    | 否则 **400** `note required`                                 |

成功 **200** `{ ok: true }`。内部映射：`core_issue` → `appendCaseCoreIssue`；`risk` → `appendCaseRiskNote`；`artifact` → `appendCaseArtifact`；`task_goal` → `appendCaseTaskGoal`。

**与 `POST /api/matters/interaction` 区别**：`interaction` 在 `action: "write_case_note"` 时主要产生 **审计事件**（及可选 `ux.matter_action`）；本接口是 **CASE 文件写侧**快捷入口。

### 25.4 `GET /api/matters/team-meeting`

- **参数**：`matterId`（必填）；`limit`（可选）；`skipFromEnd`（可选，分页「更早消息」）。
- **实现**：`readTeamMeetingWindow`（`src/lawmind/cases/team-meeting.ts`）；`TEAM_MEETING_TAIL_LIMIT_DEFAULT` 与 `TEAM_MEETING_TAIL_LIMIT_CAP` 限制最大窗口，避免一次读取超大 JSONL。
- **响应**：含 **`total`**（文件总行数）与 **`lines`**（窗口内解析后的条目）。

### 25.5 `GET /api/matters/search` 与列表

- **`GET /api/matters`**：轻量枚举 matterId。
- **`GET /api/matters/search`**：支持关键词与索引搜索（测试见 `lawmind-server-route-matters.test.ts`）。

### 25.6 `GET` / `POST /api/matters/role`

**用途**：标记 `cases/<matterId>/` 目录在系统中的语义（**matter** = 正式案件目录；**folder** = 仅材料夹），落盘 `.lawmind-role.txt` 等（见 `readCaseSubdirRole` / `writeCaseSubdirRole`）。

**`GET`**：查询参数 **`matterId`**（必填且合法）。响应：`{ ok, matterId, role }`。

**`POST`** Body：

| 字段       | 说明                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matterId` | 必填；须 `isValidMatterId`                                                                                                                                   |
| `role`     | 字符串，**trim 后小写**：`matter` 或 `case` → 存为 **`matter`**；`folder` 或 `storage` → 存为 **`folder`**。其它值 → **400** `role must be matter or folder` |

当 `role` 为 `matter` 时，服务端先 **`createMatterIfAbsent`**（幂等建案骨架）再写角色。路径仍受 `resolvedMatterCaseDir` 约束，防止 `..` 穿越。

### 25.7 `GET /api/matters/overviews` 与 `GET /api/matters/interaction-rollup`

- **overviews**：多案件卡片数据（进度、标签等，随版本演进）。
- **rollup**：对 `interaction` 事件做聚合统计，供右栏 Insights 图表消费。

### 25.8 `GET /api/approvals` 与 `GET /api/queues`

**用途**：Matter 写侧 **审批请求** 与 **工作队列项** 只读列表；读侧优先 **`workspace/matters/<id>/`** 下 JSONL 真相源，与 Agent 工具 `request_approval`、`open_work_queue_item` 写入一致。

**`GET /api/approvals`** 查询参数：

| 参数         | 说明                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `matterId`   | 可选；过滤单案；非法 → **400**                                                                               |
| `status`     | 可选；**`pending`** \| **`approved`** \| **`rejected`** \| **`needs_changes`**；其它值被忽略（不按状态过滤） |
| `targetRole` | 可选；按目标角色 id 过滤                                                                                     |

**`GET /api/queues`** 查询参数：

| 参数       | 说明                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matterId` | 可选；非法 → **400**                                                                                                                                                                                   |
| `kind`     | 可选；须为队列条目 **kind** 枚举之一（与 `open_work_queue_item` 的 `QUEUE_KIND_VALUES` 对齐），例如 `need_evidence`、`ready_to_draft`、`ready_to_render` 等；传错类型在路由层可能视为 `undefined` 过滤 |

### 25.9 Matter 路由逐项（与实现一一对应）

下列均出自 `lawmind-server-route-matters.ts`（及同文件内挂接的 `/api/approvals`、`/api/queues`）。

| 方法 | 路径                              | 查询 / Body                                | 成功响应要点                                                       | 典型错误                           |
| ---- | --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| GET  | `/api/matters`                    | —                                          | `{ ok, matterIds }` 字符串数组                                     | —                                  |
| GET  | `/api/matters/search`             | `matterId`、`q`                            | `{ hits }` 最多 60 条                                              | matter 非法 **400**                |
| GET  | `/api/matters/detail`             | `matterId`                                 | 见下表「detail 大字段」                                            | **400**                            |
| POST | `/api/matters/create`             | `{ matterId, displayName? }`               | `{ ok, created?, caseFilePath?, ... }`（`createMatterIfAbsent`）   | **400** 消息体为异常文本           |
| POST | `/api/matters/display-name`       | `{ matterId, displayName }`（展示名 ≤200） | `{ ok, matterId, displayName }`                                    | 空名、过长 **400**                 |
| POST | `/api/matters/delete`             | `{ matterId }`                             | `{ ok, deletedFromDisk }`；目录本不存在亦为 **200**                | **400** / **500**                  |
| GET  | `/api/matters/team-meeting`       | `matterId`、`limit?`、`skipFromEnd?`       | `{ lines, total }`；`limit` clamp 到 `TEAM_MEETING_TAIL_LIMIT_CAP` | **400**                            |
| POST | `/api/matters/case-note`          | 见 §25.3                                   | `{ ok: true }`                                                     | **400**                            |
| POST | `/api/matters/interaction`        | 见下「interaction」                        | `{ ok, taskId, event }`                                            | **400** `no task found for matter` |
| GET  | `/api/matters/overviews`          | —                                          | `{ overviews }`                                                    | —                                  |
| GET  | `/api/matters/interaction-rollup` | —                                          | rollup 对象展开在顶层                                              | —                                  |
| GET  | `/api/matters/role`               | `matterId`                                 | `{ matterId, role }`                                               | **400**                            |
| POST | `/api/matters/role`               | 见 §25.6                                   | `{ ok, matterId, role }`                                           | **400** / **500**                  |
| GET  | `/api/approvals`                  | 见 §25.8                                   | `{ approvals }`                                                    | **400**                            |
| GET  | `/api/queues`                     | 见 §25.8                                   | `{ queueItems }`                                                   | **400**                            |

**`POST /api/matters/interaction` Body**：

| 字段                | 必填 | 说明                                                                        |
| ------------------- | ---- | --------------------------------------------------------------------------- |
| `matterId`          | 是   | 合法 id                                                                     |
| `action`            | 是   | **`open_review`** \| **`save_upgrade_suggestion`** \| **`write_case_note`** |
| `taskId`            | 否   | 优先绑定任务；缺省时取本案 **最近更新** 的任务                              |
| `surface` / `label` | 否   | 拼进审计 `detail` 中文句                                                    |
| `target`            | 否   | `lawyer` \| `assistant`（用于 save_upgrade 叙述）                           |
| `variant`           | 否   | `conservative` \| `standard` \| `assertive`                                 |
| `section`           | 否   | `core_issue` \| `risk` \| `artifact` \| `task_goal`                         |

若本案无任何任务 → **400** `no task found for matter`。成功时写 **`ui.matter_action`**；若策略允许产品洞察，再 best-effort 写 **`ux.matter_action`**。

**`GET /api/matters/detail` 响应体主要键**（除 `ok`、`matterId`）：

| 键                                                                         | 说明                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `summary` / `overview`                                                     | `summarizeMatterIndex` / `buildMatterOverview` 结构化摘要                |
| `caseMemory`                                                               | CASE.md 全文或截断至 **120000** 字符；`caseMemoryTruncated` 标明是否截断 |
| `coreIssues` / `taskGoals` / `riskNotes` / `progressEntries` / `artifacts` | 从索引解析的列表                                                         |
| `tasks` / `drafts`                                                         | 本案任务与草稿完整记录                                                   |
| `approvalRequests` / `queueItems`                                          | 与两 GET 路由同源列表                                                    |
| `draftCitationIntegrity`                                                   | `Record<taskId, DraftCitationIntegrityView>` 每草稿引用视图              |
| `auditEvents`                                                              | 最近 **80** 条相关审计（切片）                                           |

---

## 26. Insights 计算与事件管道

### 26.1 事件从哪来

- 案件工作台关键操作经 `POST /api/matters/interaction` 与审计 `emit` 落盘。
- **双写**：`ui.matter_action`（既有）与 **`ux.matter_action`**（产品洞察）；后者受 `lawmind.policy.json` → **`productInsightsCollection`** 控制：`off` / `local-only` / `synced`（见 `src/lawmind/policy/workspace-policy.ts`）。

### 26.2 计算层（纯函数）

目录 **`src/lawmind/insights/`**：

| 模块                             | 作用           |
| -------------------------------- | -------------- |
| `compute-behavior-summary.ts`    | 行为摘要       |
| `compute-convergence-hints.ts`   | 交互收敛建议   |
| `compute-product-experiments.ts` | 实验假设与信号 |
| `compute-roadmap-cards.ts`       | Roadmap 候选卡 |
| `insights.test.ts`               | 回归测试       |

类型定义：`types.ts`；对外聚合入口：`index.ts`。

### 26.3 展示层（桌面）

目录 **`apps/lawmind-desktop/src/renderer/insights/`**：

| 组件                         | 对应右栏区块                           |
| ---------------------------- | -------------------------------------- |
| `LawyerActionFeed.tsx`       | 最近律师动作时间线                     |
| `InteractionConvergence.tsx` | 收敛建议                               |
| `ProductExperiments.tsx`     | 实验清单与跨案件累积视图（随包装变化） |

**注意**：Insights **不是法律结论**；样本量少或尚未使用审核/CASE 入口时，建议以「方向性提示」阅读。

---

## 27. Agent 工具名全表（OpenAI function name）

下列名称与运行时 **`ToolRegistry`** 注册项一致（用于审计日志、模型账单分析与二次开发对表）。

### 27.1 引擎与工作流（`engine-tools.ts`）

`plan_task`、`research_task`、`draft_document`、`render_document`、`execute_workflow`、`register_template`、`list_templates`、`open_work_queue_item`、`request_approval`、`record_deadline`。

### 27.2 Matter / 检索 / 材料（`legal-tools.ts`）

`search_matter`、`search_workspace`、`read_project_file`、`search_statute`、`search_case_law`、`check_conflict_of_interest`、`get_matter_summary`、`list_matters`、`read_case_file`、`add_case_note`、`analyze_document`、`write_document`、`list_tasks`、`list_drafts`、`get_audit_trail`。

### 27.3 协作与人类在环（`coordination/*.ts`）

`delegate_task`、`delegate_to_role`、`list_delegations`、`get_delegation_result`、`consult_assistant`、`request_review`、`notify_assistant`。

### 27.4 联网（`lawmind-web-search.ts`）

`web_search`（仅当 UI 与策略允许且配置 API Key 时可用）。

---

## 28. 测试与质量门禁入口

| 入口            | 命令或路径                                              | 说明                                                      |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| 单元 / 集成测试 | 仓库根 `pnpm test`（Vitest）                            | 覆盖 `src/lawmind/**/*.test.ts` 与桌面 `server/*.test.ts` |
| 黄金引擎路径    | `src/lawmind/integration/phase-a-golden-engine.test.ts` | matter → 草稿 → review → render → 审计                    |
| 季末回归        | `src/lawmind/integration/quarterly-acceptance.test.ts`  | 与 `pnpm lawmind:acceptance` 编排一致                     |
| 桌面 E2E        | `pnpm lawmind:desktop:e2e`                              | 例如 `apps/lawmind-desktop/e2e/matter-cockpit.spec.ts`    |
| HTTP 冒烟       | `pnpm lawmind:desktop:http-smoke`                       | 本地路由快速探测                                          |
| 交付物 CLI 门禁 | `pnpm lawmind:gate -- --pack <taskId>` 等               | 脚本 `lawmind-deliverable-check.ts`                       |

**建议**：私有化交付验收时，至少跑 **`pnpm test`** + **`pnpm lawmind:smoke`**（按需加 `--fail-on-empty-claims`），并在客户环境保存一份 `GET /api/health` JSON。

---

## 29. 根目录 `package.json` 脚本对照

下列脚本定义在仓库根 **`package.json`**（版本号以文件为准）。

| 脚本                                      | 入口文件                                | 说明                                                  |
| ----------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| `lawmind:acceptance`                      | `scripts/lawmind/lawmind-acceptance.ts` | 验收编排；内部可调用 `lawmind:quarterly-demo`         |
| `lawmind:agent`                           | `scripts/lawmind/lawmind-agent.ts`      | CLI Agent                                             |
| `lawmind:bundle:desktop-server`           | esbuild CLI                             | 将 `lawmind-local-server.ts` 打成 Node CJS 供打包嵌入 |
| `lawmind:case`                            | `scripts/lawmind/lawmind-case.ts`       | 案件列表/详情                                         |
| `lawmind:demo`                            | `scripts/lawmind/lawmind-demo.ts`       | 演示材料生成                                          |
| `lawmind:desktop`                         | pnpm filter                             | Electron + Vite dev                                   |
| `lawmind:desktop:dist`                    | app `dist:electron`                     | 发行构建                                              |
| `lawmind:desktop:e2e`                     | app `test:e2e`                          | 端到端                                                |
| `lawmind:desktop:http-smoke`              | `lawmind-desktop-http-smoke.mjs`        | HTTP 冒烟                                             |
| `lawmind:docs:dev` / `build` / `preview`  | `apps/lawmind-docs`                     | VitePress                                             |
| `lawmind:env:check`                       | `lawmind-env-check.ts`                  | 环境变量矩阵自检                                      |
| `lawmind:gate`                            | `lawmind-deliverable-check.ts`          | 验收/导出包 CLI                                       |
| `lawmind:onboard`                         | `lawmind-onboard.ts`                    | 工作区一键初始化                                      |
| `lawmind:ops`                             | `lawmind-ops.ts`                        | 运维 status / doctor                                  |
| `lawmind:quarterly-demo`                  | `lawmind-quarterly-demo.ts`             | 季度演示链                                            |
| `lawmind:review`                          | `lawmind-review.ts`                     | 审核 CLI                                              |
| `lawmind:sbom` / `lawmind:sbom:cyclonedx` | Node / cyclonedx CLI                    | 供应链清单                                            |
| `lawmind:setup`                           | `lawmind-quick-setup.ts`                | 快速设置                                              |
| `lawmind:smoke`                           | `lawmind-smoke.ts`                      | 端到端烟雾                                            |
| `lawmind:vendor:desktop-node`             | `vendor-lawmind-desktop-node.mjs`       | 打包用 Node 运行时准备                                |
| `test` / `test:watch`                     | Vitest                                  | 全仓测试                                              |

---

## 30. 源代码导航速查

### 30.1 引擎与域模型（`src/lawmind/`）

| 路径                       | 职责                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `agent/runtime.ts`         | `runTurn`、工具循环、与 `tool-pipeline` 衔接                                            |
| `agent/system-prompt.ts`   | System prompt 组装（含强制规则、岗位、CASE、助手 PROFILE）                              |
| `agent/tools/`             | 工具实现：`legal-tools.ts`、`engine-tools.ts`、`coordination/`、`lawmind-web-search.ts` |
| `agent/orchestrator/`      | 工作流执行器、进度回调、中止信号                                                        |
| `runtime/tool-pipeline.ts` | ToolPolicy 八段中间件                                                                   |
| `engine/`                  | plan / research / draft / review / render 分解                                          |
| `memory/`                  | `loadMemoryContext`、`appendLawyerProfileLearning`、`adoption-service.ts`               |
| `deliverables/`            | 规格注册、`validateDraftAgainstSpec`、`reasoning-validator.ts`                          |
| `drafts/`                  | 草稿 JSON、引用完整性、`research-snapshot`                                              |
| `tasks/`                   | 任务生命周期、checkpoints、`deriveExecutionPlanSteps`                                   |
| `cases/`                   | matter 列表、索引、会议室、标签、matter-create                                          |
| `application/services/`    | matter-write、approval、queue-write、deliverable、deadline                              |
| `adapters/matter-storage/` | Matter JSON schema 与 IO                                                                |
| `audit/`                   | 事件模型与 Markdown 导出                                                                |
| `policy/`                  | `workspace-policy.ts`、`edition.ts`                                                     |
| `learning/`                | 学习队列、合同修订包、desk-settings                                                     |
| `integration/`             | `phase-a-golden-engine.test.ts`、`quarterly-acceptance.test.ts`                         |

### 30.2 桌面应用（`apps/lawmind-desktop/`）

| 路径                                 | 职责                                     |
| ------------------------------------ | ---------------------------------------- |
| `electron/main.mjs`                  | 窗口、菜单、IPC、本机文件、通知          |
| `electron/preload.cjs`               | `contextBridge` 暴露 `lawmindDesktop`    |
| `server/lawmind-server-dispatch.ts`  | HTTP 路由总线                            |
| `server/lawmind-server-route-*.ts`   | 各域路由（ matters / chat / review / …） |
| `src/renderer/App.tsx`               | 根 UI 与主视图路由                       |
| `src/renderer/lawmind-app-shell*.ts` | 壳层状态与域刷新                         |
| `src/renderer/lawmind-app-data.ts`   | `fetch` 封装本地 API                     |
| `src/renderer/matter/*.tsx`          | 案件驾驶舱拆分视图                       |

---

## 31. 路径参数与 ID 安全规则

以下规则来自 `apps/lawmind-desktop/server/safe-*.ts` 与 `lawmind-server-jobs.ts`，用于防止把 `../` 拼进磁盘路径或日志注入异常段。

| 用途                            | 校验函数 / 位置                          | 规则摘要                                                             |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| **任务 / 草稿 URL 段** `taskId` | `isSafeTaskIdSegment`                    | 长度 ≤ **200**；不得含 `..`、`/`、`\`；正则 `^[a-zA-Z0-9._-]+$`      |
| **助手 id**（URL 与部分 body）  | `isSafeAssistantIdSegment`               | 非空 trim 后不得含 `.` `/` `\`（比 task 更严，避免与路径混淆）       |
| **异步 Job id**                 | `isSafeWorkflowJobId`                    | 长度 **1–128**；不得含 `/`、`\`、`..`；`^[a-zA-Z0-9._-]+$`           |
| **案件 id** `matterId`          | `isValidMatterId`（`src/lawmind/cases`） | 与「新建案件」规则一致：字母或数字开头，总长 2–128，`[a-zA-Z0-9._-]` |
| **来源 id** `sourceId`          | `lawmind-server-route-sources.ts`        | 禁止 `/`、`\`、`\0`；长度 ≤ **256**（其余可打印字符兼容历史快照）    |
| **工作流模板 id**               | `readWorkspaceWorkflowTemplate`          | 仅白名单字符；文件名 `{safeId}.json`，拒绝穿越                       |

**实践**：集成测试或脚本里生成 id 时**只使用**上述字符集；不要用 URL 未编码的中文或空格作为 `taskId`（可能未定义行为）。

---

## 32. 异步 Job 公开 JSON 形状

`GET /api/jobs`、`GET /api/jobs/:id`、SSE 每帧的 **`job`** 字段类型为 **`PublicWorkflowJob`**（`lawmind-server-jobs.ts`）：在持久化记录基础上去掉 **`workspaceDir`** 与 **`idempotencyKey`**，避免把敏感路径或幂等键泄露给前端。

| 字段                                      | 类型             | 说明                                                                                                                         |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `jobId`                                   | string           | 与 URL 段一致                                                                                                                |
| `kind`                                    | `"workflow_run"` | 当前仅此类 Job                                                                                                               |
| `status`                                  | string           | `queued` \| `running` \| `completed` \| `failed` \| `cancelled`                                                              |
| `workflowId`                              | string           | 协作工作流实例 id                                                                                                            |
| `createdAt` / `startedAt` / `completedAt` | ISO 字符串       | 时间线                                                                                                                       |
| `error`                                   | string?          | 失败原因摘要                                                                                                                 |
| `cancelRequested`                         | boolean?         | 用户已请求取消                                                                                                               |
| `progress`                                | object?          | `totalSteps`、`completedSteps`、`failedSteps`、`runningStepIds`、`updatedAt`                                                 |
| `result`                                  | object?          | 终态时：`ok`、`workflowId`、`status`、`report`（Markdown 或长文本）、`steps[]`（每步 `stepId`/`assignee`/`status`/`error?`） |

**与磁盘**：终态会写入 `workspace/lawmind/jobs/<jobId>.json`；进程异常退出时非终态可能被标为 `interrupted_by_restart`（见 `GOALS.md` Phase 7）。

---

## 33. Electron `window.lawmindDesktop` 接口一览

预加载脚本 `apps/lawmind-desktop/electron/preload.cjs` 通过 `contextBridge.exposeInMainWorld("lawmindDesktop", { ... })` 暴露以下 **Promise 化**方法（内部均为 `ipcRenderer.invoke`）。事件订阅返回 **unregister 函数**。

| 属性 / 方法                                                                      | 参数           | 说明                                                           |
| -------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------- |
| `getConfig`                                                                      | —              | 读本地安装/向导配置                                            |
| `checkForUpdates`                                                                | —              | 触发更新检查                                                   |
| `showNotification`                                                               | `payload` 对象 | 转发主进程 `Notification`                                      |
| `onNotificationClick`                                                            | `handler`      | 监听 `lawmind:notification-click`；返回 `() => removeListener` |
| `pickWorkspace`                                                                  | —              | 系统目录选择                                                   |
| `saveSetup`                                                                      | `payload`      | 保存向导结果                                                   |
| `setRetrievalMode`                                                               | `mode` 字符串  | 检索模式                                                       |
| `pickProject` / `setProjectDir`                                                  | 路径           | 项目根（与 `LAWMIND_PROJECT_DIR` / HTTP `root=project` 对齐）  |
| `openExternal`                                                                   | `url`          | 系统浏览器                                                     |
| `showItemInFolder`                                                               | `fullPath`     | 在访达/资源管理器中显示                                        |
| `openWithSystem`                                                                 | `payload`      | 用系统默认应用打开                                             |
| `fsList` / `fsRead` / `fsWrite` / `fsMkdir` / `fsRename` / `fsDelete` / `fsCopy` | `payload`      | 与 HTTP `/api/fs` 能力平行，payload 形状由主进程校验           |
| `saveTextFileDialog` / `openFilesDialog`                                         | `payload?`     | 原生对话框                                                     |
| `onFileMenu`                                                                     | `handler`      | 菜单动作回调                                                   |

**安全提示**：预加载不暴露任意 Node；敏感路径校验在主进程完成。详见 `SECURITY.md` 与桌面交付清单。

---

## 34. `POST /api/collaboration/workflow-run` 请求体

实现：`lawmind-server-route-collaboration.ts`。若 **`LAWMIND_ENABLE_COLLABORATION=false`** → **503** `collaboration_disabled`。若未配置模型 → **503** `missing_api_key`。

| 字段             | 必填 | 说明                                                                          |
| ---------------- | ---- | ----------------------------------------------------------------------------- |
| `templateId`     | 是   | 对应 `lawmind/workflows/<id>.json` 的 `id`                                    |
| `matterId`       | 否   | 若传则须合法；注入模板 `{{matterId}}` 与 orchestrator 上下文                  |
| `assistantId`    | 否   | 非空时合并进 `AgentConfig`（`actorId` 形如 `assistant:<id>`）                 |
| `vars`           | 否   | `Record<string,string>`，替换任务文案中 **`{{key}}`**（除内置 `matterId` 外） |
| `async`          | 否   | **`true`** 时 **202** + `{ jobId, async: true }`；桌面协作页固定异步          |
| `idempotencyKey` | 否   | 同进程内相同 key 合并重复提交（长度 ≤128）                                    |

**同步模式**（`async` 非 true）：**200**，body 含 `workflowId`、`status`、`report`、`steps[]` 摘要；失败 **500** `workflow_run_failed`。

---

## 35. 离线阅读与打印（PDF）

| 方式                 | 做法                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| **浏览器打印为 PDF** | 打开在线手册，打印 → 另存为 PDF；必要时勾选「背景图形」。                             |
| **Pandoc**           | `pandoc docs/LAWMIND-USER-MANUAL.md -o LawMind-使用手册.pdf`                          |
| **VitePress**        | `pnpm lawmind:docs:dev` / `pnpm lawmind:docs:build`；见 `apps/lawmind-docs/README.md` |

在线版本：https://docs.lawmind.ai/LAWMIND-USER-MANUAL

---

## 36. 验收与推理报告 JSON 语义

类型定义：`src/lawmind/deliverables/types.ts`。下列字段出现在 **`GET /api/drafts/:taskId/acceptance`**、**`GET /api/drafts/:taskId`**（内嵌 `acceptance`）、以及渲染 **422** 的 `acceptance` 负载中。

### 36.1 `AcceptanceReport`（结构验收 / Deliverable-First）

| 字段                            | 类型                | 含义                                                                                  |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `taskId`                        | string              | 草稿任务 id                                                                           |
| `deliverableType`               | string?             | 与 `DeliverableSpec.type` 对齐；无 spec 时可能为空                                    |
| `ready`                         | boolean             | **所有 severity=`blocker` 的检查项均 `passed`** 时为 true；渲染 strict 模式依赖此字段 |
| `checks`                        | `AcceptanceCheck[]` | 逐项结果                                                                              |
| `blockerCount` / `warningCount` | number              | 未通过项计数（按 severity）                                                           |
| `placeholderCount`              | number              | 在章节与 `reviewNotes` 中匹配占位符规则的次数                                         |
| `placeholderSamples`            | string[]            | 最多 **5** 条样例片段，供 UI 提示                                                     |
| `generatedAt`                   | ISO string          | 报告生成时间                                                                          |

**`AcceptanceCheck` 单项**：`key`（稳定键）、`label`（人读说明）、`passed`、`severity`（`blocker` \| `warning`）、`hint?`（失败时的修复建议）。

**与 spec 的关系**：`validateDraftAgainstSpec` 会按 `requiredSections`、`acceptanceCriteria`、`placeholderRule` 等生成 `checks`；可选 `requireCriteriaCoverage`（类型上存在，HTTP 路由使用默认行为）。

### 36.2 `ReasoningReport`（推理门禁 W9）

由 `validateReasoningForDraft` → `validateReasoningAgainstSpec`（`reasoning-validator.ts`）产出，与 **`GET /api/drafts/:taskId/acceptance`** 同响应中的 **`reasoning`** 字段。

| 字段                            | 说明                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`                      | 仅当对应 `DeliverableSpec.reasoningGate.required === true` 时为 true；否则为信息性门禁，`ready` 仍可能为 true                                                                                                                                                                                               |
| `ready`                         | `required` 为 false 时，缺图也可判为 ready；为 true 时须满足所有 blocker 级 `ReasoningCheck`                                                                                                                                                                                                                |
| `checks`                        | 稳定 **`key`** 含：`graph_present`（无快照时）、`min_issues`、`facts_grounded`、`authority_conflicts_resolved`、`issues_have_authority`、`confidence_ok`；各条 `severity` 随 **`reasoningGate.required`** 与 **`mustResolveAuthorityConflicts`** 在 blocker / warning 间切换（见 `reasoning-validator.ts`） |
| `blockerCount` / `warningCount` | 同 acceptance 形态，便于 UI 并列渲染                                                                                                                                                                                                                                                                        |
| `taskId`                        | 有图谱时为 **`graph.taskId`**；无图谱占位为 **`"(unknown)"`**（仅缺图早退分支）                                                                                                                                                                                                                             |

**`spec` 摘要**（acceptance 路由附带）：`type`、`displayName`、`defaultOutput`、`description`、**`reasoningGate`**（原样或 `null`），供前端决定是否展示推理面板。

### 36.3 `GET /api/drafts/:taskId/acceptance-pack`

- **`?format=markdown`（默认）**：**200** 流式 **`text/markdown`**，头 `Content-Disposition: attachment; filename="lawmind-acceptance-pack-<taskId>.md"`。
- **`?format=json`**：**200** JSON `{ ok, taskId, markdown }`（便于二次加工）。
- **403**：当前 Edition **`acceptancePackExport`** 为 false（典型为 **Solo**），body 含 `feature_disabled` 与 `hint`。
- 依赖 `buildDraftAcceptancePackMarkdown`（`src/lawmind/delivery/draft-acceptance-pack.ts`）。

---

## 37. Edition `features` 全量对照

**解析**：`resolveEdition`（`src/lawmind/policy/edition.ts`）——优先级 **`lawmind.policy.json` 的 `edition` 字段** > 环境变量 **`LAWMIND_EDITION`** > 默认 **`solo`**。`GET /api/policy/edition` 返回 `edition`、`label`、`source`、`features` 对象。

下表为 **`EDITION_FEATURES`** 各键在 **solo / firm / private_deploy** 下的默认值（`true` = 该版本默认开启）。

| Feature key                      | solo  | firm  | private_deploy | 产品含义（摘要）                                           |
| -------------------------------- | ----- | ----- | -------------- | ---------------------------------------------------------- |
| `acceptanceGateStrict`           | true  | true  | true           | 未过验收则 strict 渲染拦截（与路由 `strict` 默认行为协同） |
| `citationGateStrict`             | true  | true  | true           | 有研究快照时，缺来源/未锚定长引用则拦截渲染                |
| `crossMatterRoadmap`             | false | true  | true           | 跨案件 Roadmap / 决策卡类 UI                               |
| `crossMatterAcceptanceDashboard` | false | true  | true           | 工作区级验收聚合面板 / `acceptance-summary` 重度使用       |
| `collaborationSummary`           | false | true  | true           | 多律师协作摘要类面板                                       |
| `complianceAuditExport`          | false | false | true           | `GET /api/audit/export?compliance=true` 合规模板           |
| `securitySbomPanel`              | false | false | true           | SBOM / 安全自检入口                                        |
| `qualityDashboardJsonExport`     | false | true  | true           | Quality dashboard JSON 导出                                |
| `customDeliverableSpec`          | false | true  | true           | 工作区 `lawmind/deliverables/*.json` 私有 spec             |
| `acceptancePackExport`           | false | true  | true           | 验收包 `.md` / `format=json`                               |
| `strictDangerousToolApproval`    | false | true  | true           | 危险工具须显式批准；`execute_workflow` 等长链路收紧        |

**人类可读标签**：`EDITION_LABELS` — `solo`→「独立律师版」、`firm`→「律所协作版」、`private_deploy`→「私有化部署版」。

**产品洞察采集**（另轨，不在 `features` 内）：`resolveProductInsightsCollection` — 显式 `policy.productInsightsCollection` 优先；否则 solo 默认 **`local-only`**，firm/private 默认 **`synced`**（见同文件注释）。

---

## 38. Records API

实现：`apps/lawmind-desktop/server/lawmind-server-route-records.ts`。均为 **GET**、JSON 响应 **`{ ok: true, ... }`**。

### 38.1 `GET /api/tasks`

| 查询参数          | 说明                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `q`               | 可选；在 **`taskId`、title、summary、kind`** 拼接串上做子串过滤（大小写不敏感） |
| `since` / `until` | 可选；解析为毫秒时间戳后，按任务 **`updatedAt`** 与 `Date.parse` 比较过滤       |

响应：`tasks: TaskSummaryRow[]`（`taskToSummary` 投影，含 `taskId`、`title`、`summary`、`kind`、`status`、`output`、`riskLevel`、`matterId`、`outputPath`、`assistantId`、`sessionId`、`createdAt`、`updatedAt`）。排序：**`updatedAt` 降序**。

### 38.2 `GET /api/sessions`

响应：`sessions[]`，每项含 `sessionId`、`matterId`、`assistantId`、`createdAt`、`updatedAt`、**`turnCount`**（`session.turns.length`）、可选 **`lastPreview`**（末条 user/assistant 摘要，≤120 字）。

**扩展（第十期）**：

- **`GET /api/sessions/:id/context-budget`**：`{ ok, used, effectiveLimit, level }`，`level` 为 `ok` | `warn` | `compact`；Compose 模型行旁圆环用量与此一致。
- **`POST /api/sessions/:id/compact`**：手动触发 `autoCompactSessionHistory`；响应含 `compacted`、`sessionSummaryPath`、`droppedMessageCount`、`messages`。可选 body `{ distill: true }`（圆环菜单「沉淀到知识库」）会提炼律师偏好建议与案件摘要写入记忆采纳队列。
- **`POST /api/sessions/:id/messages/mutate`**：按桌面气泡下标修改历史。`{ uiIndex, mode: "truncate" | "delete_pair" }` — `truncate` 从该条起截断（原地改问后重发）；`delete_pair` 删除提问及其紧随回答（保留其后轮次）。响应含更新后的 `messages`。
- **`POST /api/sessions/:id/abort`**：协作式停止进行中的对话轮（与 Compose「停止」配合；轮间检查，不强制中断单次模型 HTTP）。
- **`POST /api/sessions/:id/resume`**：从 `sessions/<id>.transcript.jsonl` 修复链并写回 `conversationHistory`；响应含 `messages`（简版）与 `pendingApprovals` 计数。

### 38.3 `GET /api/drafts`

响应：`drafts` 为 **`listDrafts`** 全量 `ArtifactDraft[]`（无分页；大工作区注意体积）。

### 38.4 `GET /api/history`

合并 **任务** 与 **草稿** 为时间线项（最多 **200** 条），按 **`updatedAt` 降序**（草稿项用 `createdAt` 作为其 `updatedAt` 参与排序字段见实现）。

每项：`kind`（`task`|`draft`）、`id`、`label`、`updatedAt`、`createdAt?`、`status?`、`outputPath?`、`matterId?`；任务另含 **`taskRecordKind`**。

---

## 39. 首跑向导 firstrun-wizard

**`POST /api/onboarding/firstrun-wizard`**（`lawmind-server-route-onboarding.ts`）

**Body**：`{ "matterId": "<合法 id>" }`（必填且通过 `isValidMatterId`）。

**前置条件**：`workspace/cases/<matterId>/` **目录必须已存在**，否则 **400** `matter not found in workspace`（向导应先建案再调此接口）。

**副作用**：`recordFirstrunWizardCompleted` 写入首跑/验收漏斗状态（含审计目录 `audit/` 下事件）；成功 **200** `{ ok: true }`，异常 **500**。

**actor**：`resolveDesktopActorId()` 记入审计。
