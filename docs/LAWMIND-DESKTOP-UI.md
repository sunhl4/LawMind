# LawMind 桌面端 UI 设计约定

本文档描述 **LawMind Desktop**（`apps/lawmind-desktop`）渲染层的视觉与交互基线，便于后续功能与「高智能化」体验迭代时**不重复造轮子、不破坏一致性**。

相关文档：[使用手册（完整版）](/LAWMIND-USER-MANUAL)（桌面优先）、[LawMind 架构](/LAWMIND-ARCHITECTURE)（§十一 b 桌面应用）、[LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY)、[LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY)（产品级智能化与记忆图）。

---

## 1) 源文件

| 区域                | 路径                                                                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计令牌 + 全局样式 | `apps/lawmind-desktop/src/renderer/styles.css`；模块化源文件见 `styles/tokens.css`、`styles/*.css` 与 `styles/README.md`                                               |
| 分栏与拖拽尺寸      | `apps/lawmind-desktop/src/renderer/lawmind-panel-layout.ts`、`use-pane-resize.ts`（若存在）                                                                            |
| 主壳                | `lawmind-app-root.tsx`、`app/LawmindAppRootView.tsx`、`app/LawmindAppSidebar.tsx`、`app/LawmindAppHeader.tsx`、`lawmind-chat-shell.tsx`                                |
| 模态/向导           | `app/LawmindAppOverlays.tsx`、`app/LawmindAppRootDialogs.tsx`、`LawmindApiSetupWizard.tsx`、`LawmindFirstRunDialog.tsx`、`lawmind-settings-shell.tsx`、`HelpPanel.tsx` |
| 业务工作台          | `app/MatterView.tsx`、`ReviewWorkbench.tsx`、`FileWorkbench.tsx`、`app/LawmindFileWorkbenchHost.tsx`                                                                   |
| Electron 主进程     | `apps/lawmind-desktop/electron/main.mjs`（窗口、菜单、`openExternal`、新窗口外开）                                                                                     |
| Preload             | `apps/lawmind-desktop/electron/preload.cjs`                                                                                                                            |

**原则**：语义色与间距优先用 **CSS 变量** 或 **已有 `lm-*` 类**；仅**运行时几何**（分栏宽度、菜单位置、树节点缩进等）使用内联 `style`。

### 1.1) 产品信息架构（2026-07-13，Wave A/B 2026-07-19 修订；E11 Home 2026-07-20）

- **默认入口**：`home` 今日工作台（待拍板 / 分诊与期限 / 专案组）；设置「经典布局」可改回打开即 `workspace` 对话。
- **一级顶栏**：「首页」「对话」「在办」（条件出现：案件 chip / 文书台场景标签）。「会议室」「自动办件」在 Header「会议室·办件」菜单（`lm-nav-more`）。
- **状态层**：`agents` 对用户显示为「在办」；汇总待决定、进行中、待签批，不作为冷启动首页。
- **调度层**：`automations` 对用户显示为「自动办件」（定时/邮件触发）；从「会议室·办件」进入；与对话内「下达」区分。
- **案件层**：案件是材料、任务、期限、交付物和保密等级的长期真相源。
- **交付层**：`review` 对用户显示为「文书台」，不再是顶栏对等 Tab；由「进入文书台」场景按钮打开。
- **决策队列**：侧栏底部「待我拍板」为唯一常驻入口；顶栏角标仅在侧栏折叠或文书台（无侧栏）时出现。实现为进入「在办」并开启 **needs-decision 焦点**（仅 `awaiting_*` 卡）；**无独立 Action Hub 模态**；不再在对话输入区挂「待你处理」条。
- **禁止模式开关**：不增加 IDE/Agent 或默认首页设置；Solo/Firm 只渐进改变信息密度（Solo 设置「高级」默认折叠）。

### 1.2) Skills S1 信任闭环（2026-07-20）

- **分诊（E1）**：交办 Intake 两步流 — 预览 GREEN/YELLOW/RED → 确认后再重执行；样式 `.lm-triage-tier*`。
- **必核清单（E6）**：文书台右侧「律师必核清单」；必核未齐时「通过」禁用，服务端 approve 422 `checklist_incomplete`。
- **引用模式（E4）**：Banner 三态（已核实 / 待核实 / 模型记忆）；`citationMode=grounded` 可拦截严格导出。
- **危险工具（E10-lite）**：审批卡展示拟执行参数 diff（`.lm-tool-args-diff`）；Doctor「信任闭环」行显示 citationMode / 分诊规则 / 指标。

### 1.3) Skills S2 审查专案组（2026-07-20）

