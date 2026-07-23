# LawMind 全面工程评审（含 UI）

> **状态**：工程评审（含落地修复）· 2026-07-12 基线；**2026-07-21 增量评审**（工作树：对话控制 / 在办·会议室 IA / Solo 首页移除）  
> **范围**：`src/lawmind/` + `apps/lawmind-desktop/`  
> **对照远景**：[`LAWMIND-OPTIMIZATION-BACKLOG.md`](LAWMIND-OPTIMIZATION-BACKLOG.md) §1（律师领导数字团队）  
> **可视化摘要**：可在 Cursor 中打开 Canvas [`lawmind-full-review.canvas.tsx`](/Users/shl/.cursor/projects/Users-shl-nvidia-LawMind-1/canvases/lawmind-full-review.canvas.tsx)  
> **持久全文**：本文

本文供后续 agent / 研发读取。**2026-07-21**：用户确认 UI 布局与风格满意；本轮以正确性 / 信任 / 集成为主，并落地 mutate·abort·distill 硬化（见附录）。

**2026-07-14 · P0/P1 落地摘要**：Canvas 中 P0/P1 产品断点（Agent Home / 在办、Header 入口、MainBody `agents` 分支、`styles/agent-fleet.css`、fleet route 单测 + `e2e/agent-fleet.spec.ts`）已接通。**P2/P3 + 残余 sprint**：orchestrator tool-round 续拆；双真相源；覆盖率地板。（团队可见性：在办三分区已收敛。）

---

## 0. 总评

| 综合         | 信任治理     | UI / IA     | 可维护性     |
| ------------ | ------------ | ----------- | ------------ |
| **4.35 / 5** | **4.45 / 5** | **4.4 / 5** | **3.75 / 5** |

LawMind 在「可审计的法律生产系统」水位上已经扎实：交付物本位、澄清/审核/验收门禁、角色委派、审核学习链路、Electron 本机安全壳都到位。相对用户口述的远景（律师=领导、多 agent 协作进化、知识沉淀），**产品信息架构仍偏「聊天 IDE」，但 Agent Home（在办 / 指挥台）已于 2026-07-12 接通**；工程侧最大债是 **巨型模块 + 覆盖率地板偏低**。

---

## 1. 分维评分

| 维度         | 评分 | 一句话                                                |
| ------------ | ---- | ----------------------------------------------------- |
| 产品愿景对齐 | 4.2  | 数字团队原语齐全；在办 / 指挥台已接通                 |
| 引擎架构     | 4.0  | 分层清晰；`turn-orchestrator` 过重                    |
| 信任 / 治理  | 4.5  | 门禁、审计、沙箱成熟                                  |
| 桌面 UI / UX | 3.6  | 工作台强；IA 偏聊天 IDE                               |
| 设计系统     | 4.1  | tokens + `lm-*` 一致；`styles/agent-fleet.css` 已落地 |
| 可维护性     | 3.3  | 巨型文件 + ~110 props 钻传                            |
| 测试 / CI    | 3.8  | 金路径强；覆盖率地板低                                |
| 安全桌面壳   | 4.4  | loopback + 隔离 preload                               |

---

## 2. 优势（证据向）

1. **交付物本位**：`DeliverableSpec`、验收门禁、reasoning gate、golden journeys — 不是纯聊天产品。
2. **多 agent 协作实质存在**：`core/role.ts`、`delegate_task` / `consult_assistant` / `request_review`、workflow executor、delegation registry。
3. **学习飞轮已接线**：审核标签 → `lawyer-profile-learning` / `playbook-learning` / golden 晋升（见 `learning/apply-review-labels.ts`）。
4. **信任默认值**：tool-pipeline（审批、澄清、沙箱、审计）、dangerous-tool-policy、edition 严格模式。
5. **桌面交付表面成熟**：ReviewWorkbench、MatterWorkbench、澄清条、requires-action、场景空态、设计令牌与 `docs/LAWMIND-DESKTOP-UI.md`。
6. **Electron 安全意识强**：`127.0.0.1`、`contextIsolation`、preload 窄桥、路径穿越检查、Bearer（见 `SECURITY.md`）。
7. **质量栈完整**：Vitest 多层、release-readiness、Playwright PR 套件、nightly 严格 benchmark、platform contracts CI。

---

## 3. 短板与风险

### 3.1 产品 / UI（对远景最伤）

