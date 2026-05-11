# LawMind 协作：界面与本地 API 对照

本文档把 **顶栏「协作」全页**、**侧栏「协作」折叠块**、**设置 → 协作与多智能体流程（摘要入口）** 中的可见能力与底层 HTTP 路由对应起来，便于排障与二次开发。服务器实现入口：`apps/lawmind-desktop/server/lawmind-server-route-collaboration.ts`、`lawmind-server-route-jobs.ts`。

**环境开关**：`LAWMIND_ENABLE_COLLABORATION=false` 时，多助手协作在服务端关闭；`GET /api/collaboration/summary` 仍会说明状态，但 **`POST /api/collaboration/workflow-run` 返回 503**（`collaboration_disabled`）。

---

## 1. 数据从哪来（壳层状态）

桌面壳在 `lawmind-app-shell-domains.ts` 中维护：

| 状态           | 刷新方式                           | HTTP                                                 |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| `delegations`  | 启动快照、`refreshCollaboration()` | `GET /api/delegations`（`loadCollaborationPayload`） |
| `collabEvents` | 同上                               | `GET /api/collaboration-events`（`?since=` 可选）    |

说明：`/api/delegations` 支持查询参数 `status`、`assistantId`（服务端过滤）；当前桌面列表刷新**未**在 UI 上暴露这些参数，用的是全量列表再截断。

「协作已开启 / 委派数 / 提示文案」来自 **`GET /api/collaboration/summary`**（`loadSettingsCollaborationState` / `loadCollaborationSummaryPayload`），与侧栏列表数据源**独立**：summary 里还带一段 **精简版**最近委派与 `recentCollaborationEvents`，但桌面 UI 主要只用 `collaborationEnabled`、`collaborationHint`、`delegationCount`。

---

## 2. 顶栏「协作」全页（`App.tsx`）

主区分为两块（同一滚动容器内）：

### 2.1 协作枢纽（`LawmindSettingsCollaboration`，根节点 `id="lawmind-collaboration-hub"`）

| UI 元素                                | 作用                                      | HTTP / 行为                                                                                                                                        |
| -------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **多智能体协作** 药丸（已开启/已关闭） | 反映环境与服务端协作开关                  | `GET /api/collaboration/summary` → `collaborationEnabled`                                                                                          |
| **当前委派数**                         | 摘要数字                                  | 同上 → `delegationCount`                                                                                                                           |
| 灰色说明 callout                       | 人类可读提示                              | 同上 → `collaborationHint`                                                                                                                         |
| 加载 **工作流模板** 下拉               | 列出 `workspace/lawmind/workflows/*.json` | `GET /api/collaboration/workflow-templates`（仅当 `collaborationEnabled`）                                                                         |
| **运行所选模板**                       | 异步团队工作流                            | `POST /api/collaboration/workflow-run`，body 含 `templateId`、`matterId?`、`assistantId?`、`async: true`、`idempotencyKey`；成功 **202** → `jobId` |
| **取消后台任务**                       | 取消当前运行中的 Job                      | `POST /api/jobs/:id/cancel`                                                                                                                        |
| **测试系统通知**                       | 验证 Electron 通知桥                      | 仅 `window.lawmindDesktop.showNotification` IPC，**无** HTTP                                                                                       |
| 运行中 **进度** / **复制 ID**          | 跟踪当前 `jobId`                          | 优先 **`GET /api/jobs/:id/stream`（SSE）**；失败则轮询 **`GET /api/jobs/:id`**                                                                     |
| **近期任务** 列表                      | 后台 Job 一览                             | **`GET /api/jobs?limit=8`**；对非当前、仍处于 `queued`/`running` 的条目最多 **2 路**并行 SSE，并定时对账刷新                                       |
| **运行输出** `<pre>`                   | 终态报告或错误 JSON                       | 来自 `job` 快照中的 `result.report` 或轮询/SSE 合并结果                                                                                            |

同步工作流（`async` 非 true）在路由上仍支持 **200** + `report`，桌面 UI **始终** 发 `async: true`。

**通知点击**：工作流完成类通知若带 `openSettingsOnClick`，Electron 仍发送 `reason: "open_settings_collaboration"`，渲染进程会 **关闭设置、切到顶栏「协作」** 并 `scrollIntoView` 至 `lawmind-collaboration-hub`（历史 IPC 名称未改）。

**委派详情 / 撤销**：服务端另有 `GET /api/delegations/:id`、`DELETE /api/delegations/:id`（取消委派）；当前 **无** 桌面按钮绑定，仅能通过 API 或后续产品补全。

### 2.2 委派与协作动态（`LawmindCollabPanel`）