- **文书台 Sticky**：`LawmindReviewCampaignPanel` 展示 Safety Score、五角色卡、谈判优先级与 Markdown 报告预览（`.lm-review-campaign*`）。
- **在办入口**：Fleet 快捷跳转「用审查专案组」→ 打开文书台（有待审稿时）。
- **API**：`/api/fleet-playbooks`、`/api/review-campaigns`（创建/取消/角色重跑/报告）；Solo 串行启发式，Score 可复现。

---

## 2) 设计令牌（`:root` 摘要）

以下为当前主色系与语义色命名（**请勿使用未定义变量**，例如历史上曾误用 `--danger`；错误态统一为 `--error`）。

- **面与边**：`--bg`、`--side-bg`、`--surface` / `--surface-2`；`--border` / `--border-md`
- **文字**：`--text`、`--text-2`、`--muted`
- **主强调（暖铜）**：`--accent`、`--accent-dim`、`--accent-border`、`--grad-brand`
- **语义色**：`--ok` / `--warn` / `--error` / `--info` 及对应的 `-dim`、`-border`
- **圆角与阴影**：`--r-xs` … `--r-2xl`；`--shadow-xs` … `--shadow-lg`；`--ring-accent` / `--ring-error`；`--focus-ring`
- **间距节奏**：`--space-1`（4px）… `--space-8`（32px），与 **Linear / Notion 式 4px 网格**对齐
- **动效**：`--ease` / `--ease-out`；全局 `@keyframes`：`lm-fade-in`、`lm-pop-in` 等；尊重 `prefers-reduced-motion`

---

## 3) 模态与向导（`.lm-wizard-backdrop` / `.lm-wizard`）

- **单一定义**：背景遮罩与卡片样式合并在一处，避免重复选择器层叠后覆盖 `overflow`（曾导致**长内容无法滚动**的回归）。
- **长内容滚动**：`.lm-wizard` 使用 `overflow-y: auto` 与 `overflow-x: clip`，**禁止**在后续“美化”块中再次写 `overflow: hidden` 整卡。
- **尺寸修饰类**（示例）：`lm-wizard--confirm`、`lm-wizard--danger`、`lm-wizard--detail`、与首跑联用的 `lm-wizard` + `lm-firstrun`（大宽度由修饰类/组合类约束）。
- **破坏性主按钮**：`lm-btn-destructive`（与 brass 主 CTA 区分，用于确认删除等不可逆操作）。
- **打字确认删除**：`lm-field-match-confirm` + 输入框 `aria-invalid` + 集中式边框/阴影样式。
- **快速打开**（类 Spotlight 顶对齐）：`lm-wizard-backdrop--quickopen`。

---

## 4) 文本与状态辅助类

- **错误/警告文色**：`lm-text-error`、`lm-text-warn`（用于行内提示，不重复写裸 `var(--...)` 散落各组件）
- **详情标题旁 ID**：`lm-wizard-title-sub`
- **向导底部操作区换行**：`lm-wizard-actions` + `lm-wizard-actions--wrap`

### 4.1) 待澄清 / 待我拍板入口

- **逻辑**：`getPendingClarificationState`（`apps/lawmind-desktop/src/renderer/lawmind-chat.ts`）——仅当**当前对话最后一条**为 `assistant` 且（存在 `clarificationQuestions` 和/或 `status === "awaiting_clarification"`）时为 `pending`，避免历史轮次的澄清误报。
- **UI**：侧栏「待我拍板」（及折叠侧栏时的顶栏角标）进入「在办」决策区；会话内澄清/批准卡片仍挂在消息流（锚点 `#lm-clarify-card-${index}`）。

### 4.2) 输入区上下文与附件（Wave D）

| 类名                                      | 用途                                       |
| ----------------------------------------- | ------------------------------------------ |
| `lm-compose-attachments`                  | 输入框上方上下文条（文件 + 案件 chip）     |
| `lm-compose-chip` / `--file` / `--matter` | 附件 pill；案件用 `--matter`（信息色边框） |
| `lm-compose-chip-remove`                  | chip 移除按钮（需 `aria-label`）           |
| `lm-compose-attachments-scroll`           | 横向滚动容器（多 chip 时不撑破布局）       |
| `lm-compose-context-picker*`              | `@` 上下文选择弹层（文件 / 案件 / 模板）   |
| `lm-compose-template-gallery*`            | 「模板」按钮打开的 legal template 画廊     |

- **数据流**：文件选择写入 `fileChatContextItems` → 发送时 `contextPins` + `buildFileContextMessagePrefix`；案件选择更新 `contextMatterId` → 发送时 `matterId` 归因。
- **实现**：`LawmindComposeAttachments.tsx`、`LawmindComposeContextPicker.tsx`、`LawmindComposeTemplateGallery.tsx`、`lawmind-compose-context.ts`。
- **待决入口**：不在 compose 挂「待你处理」条；统一侧栏/顶栏「待我拍板」→ 在办 needs-decision 焦点。