| 问题                          | 证据                                                                                                                                            | 影响                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ~~指挥台 orphan~~ **已接通**  | Header「在办」tab（`LawmindAppHeader`）；MainBody `agents` → `AgentFleetView`；`styles/agent-fleet.css`；`e2e/agent-fleet.spec.ts` + route 单测 | 2026-07-12 落地；团队可见性仍待收敛 |
| ~~团队可见性分裂~~ **已收敛** | 在办常驻分区：待拍板 / 交出去的活 / 按流程办；设置「团队工作流」仅摘要入口                                                                      | 2026-07-23 落地                     |
| 案件舱发现性                  | 顶栏案件名可点进工作台；侧栏仍为主入口                                                                                                          | 已缓解                              |
| 标签漂移                      | Header「协作」vs desk「工作流」                                                                                                                 | 心智摩擦                            |
| 巨型 UI 模块                  | `lawmind-chat-shell.tsx` ~637；`FileWorkbenchView` ~1052（dialogs 已外提）；MainBody 分支用 pick\*                                              | 持续下降                            |

### 3.2 引擎 / 架构

| 问题                  | 证据                                                           | 严重度                    |
| --------------------- | -------------------------------------------------------------- | ------------------------- |
| Orchestrator 神模块   | ~~896~~ → ~601（`finalize` + `prompt` 已拆）+ 专用 prompt 单测 | Medium（续拆 tool-round） |
| 双真相源              | matter JSON vs Markdown；tasks/drafts vs deliverables          | High                      |
| 协作环依赖            | `message-bus` → `createLawMindAgent` ↔ `agent/index`           | High                      |
| 治理元数据手维护      | `governance.ts` 列表易与工具注册漂移                           | High                      |
| 双 adoption 路径      | `learning/suggestion-queue` vs `memory/adoption-service`       | Medium                    |
| 无 agent 特化指标     | backlog §1.3 A-4 未实现                                        | Medium                    |
| ~46% 模块无同目录测试 | 估算约 118/254                                                 | High                      |
| sync fs 热路径        | session / delegation / tasks                                   | Medium                    |

### 3.3 质量 / 文档漂移

- 覆盖率地板约 **43%**（statements ~42.5% ratchet）。
- Agent Fleet：route 单测（`lawmind-server-route-agent-fleet.test.ts`）、`e2e/agent-fleet.spec.ts` 已存在；renderer 直测仍薄；HTTP smoke 已含 deep 探测。
- `planning.ts` / `drafting.ts` / `researching.ts`、`adapters/matter-storage/`、若干 application write services 缺直测。
- `approval-queue.spec.ts` 未进 PR E2E 套件。
- `GOALS.md` / USER-MANUAL / ARCHITECTURE 尚未完全同步在办 / 指挥台；OPTIMIZATION-BACKLOG 正文 banner 已与附录 A 部分 reconciled（2026-07-14）。

### 3.4 安全（非 blocker，需跟进）

- Dev：`sandbox: false`、CSP `unsafe-eval`。
- Fleet transcript：按 sessionId 返回消息切片，缺专用 scope 回归测。
- Security audit / CodeQL：非阻塞或仅手动。

---

## 4. UI 信息架构建议（目标态）

```
指挥层：指挥台（roster + jobs） + 待办中心（审批 / 澄清）
工作层：对话（澄清 / 委派） + 案件工作台 + 材料
交付层：审核台
```

今日缺口：**指挥层入口已接通**（在办 tab + 三分区）。路由 defaults / 内测指标 / 团队视图 e2e 已补；R-P0-3 orchestrator 续拆已落地。R-P1-6 Wave-1（FTS hybrid 个人知识）与 R-P2-2 覆盖率地板本轮已抬升；embedding / 专用知识库 UI 仍属 Wave-2。

设计系统：保持现有 brass / `lm-*`；`styles/agent-fleet.css` 已同步 `styles.css`；`LAWMIND-DESKTOP-UI.md` 仍可补在办说明。

无障碍：已有 skip-nav、aria-current、separator；Fleet tabs 需 `aria-controls` / tabpanel；加载态补 `aria-busy`。

---

## 5. 优化建议 backlog（评审增量）

与 [`LAWMIND-OPTIMIZATION-BACKLOG.md`](LAWMIND-OPTIMIZATION-BACKLOG.md) 互补：那边偏产品远景；这边偏**工程债 + UI 接通**。冲突时以用户口述 §1 远景为准。

### P0

