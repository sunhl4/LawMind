# LawMind 协作：界面与本地 API 对照

> **2026-07-19**：顶栏「协作」全页与侧栏协作折叠块已移除。协作能力并入顶栏 **「在办」**（`mainView === "agents"`）子 Tab；设置页仅保留摘要 + 深链。

本文档把 **在办 · 交出去的活 / 按流程办**、**设置 → 团队工作流（摘要）** 中的可见能力与底层 HTTP 路由对应起来。服务器实现：`apps/lawmind-desktop/server/lawmind-server-route-collaboration.ts`、`lawmind-server-route-jobs.ts`。

**环境开关**：`LAWMIND_ENABLE_COLLABORATION=false` 时，多助手协作在服务端关闭；`GET /api/collaboration/summary` 仍会说明状态，但 **`POST /api/collaboration/workflow-run` 返回 503**（`collaboration_disabled`）。

---

## 1. 产品表面（当前 IA）

| 用户说法          | 代码                              | 组件                                                                             |
| ----------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| 在办 · 进行中     | `agents` + `AgentsDeskTab=active` | `AgentFleetView` → `LawmindAgentFleetPanel`                                      |
| 在办 · 交出去的活 | `agents` + `delegations`          | `LawmindCollaborationDesk`（overview）                                           |
| 在办 · 按流程办   | `agents` + `workflows`            | `LawmindCollaborationDesk` → `LawmindSettingsCollaboration`（`workflowsColumn`） |
| 设置 · 团队工作流 | settings section `collaboration`  | `LawmindSettingsCollaborationBrief` → 按钮「在在办中打开按流程办」               |
| 待我拍板          | 跳转「在办」+ needs-decision 焦点 | 仅 awaiting\_\* 决策卡（不再开 Action Hub 模态）                                 |
| 会议室            | `mainView === "meeting"`          | `MeetingView` → `MatterTeamMeetingPanel`（可选案件 / 临时讨论）                  |

壳层入口：`lawmind-app-root.tsx` / `LawmindAppRootView.tsx`（不再使用历史 `App.tsx` 顶栏协作路由）。

---

## 2. 数据从哪来（壳层状态）

| 状态                     | 刷新方式                 | HTTP                                              |
| ------------------------ | ------------------------ | ------------------------------------------------- |
| `delegations`            | `refreshCollaboration()` | `GET /api/delegations`                            |
| `collabEvents`           | 同上                     | `GET /api/collaboration-events`（`?since=` 可选） |
| 协作开关 / 委派数 / 提示 | 设置与 desk              | `GET /api/collaboration/summary`                  |

桌面列表刷新通常拉全量再截断；查询参数 `status`、`assistantId` 服务端支持但 UI 未暴露。

---

## 3. 在办 · 按流程办（主路径）

权威 UI：`LawmindSettingsCollaboration`（`deskLayout="workflowsColumn"`），挂在 `LawmindCollaborationDesk`。

| UI 元素        | HTTP / 行为                                                                |
| -------------- | -------------------------------------------------------------------------- |
| 工作流模板下拉 | `GET /api/collaboration/workflow-templates`                                |
| 运行所选模板   | `POST /api/collaboration/workflow-run`（`async: true`）→ **202** + `jobId` |
| 取消后台任务   | `POST /api/jobs/:id/cancel`                                                |
| 进度           | 优先 `GET /api/jobs/:id/stream`（SSE）；失败则轮询 `GET /api/jobs/:id`     |
| 近期任务       | `GET /api/jobs?limit=…`                                                    |

对话空态「按流程办」、舰队 Spawn「按流程办」均深链到本 Tab（`setAgentsDeskTab("workflows"); setMainView("agents")`）。

---

## 4. 在办 · 交出去的活

| UI                           | API                                                               |
| ---------------------------- | ----------------------------------------------------------------- |
| 委派卡片列表                 | `GET /api/delegations`                                            |
| 撤销委派                     | `DELETE /api/delegations/:id`（desk 已接线）                      |
| 打开目标对话                 | 壳层切 `workspace` + 目标会话                                     |
| 协作动态 / gate 历史（高级） | `GET /api/collaboration-events`、`GET /api/platform/gate-history` |

---

## 5. 设置 · 团队工作流（摘要）

仅显示开关与委派摘要；主按钮打开 **在办 · 按流程办**（关闭设置）。岗位与互审在 **设置 → 助手与岗位**。

---

## 6. 通知回流

工作流完成类通知若带历史 reason `open_settings_collaboration`，渲染进程关闭设置并切到 **在办**（workflows / delegations 依接线），不再打开已删除的顶栏协作页。

---

## 7. 相关文件

- `apps/lawmind-desktop/src/renderer/app/AgentFleetView.tsx`
- `apps/lawmind-desktop/src/renderer/LawmindCollaborationDesk.tsx`
- `apps/lawmind-desktop/src/renderer/LawmindSettingsCollaboration.tsx`
- `apps/lawmind-desktop/src/renderer/lawmind-agents-desk.ts`
- `docs/LAWMIND-DESKTOP-UI.md` §1.1 / §9