---

## 5) 无障碍与聚焦

- 可交互控件优先使用项目内既有的 **`:focus-visible`** 模式（见 `styles.css` 中全局 polish 段与 `lm-btn-*`）。
- 图标按钮（如错误条 `lm-error-dismiss`）提供 **`aria-label`**。

---

## 6) 与「高智能化」产品方向的关系

LawMind 的智能化以**任务正确完成与可交付**为成功标准，而非对话轮次；见 [LawMind 愿景](/LAWMIND-VISION) §6.2b–6.2c。桌面壳的职责不仅是「好看」，而是**稳定呈现**以下能力（实现分布在 `src/lawmind/` 与本地 API，而非单纯 CSS）：

- **可澄清的交付流**：聊天解析 `clarificationQuestions`、运行时 `awaiting_clarification` 等与 UI 卡片对齐。
- **可验收的交付物**：审核台、案件工作台与 DFA/验收包入口一致，避免用户误以为「只生成了说明文字」。
- **可引用的来源**：Citation Banner、来源预览与 `GET /api/sources/.../preview` 一致，形成信任闭环。

UI 层约定：**同一语义只用同一套类名与色板**，这样在产品加新智能特性（多轮澄清、多源聚合、版本开关）时，**不需要每次重做视觉债**。

---

## 7) 文件页、对话引用、帮助与保存（详述见专文）

左栏与 **「文件」** 顶栏、**对话引用**（把工作区/项目下的文件或目录标给助手处理）、**帮助链接在系统浏览器打开**、**主菜单 File 保存/另存为** 的完整产品说明、用户注意点、实现文件索引，见专文：

**[LawMind 桌面端：文件页、对话引用、帮助与保存](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)**

本文件仍负责 **设计令牌、模态、澄清条** 等视觉与交互基线；上述专文负责**行为与数据流**的细化记述。

---

## 8) 变更清单（维护者备注）

- **2026-07-12**：办案指挥台 `mainView === "agents"`（Header「指挥台」）；样式模块 `styles/agent-fleet.css`（经 `pnpm lawmind:sync:renderer-css` 打入 `styles.css`）；类名前缀 `lm-agent-fleet-*`。
- **2026-07-13**：Header「指挥台」改为「在办」；待审草稿并入在办；审核从对等 Tab 降为「进入文书台」；修订完成不再自动跳页；聊天中新增「当前交办」承诺卡。
- **2026-07-19（Wave A）**：顶栏「交办」改为「自动办件」；决策队列用户文案统一为「待我拍板」；主视图枚举去掉已删除的 `collaboration`，加入 `automations`。后去掉对话区重复的「待你处理」条，仅保留侧栏入口。
- **2026-07-20（9.8 分轮）**：action-summary 共享 React Query（焦点/可见时 5s）；对话回合结束即时刷新；案件概览「本案下一步」轨；案件 job SSE；文书粘性深链。

### 8.1) 半暴露 / 内部 API（诚实标注）

下列能力有 HTTP/引擎支持，**本轮不铺独立设置页**，视为内部或实验，勿在销售叙事中写成「桌面已完整暴露」：

- `GET /api/queues`（本案工作队列）
- `POST …/sessions/:id/compact`（整理上下文）
- memory adoption `suggest`、contract-revision `finalize`
- `GET /api/integrations` 目录（documents 子路径除外）

## 9) 主视图枚举

`LawmindMainView`：`workspace`（默认对话）| `agents`（在办）| `meeting`（会议室，经「会议室·办件」）| `automations`（自动办件，经「会议室·办件」）| `review`（文书台深工具）— 见 `apps/lawmind-desktop/src/renderer/lawmind-main-view.ts`。协作能力已并入「在办」子 Tab（进行中 / 交出去的活 / 按流程办），不再是顶栏对等视图。

在 `styles.css` 增加新 token 或新 `lm-*` 类时，请同步更新本文件与 [LawMind 架构](/LAWMIND-ARCHITECTURE) 中「UI 设计系统」小节的链接；若影响用户可见行为，评估是否更新 [LawMind 使用手册](/LAWMIND-USER-MANUAL) 的界面小节。若改动文件页/引用/帮助/保存/**本机默认应用打开**相关逻辑，请同步更新 [LawMind 桌面端：文件页、对话引用、帮助与保存](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)（含 §0 产品边界、§9 维护记录）。产品句柄见 [LawMind 愿景](/LAWMIND-VISION) §6.2d。

---

官方文档（Mintlify 托管）：<https://docs.lawmind.ai>