| ID     | 项                                        | 落点提示                                                                                |
| ------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| R-P0-1 | **接通指挥台**                            | Header tab、MainBody `agents` 分支、spawn 接 shell、fleet CSS                           |
| R-P0-2 | **Fleet 质量门禁**                        | `lawmind-server-route-agent-fleet.test.ts`、`e2e/agent-fleet.spec.ts` 进 PR、smoke 深检 |
| R-P0-3 | ~~**拆分 turn-orchestrator**~~ **已续拆** | prompt / tool-round / finalizer / shortcuts / model-loop + 单测（主文件 ~368 行）       |
| R-P0-4 | **权威检索 + 引用 UI**                    | 对齐 OPTIMIZATION P0-1/P0-2                                                             |
| R-P0-5 | **治理漂移 CI**                           | 注册工具 ⊆ governance 元数据                                                            |

### P1

| ID     | 项                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------- |
| R-P1-1 | 进化飞轮产品化 + 合并双 adoption                                                                   |
| R-P1-2 | ~~削减 MainBody props；拆 `lawmind-chat-shell`~~ **本轮落地**（toolbar + pick\* 分支；shell ~637） |
| R-P1-3 | `approval-queue` 进 PR E2E                                                                         |
| R-P1-4 | ~~matter-storage + 写侧服务单测~~ **已落地**（adapter + queue-write smoke；W3 matter-write 既有）  |
| R-P1-5 | 案件工作台 Header 入口 + 审查矩阵                                                                  |
| R-P1-6 | ~~个人知识库 hybrid 检索~~ **Wave-1 已落地**（FTS trigram + 加权；无 embedding）                   |
| R-P1-7 | 打断 message-bus 环依赖 + bus 单测                                                                 |
| R-P1-8 | ~~engine planning/drafting/researching 冒烟测~~ **已落地**                                         |

### P2

| ID     | 项                                                                     |
| ------ | ---------------------------------------------------------------------- |
| R-P2-1 | Agent 特化指标（首过率、改写率）                                       |
| R-P2-2 | ~~覆盖率地板 +2–3pt~~ **已抬升**（ratchet statements ~44.3%）          |
| R-P2-3 | 文档同步：GOALS、ARCHITECTURE、USER-MANUAL、COLLABORATION-UI-API-MAP   |
| R-P2-4 | FileWorkbench 拆分（dialogs 已拆）；命令面板升级为全应用「律师命令」续 |
| R-P2-5 | sync→async I/O 或写队列；hash-chain 并发属性测                         |

---

## 6. 建议落地顺序（若开工）

1. **T0**：R-P0-1 + R-P0-2（指挥台可点、可测）— 立刻服务远景叙事
2. **T1**：R-P0-4（研究员可信）
3. **T2**：R-P0-3 + R-P0-5（可安全改 agent）
4. **T3**：R-P1-\*（进化、IA、知识库、写路径测试）
5. **T4**：R-P2-\*

---

## 7. 维护

- 实现某项后：在本节勾选或移入附录「已落地」。
- 与 OPTIMIZATION-BACKLOG 重复项：保留两边交叉链接，避免双源细节分叉。
- 下次全量评审：更新评分表与证据日期。

### 附录 · 已落地

