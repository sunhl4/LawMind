# LawMind 桌面端：文件页、对话引用、帮助与保存

本文档详细说明 **LawMind Desktop**（`apps/lawmind-desktop`）中与 **材料浏览/编辑**、**把文件或目录交给对话处理**、**帮助链接在系统浏览器打开**、**主菜单「文件」保存** 相关的产品行为与实现位置。面向**用户**与**维护者**。

相关文档：[LawMind 桌面端 UI 设计约定](/LAWMIND-DESKTOP-UI)、[LawMind 使用手册](/LAWMIND-USER-MANUAL) §1b、[LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY)。

---

## 0) 产品边界（与愿景一致）

LawMind 桌面壳**不是**内嵌 Word/通用富文本套件，**也不是**以「聊天轮次」为成功标准；而是**律师交互与指挥台 + 交付导向**，在理解充分时推进可验收结果。与 [LawMind 愿景](/LAWMIND-VISION) **§6.2d**（律师交互台：不是 Word 客户端，也不是大模型聊天窗）及 `apps/lawmind-desktop/README.md` 首段 **Product intent** 一致。材料落在工作区/项目目录；需要版式编辑时以**本机已装应用**（如 Word、WPS）与 `openPath`/文件夹定位协同；对话与「文件引用」用于澄清、对齐与向模型指路，见 §2–§3。

---

## 1) 读者与范围

| 读者            | 建议阅读                           |
| --------------- | ---------------------------------- |
| 日常用户        | §0、§2、§3、§4、§5（操作与注意点） |
| 前端/桌面维护者 | 全文；实现以 §6、§7、§9 为准       |

**不在本文展开的内容**：引擎侧工具参数、法规检索、案件/审核台业务流（见 [LawMind 架构](/LAWMIND-ARCHITECTURE) 与各业务文档）。

---

## 2) 「文件」页是做什么的（产品定位）

顶栏 **「文件」** 对应主区域中的 **材料工作台**，承担两类职责：

1. **浏览与编辑**  
   在左侧 **工作区** 与 **项目目录**（若已在设置中选择）文件树中打开文本类文件，在右侧编辑区 **编辑、保存（⌘S）、另存为（⇧⌘S）**。  
   工作区根即 LawMind 数据根（如 `MEMORY.md`、`cases/` 等）；项目目录为你在设置中为本机案件材料单独指定的文件夹。

2. **为对话「指路」**  
   见 §3。文件页本身**不是**第二个聊天窗口；与助手的工作发生在 **「对话」** 页，但通过 **引用** 可以把「此刻要助手重点看的文件或目录」固定下来。

**左栏布局**：品牌与助手/在办记录仍在 **同一左侧边栏** 内；其 **上方** 为可滚动的 **工作区/项目文件树**，**中间一条横向分割条** 可 **拖动** 调整「文件树区域高度」与「下方助手/在办区」的占比；最外侧与主区之间仍有 **一条竖向分割条** 调整左栏总宽。纯文本页 **不内嵌** Word/Excel/PDF 版式；点选 `.doc` / `.docx` 等时提示用 **本机应用打开**（`shell.openPath`），并提供「在访达/文件夹中显示」。

---

## 3) 对话引用：把文件/目录交给助手处理

### 3.1 用户能做什么

- 在文件树中对 **文件** 或 **目录** **右键** → **「在对话中引用」**。
  - 目录表示「本回合让助手围绕该目录下的材料处理」，模型会按需要**分批**用工具读具体文件（不会把整棵树一次性塞进一句用户话里）。
- 对 **工作区/项目根标题行** 右键 → **「在对话中引用…根目录」**（谨慎使用；根目录范围大）。
- 在右侧打开某文件时，工具栏 **「加入对话引用」** 将 **当前打开文件** 加入引用列表。
- 可 **多次添加**，形成 **多条** 引用（建议上限见下）；在 **「对话」** 页顶栏下方会显示 **「引用」** 标签，可 **单条移除** 或 **清空引用**。
- 从文件侧加入引用后，应用会 **自动切到「对话」** 页，便于你立即输入需求。

### 3.2 上限与去重

- 同时存在的引用条数 **最多 8 条**（工作区 + 项目合计）。
- 同一路径（同一 `root` + 相对路径 + 文件/目录种类）**不会重复添加**。

### 3.3 发送消息时实际发生什么（重要）

