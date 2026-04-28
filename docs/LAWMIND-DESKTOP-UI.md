# LawMind 桌面端 UI 设计约定

本文档描述 **LawMind Desktop**（`apps/lawmind-desktop`）渲染层的视觉与交互基线，便于后续功能与「高智能化」体验迭代时**不重复造轮子、不破坏一致性**。

相关文档：[使用手册（完整版）](/LAWMIND-USER-MANUAL)（桌面优先）、[LawMind 架构](/LAWMIND-ARCHITECTURE)（§十一 b 桌面应用）、[LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY)、[LawMind 2.0 strategy](/LAWMIND-2.0-STRATEGY)（产品级智能化与记忆图）。

---

## 1) 源文件

| 区域                | 路径                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| 设计令牌 + 全局样式 | `apps/lawmind-desktop/src/renderer/styles.css`（`:root` 与各 `lm-*` 类）                                |
| 分栏与拖拽尺寸      | `apps/lawmind-desktop/src/renderer/lawmind-panel-layout.ts`、`use-pane-resize.ts`（若存在）             |
| 主壳                | `App.tsx`、`lawmind-chat-shell.tsx`、`lawmind-sidebar.tsx`                                              |
| 模态/向导           | `LawmindApiSetupWizard.tsx`、`LawmindFirstRunDialog.tsx`、`lawmind-settings-shell.tsx`、`HelpPanel.tsx` |
| 业务工作台          | `MatterWorkbench.tsx`、`ReviewWorkbench.tsx`、`FileWorkbench.tsx`                                       |
| Electron 主进程     | `apps/lawmind-desktop/electron/main.mjs`（窗口、菜单、`openExternal`、新窗口外开）                      |
| Preload             | `apps/lawmind-desktop/electron/preload.cjs`                                                             |

**原则**：语义色与间距优先用 **CSS 变量** 或 **已有 `lm-*` 类**；仅**运行时几何**（分栏宽度、菜单位置、树节点缩进等）使用内联 `style`。

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

### 4.1) 待澄清：会话条（`lm-clarify-session-bar`）

- **逻辑**：`getPendingClarificationState`（`apps/lawmind-desktop/src/renderer/lawmind-chat.ts`）——仅当**当前对话最后一条**为 `assistant` 且（存在 `clarificationQuestions` 和/或 `status === "awaiting_clarification"`）时为 `pending`，避免历史轮次的澄清误报。
- **UI**：展开输入区时在 `lm-compose` 顶栏显示琥珀色会话条 +「跳转到补充区域」；收起输入区时在折叠条显示简版并同样可跳转至消息内锚点 `#lm-clarify-card-${index}`。

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

在 `styles.css` 增加新 token 或新 `lm-*` 类时，请同步更新本文件与 [LawMind 架构](/LAWMIND-ARCHITECTURE) 中「UI 设计系统」小节的链接；若影响用户可见行为，评估是否更新 [LawMind 使用手册](/LAWMIND-USER-MANUAL) 的界面小节。若改动文件页/引用/帮助/保存/**本机默认应用打开**相关逻辑，请同步更新 [LawMind 桌面端：文件页、对话引用、帮助与保存](/LAWMIND-DESKTOP-FILES-AND-CONTEXT)（含 §0 产品边界、§9 维护记录）。产品句柄见 [LawMind 愿景](/LAWMIND-VISION) §6.2d。

---

官方文档（Mintlify 托管）：<https://docs.lawmind.ai>