| 项                                                   | 日期       | 说明                                                                                                                                                                                                  |
| ---------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-P0-1 接通指挥台                                    | 2026-07-12 | Header「指挥台」+ MainBody agents + CSS + spawn preset                                                                                                                                                |
| R-P0-2 Fleet 测试门禁                                | 2026-07-12 | route 单测、e2e/agent-fleet、HTTP smoke deep、approval-queue 进 PR                                                                                                                                    |
| R-P0-4 检索拒答 + 未锚定引用                         | 2026-07-12 | search_statute refusalRequired；citation unanchored banner                                                                                                                                            |
| R-P0-5 治理漂移                                      | 2026-07-12 | governance-drift.test.ts                                                                                                                                                                              |
| R-P1-1 进化/双队列                                   | 2026-07-12 | adopt 同步 adoption-service；特化指标 agent-specialization                                                                                                                                            |
| 团队成长 Wave A                                      | 2026-07-21 | 签批 product-metrics；modified→pending adoption；growth API；设置岗位表                                                                                                                               |
| 团队成长 Wave B                                      | 2026-07-21 | routing defaults；forcePeerReview；contract-review 多步种子；岗位页互审开关                                                                                                                           |
| 团队成长 Wave C                                      | 2026-07-22 | 在办团队聚合视图；待教深链；修订完成/合同修订包→adoption                                                                                                                                              |
| 团队成长 Wave D                                      | 2026-07-22 | 专案组绑助手；team-roster；本案团队条；协作完成角标；T1.4 改写幅度                                                                                                                                    |
| 内测指标表                                           | 2026-07-22 | `team-growth-dashboard` + `/api/metrics/team-growth` + Doctor 基线                                                                                                                                    |
| 合同修订积累信任                                     | 2026-07-23 | 审核通过路径禁静默 profile；keyMods → pending；内测指标 e2e/mock                                                                                                                                      |
| 团队可见性收敛                                       | 2026-07-23 | 在办常驻「待拍板 / 交出去的活 / 按流程办」；设置协作入口改待拍板                                                                                                                                      |
| R-P0-3 orchestrator 续拆                             | 2026-07-23 | shortcuts（intake/auto-wf）+ model-loop；主文件 ~368 行                                                                                                                                               |
| 路由 defaults 设置 UI                                | 2026-07-23 | Roles 页编辑 byKind/byDeliverable + 保存；token/`--lm-fg`；在办团队 e2e                                                                                                                               |
| 审查加固（Wave D 后）                                | 2026-07-22 | distill 禁静默写 session-summary；在办深链勿误选/尊重 matter 筛选；待拍板默认选首项                                                                                                                   |
| 记忆采纳落盘                                         | 2026-07-22 | `adoption-apply.ts`：Inspector adopt 写 session-summary / CASE / profile                                                                                                                              |
| 模型能力包络（E1/A2/C2/A11）                         | 2026-07-23 | `capability-envelope`；maxTokens/预算跟 catalog；澄清放行 research；ContextPlan 接线；见 `LAWMIND-MODEL-CAPABILITY-REVIEW.md` §8                                                                      |
| 模型能力 PR3（A1/A7/F1）                             | 2026-07-23 | compact 丢弃段提取式蒸馏回灌 + `compact-digest.md`；小文本文件引用自动嵌入正文                                                                                                                        |
| 模型能力续（C10/A4/会议室）                          | 2026-07-23 | analyze/read_project 分页；召回 8×4k；会议室 agenda 嵌小文本                                                                                                                                          |
| 模型能力续 2（C7/D7/D4）                             | 2026-07-23 | 未知工具参剥离；Solo 审查并行；citation 仅挡导出文案                                                                                                                                                  |
| 模型能力续 3（D5/E5）                                | 2026-07-23 | 模型调用 AbortSignal；检索 JSON 失败 markdown 降级                                                                                                                                                    |
| R-P1-3 批准队列 E2E                                  | 2026-07-12 | approval-queue.spec 纳入 e2e:pr                                                                                                                                                                       |
| R-P1-5 案件工作台入口                                | 2026-07-12 | Header「案件工作台」按钮                                                                                                                                                                              |
| R-P1-7 message-bus 环依赖                            | 2026-07-12 | agent-factory.ts                                                                                                                                                                                      |
| Action Hub 队列页                                    | 2026-07-12 | 嵌入 LawmindApprovalQueue                                                                                                                                                                             |
| R-P1-8 engine smoke（planning/drafting/researching） | 2026-07-20 | `planning.test.ts` + 新增 `drafting.test.ts` / `researching.test.ts`                                                                                                                                  |
| Fleet 详情 tabs a11y                                 | 2026-07-20 | `aria-controls` / `tabpanel` / `aria-busy`（`LawmindAgentFleetPanel`）                                                                                                                                |
| 文书台 popout 同步                                   | 2026-07-20 | `sync-request` + live 优先于 saved poll（`lawmind-popout-route`）                                                                                                                                     |
| 临时讨论 workspace 存储                              | 2026-07-20 | `meetings/adhoc/` + 遗留迁移；MeetingView 不再 create matter                                                                                                                                          |
| R-P1-2 消息列拆分                                    | 2026-07-20 | `lawmind-chat-messages-column.tsx`（chat-shell ~1092→~830）                                                                                                                                           |
| R-P1-2 compose chrome                                | 2026-07-20 | `lawmind-chat-compose-chrome.tsx`（shell ~830→~768）                                                                                                                                                  |
| 会议室议程材料                                       | 2026-07-20 | `buildMeetingAgenda` + pins → `meetingAgenda`                                                                                                                                                         |
| R-P1-4 matter-storage 适配器冒烟                     | 2026-07-20 | `adapters/matter-storage/index.test.ts`（服务层已有 W3）                                                                                                                                              |
| R-P1-2 toolbar + MainBody pick\*                     | 2026-07-20 | compose-toolbar；`pickMainBodyBranchProps`；MainBody ~196 行                                                                                                                                          |
| 会议室材料选择器                                     | 2026-07-20 | `添加材料` + ComposeContextPicker 搜索；pins 双向增删                                                                                                                                                 |
| R-P1-4 queue-write smoke                             | 2026-07-20 | `queue-write-service.test.ts`                                                                                                                                                                         |
| R-P2-4 FileWorkbench dialogs                         | 2026-07-20 | `FileWorkbenchDialogs.tsx`（View ~1183→~1052）                                                                                                                                                        |
| 侧栏空态文案                                         | 2026-07-20 | 无材料树时不再引导右键「案件材料」                                                                                                                                                                    |
| 会议室材料 picker 仅文件                             | 2026-07-20 | `categories: ["files"]`；compose-context 单测                                                                                                                                                         |
| MainBody pick\* 单测                                 | 2026-07-20 | `pickMainBodyBranchProps.test.ts`                                                                                                                                                                     |
| memory case-workspace 下沉                           | 2026-07-20 | 打破 `index` ↔ `case-writes` 环（FUTURE §6）                                                                                                                                                          |
| 无 FS 建案 CTA                                       | 2026-07-20 | 侧栏「新建」+ 空态按钮；对话空态按 apiBase 解耦                                                                                                                                                       |
| Automations 空案件文案                               | 2026-07-20 | 不再写「侧栏新建案件」死路径                                                                                                                                                                          |
| R-P2-4 context menu                                  | 2026-07-20 | `FileWorkbenchContextMenu.tsx`（View ~1052→~856）+ a11y menu roles                                                                                                                                    |
| FileWorkbench / pickWorkspace 缝测                   | 2026-07-20 | Dialogs + ContextMenu + `pickWorkspaceMainPaneProps` 单测                                                                                                                                             |
| 权威外库 API                                         | —          | 仍依赖外接；本机启发式拒答已落地                                                                                                                                                                      |
| UI 半暴露接线（专案组/compact/DEFERRED）             | 2026-07-21 | playbook/cancel/parallel；compose compact；记忆 suggest / finalize / desk-settings / profile-sections / triage rules / quality JSON；见 `LAWMIND-DEFERRED.md`。Solo「驾驶舱」首页已移除（默认对话）。 |
| 文书台 / 在办职责拆分                                | 2026-07-21 | 文书台 writing 条去掉通过·驳回·需修改；在办待审文书可直接批复；「回到在办签批」；高级区兜底签批                                                                                                       |
| 改拟稿收窄（避与文书台重合）                         | 2026-07-21 | `content` 文书写入不再弹窗改全文；「改参数」+ 引导文书台；短字段/邮件 body 仍可改                                                                                                                     |
| 澄清 P0–P2（在办表 / 弱引导 / 材料）                 | 2026-07-21 | 在办表格提交 resume；对话 hint/compact；file 路径编码；inputType 控件                                                                                                                                 |
| 对话 Cursor 式控制                                   | 2026-07-21 | 气泡修改/删除（delete_pair）；Stop→abort API；Compose「沉淀学习」compact+distill→adoption                                                                                                             |
| 在办 IA：拍板台左栏                                  | 2026-07-21 | 隐藏案件侧栏；队列分组+案件筛选为页内左栏（对齐律师「待我拍板」任务）                                                                                                                                 |
| 会议室 IA：场次左栏                                  | 2026-07-21 | 临时讨论/案件会议分组为页内左栏（`meeting-workbench.css`）                                                                                                                                            |
| 会议室 ↔ 对话同构左栏 + 打断                         | 2026-07-23 | 共用全局材料树/会话；终止发言 abort；live sticky runbar；仅材料可开场；记录区加高                                                                                                                     |
| 会议室材料栏 + 设置精简                              | 2026-07-21 | （已演进）页内材料 portal 取消；改拖全局左栏进议题                                                                                                                                                    |
| Review hardening（mutate/abort/distill）             | 2026-07-21 | 删末条助手清 pending；SSE close 不再误 abort 下一轮；auto-wf 前/后查 abort；文书 write 需 path；distill 去重+仅 dropped；mutate 409；lease_term textarea；e2e mock stub                               |
| R-P2-2 覆盖率地板                                    | 2026-07-23 | platform/fleet/schema 补测；`coverage-baseline.json` statements 42.53→~44.3                                                                                                                           |
| R-P1-6 个人知识库 Wave-1                             | 2026-07-23 | `knowledge_fts`（trigram）+ `searchPersonalKnowledge`；接线 tool/recall/HTTP；假命中与 Recall@K 验收测                                                                                                |