- 你在输入框里看到的 **用户消息内容** 仍为你自己输入的文字。
- **发送至模型** 的 `message` 会在**用户原文前**自动拼接一段 **中文系统说明**，列出本回合引用的路径，并提示助手使用已有工具阅读，例如：
  - **工作区** 相对路径 → 与 `analyze_document` 等工具一致；
  - **项目目录** 下相对路径 → 与 `read_project_file` 一致。
- 目录不会作为「单文件内容」整段塞入；说明中会引导模型 **按需列举或分文件阅读**。

实现位置：`useLawmindAppShell` 中的 `fileChatContextItems` 与 `buildFileContextMessagePrefix`（`lawmind-app-shell.ts`），在调用 `sendChatTurn` 时使用拼接后的 `messageForApi`，而界面展示的 user 气泡仍使用未加前缀的原文。

### 3.4 与后端/工具的关系

- 对话 HTTP 接口仍为 `POST /api/chat`；**不必**为引用单独增加字段即可工作（前缀在客户端拼接）。
- 引擎侧已具备从 **工作区**、**项目目录** 读文件的能力（见 `src/lawmind/agent/tools/legal-tools.ts` 中 `analyze_document`、`read_project_file` 等）。**引用**做的是把用户意图**显式写进自然语言消息**，减少模型「猜不到要读哪」的情况。

### 3.5 多文件、多目录

- **多个文件/多个目录**：通过多次 **「在对话中引用」** 或 **「加入对话引用」** 累积，顶栏中可见列表。
- **暂不支持** 树内 Shift 多选一次性添加（可后续迭代）；当前模型与 8 条上限已能覆盖「挑几份材料一起问」的常见场景。

---

## 4) 帮助：问号面板与官方文档

- 侧栏品牌栏 **「?」** 打开 **帮助** 弹层，列出到 **Mintlify 官方文档** 的链接。
- 在 **Electron** 中，普通 `<a target="_blank">` 易在**应用内开新窗**导致空白或异常。
- **行为**：
  1. 主进程在创建主窗口后注册 **`setWindowOpenHandler`**，对 `http:`/`https:` 的 `window.open` / `target=_blank` 一律 **`shell.openExternal` 在系统默认浏览器打开** 并 `deny` 内嵌新窗。
  2. 帮助面板的链接在点击时 **`preventDefault()`**，经 **`lawmind:open-external` IPC** 调用 `shell.openExternal`。

涉及文件：`electron/main.mjs`（`setWindowOpenHandler`、IPC 注册）、`electron/preload.cjs`（`openExternal`）、`HelpPanel.tsx`（`openHelpLink`）。

---

## 5) 主菜单「文件」与保存

- **macOS/桌面菜单栏**（`autoHideMenuBar: true`）：鼠标移入窗口顶部可看到 **File**。
- **File → Save**（⌘S / Ctrl+S）、**File → Save As…**（⇧⌘S / Ctrl+Shift+S）向渲染进程发 **`lawmind:file-menu`** 事件。菜单 `click` 使用 **`BrowserWindow.getFocusedWindow() ?? getAllWindows()[0]`** 再 `webContents.send`，避免 `click` 回调里 `win` 为空导致事件丢失。
- 渲染层 `FileWorkbench` 订阅后执行**保存**或**另存为**（另存为走系统保存对话框，见 IPC `lawmind:dialog:save-text-file`）。
- 工具栏 **保存**：有打开标签时**可点**；若当前无未保存修改，`saveActive` **早退**不写盘（避免「灰掉像坏掉」的观感）。**另存为** 需有当前编辑标签。

涉及文件：`electron/main.mjs`（`Menu`、`setupApplicationMenu`、`sendFileMenu`）、`preload.cjs`（`onFileMenu`）、`FileWorkbench.tsx`。

---

## 6) 维护者：实现清单