| UI                  | 作用                                 | 调用的 API                                                            |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| 子页签 **委派任务** | 显示 `delegations` 列表              | 间接：`GET /api/delegations`（随 `refreshCollaboration` / bootstrap） |
| 子页签 **协作动态** | 最近约 30 条 **倒序** `collabEvents` | 间接：`GET /api/collaboration-events`                                 |

---

## 3. 侧栏 `LawmindSidebar`（`variant` 非 `project-only` 时）

折叠区块 **协作** 仅含 **`LawmindCollabPanel`**（委派 + 协作动态），数据源：`delegations` / `collabEvents`。与工作流运行控制台一致，侧栏为紧凑只读视图。

---

## 4. 设置 →「协作与多智能体流程」（`LawmindSettingsCollaborationBrief`）

设置弹窗内**不再**挂载完整工作流面板，仅保留：

| UI 元素                                                | 作用                                          |
| ------------------------------------------------------ | --------------------------------------------- |
| 与 summary 同步的 **协作开关** / **委派数** / **hint** | 同上，`GET /api/collaboration/summary`        |
| **打开协作页**                                         | 关闭设置并切到 `mainView === "collaboration"` |
| 文档链接                                               | 集成说明、`LAWMIND-COLLABORATION-UI-API-MAP`  |

---

## 5. 案件工作台「会议室」（matter-scoped）

| 能力               | HTTP / 持久化                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 加载时间线         | **`GET /api/matters/team-meeting?matterId=`**（`limit`、`skipFromEnd`；响应 **`total`** + **`lines`**）                                                                                                                                            |
| 发言（多助手轮流） | **`POST /api/chat`**，`meetingMode: true`，**必须**带 `matterId`；可选 **`meetingAgenda`**（仅注入指令，不写 JSONL）；`assistantId` / `sessionId` 对应界面 **「谁来答」** 所选助手（与主对话侧栏会话隔离，桌面用 `sessionStorage` 按 matter 保存） |
| 磁盘               | `workspace/cases/<matterId>/team-meeting.jsonl`（JSONL：`user` / `assistant` / `system`）                                                                                                                                                          |
| 委派系统条         | 引擎 `delegate_task` 在创建 / 完成 / 失败时追加 **`system`** 行（需委派带 `matter_id` 或上下文 `matterId`）                                                                                                                                        |

与顶栏「协作」的关系：**会议室** = 本案讨论线程；**协作页** = 全 workspace 委派列表与工作流控制台。固定流水线仍以 **`POST /api/collaboration/workflow-run`** 为准。

---

## 6. 与审计、持久化的关系（只读说明）

- 协作事件可由工作区审计管道写入（如 `collaboration-audit.jsonl`，参见 `LAWMIND-PRIVATE-DEPLOY`、`LAWMIND-PROJECT-MEMORY`）。
- 异步工作流 Job 持久化在 `workspace/lawmind/jobs/*.json`（进程重启等行为见 `GOALS.md` Phase 7）。

---

## 7. 相关代码索引

| 区域                              | 路径                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| 协作全页下半：委派 / 时间线       | `apps/lawmind-desktop/src/renderer/lawmind-records-collab-panels.tsx`                               |
| 协作全页上半：摘要 + 工作流 + Job | `apps/lawmind-desktop/src/renderer/LawmindSettingsCollaboration.tsx`                                |
| 案件工作台会议室 UI               | `apps/lawmind-desktop/src/renderer/MatterTeamMeetingPanel.tsx`、`MatterWorkbench.tsx`               |
| 会议室 JSONL 与 transcript        | `src/lawmind/cases/team-meeting.ts`                                                                 |
| 设置内摘要入口                    | 同文件 `LawmindSettingsCollaborationBrief`；`lawmind-settings-shell.tsx`                            |
| 壳：委派与事件状态                | `apps/lawmind-desktop/src/renderer/lawmind-app-shell-domains.ts`                                    |
| API 封装                          | `apps/lawmind-desktop/src/renderer/lawmind-app-data.ts`                                             |
| 协作 + Job 路由                   | `apps/lawmind-desktop/server/lawmind-server-route-collaboration.ts`、`lawmind-server-route-jobs.ts` |
| Matters + Chat 路由               | `lawmind-server-route-matters.ts`、`lawmind-server-route-chat.ts`                                   |

---

## 8. 产品与后续（非实现承诺）

- **顶栏「协作」** 同时承载 **工作流控制台** 与 **只读委派/动态**；设置内仅存 **摘要 + 跳转**。
- 若需侧栏直接触发工作流，可再讨论是否复用枢纽组件的瘦身在 `LawmindSidebar`（当前刻意保持侧栏只读）。