| 能力                               | 关键文件 / 说明                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 左栏 + 主区 + FileWorkbench 挂载   | `App.tsx`：`lm-side-stack` + `ref` 宿主；`FileWorkbench` 使用 `createPortal` 将树/编辑挂入宿主                                                                                                                    |
| 左栏文件树高度拖动                 | `App.tsx`：`usePaneResizeVerticalPx`（`lawmind.ui.sideFileTreeHeight`）；`lm-split-handle-horizontal` 位于 `lm-side-files-host` 与 `LawmindSidebar` 之间；常量 `LM_SIDE_FILE_TREE_*` 在 `lawmind-panel-layout.ts` |
| 对话引用 state / 发送前缀          | `lawmind-app-shell.ts`：`FileChatContextItem`、`addFileToChatContext`、`buildFileContextMessagePrefix`、`sendChatMessage`                                                                                         |
| 文件树右键与编辑器「加入对话引用」 | `FileWorkbench.tsx`：上下文菜单、`onAddToChatContext`；文件页顶栏说明文案                                                                                                                                         |
| 对话顶栏「引用」条                 | `lawmind-chat-shell.tsx`：`fileChatPills`；样式 `styles.css` 中 `.lm-file-chat-context-*`                                                                                                                         |
| 帮助外链                           | `HelpPanel.tsx`、`main.mjs` 中 `setWindowOpenHandler` + `lawmind:open-external`                                                                                                                                   |
| 主菜单保存                         | `main.mjs` 中 `setupApplicationMenu`、`sendFileMenu`；`FileWorkbench` 中 `onFileMenu` 订阅                                                                                                                        |
| Office/Word 不内嵌                 | `FileWorkbench.tsx`：`isOfficeLikePath`、`officeBlock` 说明面板；`main.mjs` IPC `lawmind:open-with-system`（`shell.openPath`）；`preload.cjs`：`openWithSystem`                                                   |

**类型与 API**：`global.d.ts` 中为 `openExternal`、`openWithSystem`、`onFileMenu`、`fsCopy`、`saveTextFileDialog` 等声明了 `Window` 上的 `lawmindDesktop`。

---

## 7) 样式类名速查（新增/常用）

| 类名                                             | 用途                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `lm-side-stack`                                  | 左栏内：文件区 + 侧栏滚动区纵向分区                                                                             |
| `lm-side-files-host`                             | 文件树 portal 容器；**高度**由 `App.tsx` 内 `sideFileTreeHeight`（px）控制，随横向分割条持久化到 `localStorage` |
| `lm-file-page-intro`                             | 文件页主区顶部的功能说明条                                                                                      |
| `lm-file-chat-context-bar` / `lm-file-chat-chip` | 对话页「引用」条与标签                                                                                          |

更全的设计约定仍以 [LawMind 桌面端 UI 设计约定](/LAWMIND-DESKTOP-UI) 为准。

---

## 8) 用户常见问题（简短）

- **Q：引用会代替「项目目录」药丸吗？**  
  **A：** 不会。项目目录仍决定 **整盘材料根**；引用是 **本回合** 要助手重点看的子路径。
- **Q：不点引用，只关联案件/项目，助手能读材料吗？**  
  **A：** 能，引擎仍有检索与工具；引用用于 **明确**「就这几处先读」。
- **Q：帮助链接打不开？**  
  **A：** 更新到含 `setWindowOpenHandler` 与 `openHelpLink` 的版本后，应在 **系统默认浏览器** 打开 `https://docs.lawmind.ai/...`。

---

官方文档（Mintlify）：<https://docs.lawmind.ai>

本页在站点上的路径将映射为（与文件名一致、无扩展名）：

- <https://docs.lawmind.ai/LAWMIND-DESKTOP-FILES-AND-CONTEXT>

（若本页刚加入仓库、站点尚未发布，以本地 `docs/LAWMIND-DESKTOP-FILES-AND-CONTEXT.md` 为准。）

---

## 9) 维护记录与续做入口

| 日期 / 阶段 | 摘要                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04     | 本页与 M3 清单对齐：左栏材料台、对话引用、帮助外开、菜单保存、`open-with-system`、产品 §6.2d 与 README **Product intent**；工程侧见 [LawMind 工程记忆](/LAWMIND-PROJECT-MEMORY) M3 小节中 **「材料台、对话引用与系统协同」** |

**后续可迭代（未承诺排期）**：文件树多选后批量加入对话引用；更细的主区布局拖动（若仍反馈「对话区/文件区」需同屏可调，可再评是否增加主区内部 split，当前为顶栏切页）。

**关键源码路径（速查）**

- `apps/lawmind-desktop/src/renderer/App.tsx` — 壳、左栏堆叠、文件树高度、主区
- `apps/lawmind-desktop/src/renderer/FileWorkbench.tsx` — 树、编辑器、保存、Office 面板
- `apps/lawmind-desktop/src/renderer/lawmind-app-shell.ts` — 对话引用与发送前缀
- `apps/lawmind-desktop/electron/main.mjs` — 窗口、菜单、IPC、外链、`openPath`
- `apps/lawmind-desktop/electron/preload.cjs` — `contextBridge` 暴露
- `docs/LAWMIND-VISION.md` §6.2d — 产品句柄
