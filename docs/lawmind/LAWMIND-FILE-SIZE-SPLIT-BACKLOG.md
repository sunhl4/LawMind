# file-size 棘轮：待拆分清单（存量超标）

- 日期：2026-10-22
- 分支：`fix/ci-existing-red`
- 检查命令：`node scripts/pre-commit/check-file-size.mjs`（语义见脚本头注释：NEW / GROWN / STALE）
- 状态：本清单内的 7 条**仍是红的**，是刻意保留的「该拆但本轮不拆」；其余 6 条已逐条评审后显式登记冻结上限。

## 1. 为什么这些条目没有 `--update`

`--update` 会把当前行数写成新的冻结上限，等于承认这份尺寸可以继续存在。下列文件属于**严重超标或职责混杂**，抬高上限只会把问题固化，因此保持 CI 红，作为待拆的工作项：

| 文件                                                                    | 当前行数 | 软上限 | 建议拆法（一句话）                                                                                                                                                                 |
| ----------------------------------------------------------------------- | -------: | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/lawmind-desktop/src/renderer/file/LawmindWordRevisionSurface.tsx` |     2884 |    800 | 拆成「修订面容器 / 逐条修订卡片 / 编辑区 DOM 改写工具」三块，DOM 改写工具下沉为独立模块并单测。                                                                                    |
| `src/lawmind/agent/tools/engine/engine-pipeline-tools.ts`               |     1698 |    600 | 按工具拆文件：`planTask` / `researchTask` / `updateDraft` / `draftDocument` / `renderDocument` / `renderTrackedDraft` 各自成模块，共享的 section 解析与 baseline 处理抽到 helper。 |
| `apps/lawmind-desktop/src/renderer/LawmindAgentFleetPanel.tsx`          |     1301 |    800 | 拆出「舰队队列视图」「席位详情抽屉」「matter 标签映射」；当前组件同时管数据轮询、缓存与三层渲染。                                                                                  |
| `apps/lawmind-desktop/src/renderer/useLawmindChatSend.ts`               |     1298 |    800 | 按阶段拆 hook：构造请求 / 流式回调派发 / 澄清与 steer 处理；单文件里已混了传输、状态机和 UI 提示文案。                                                                             |
| `src/lawmind/agent/tools/legal/search-tools.ts`                         |     1080 |    600 | 按域拆文件：matter/workspace 检索、会话检索、法条与案例检索、利益冲突检查；当前 8 个 AgentTool 共处一文件。                                                                        |
| `apps/lawmind-desktop/src/renderer/LawmindSideChatSessions.tsx`         |     1018 |    800 | 拆出「会话列表项」「搜索与置顶逻辑」「折叠分组存储」；单个组件已承担列表渲染 + 过滤排序 + 本地存储。                                                                               |
| `src/lawmind/agent/tools/legal/ingest-helpers.ts`                       |      922 |    600 | 按输入形态拆：docx/xlsx 文本抽取、PDF（含 OCR）、图片（vision/OCR 混合）三条链路各自成模块，共用预算与错误处理留 helper。                                                          |

关闭方式：拆完任意一条后跑 `node scripts/pre-commit/check-file-size.mjs --update`，让该条从失败清单与基线里消失；不要让条目无声腐烂。

## 2. 本轮显式登记（`--update` / 显式写入基线）的 6 条

这些都是「略超软上限、单一职责仍然清楚」，拆开反而会把一个内聚的组件/工具切碎。登记值是当前行数，之后**任何增长**都会重新触发 GROWN：

| 文件                                                             | 当前行数 | 新冻结上限 | 理由                                                                   |
| ---------------------------------------------------------------- | -------: | ---------: | ---------------------------------------------------------------------- |
| `apps/lawmind-desktop/src/renderer/LawmindClarificationForm.tsx` |      806 |        806 | 仅超软上限 6 行，一个表单组件 + props 类型，无第二职责。               |
| `apps/lawmind-desktop/src/renderer/file/FileWorkbenchImpl.tsx`   |      993 |        993 | 930 → 993：中栏多格式预览接线带来的增长，仍是一个工作台外壳组件。      |
| `apps/lawmind-desktop/src/renderer/lawmind-chat.ts`              |      867 |        867 | 聊天态纯函数与类型集合，导出多但每个函数都很短，拆分只会把类型拉扯开。 |
| `apps/lawmind-desktop/src/renderer/lawmind-settings-shell.tsx`   |      849 |        849 | 设置页单一组件 + 别名导出，超限 49 行来自设置分组，未新增职责。        |
| `apps/lawmind-desktop/src/renderer/useLawmindChatSessions.ts`    |      821 |        821 | 仅超 21 行，一个会话列表 hook。                                        |
| `src/lawmind/agent/tools/legal/review-table-tool.ts`             |      682 |        682 | 一个 AgentTool 的 schema + 批处理抽取；拆文件会把工具契约与实现分家。  |

同时 `--update` 顺带收紧了两条已缩小的冻结上限（棘轮正常收紧，非豁免）：

- `apps/lawmind-desktop/src/renderer/LawmindLawyerWorkbench.tsx`：2418 → 2278
- `apps/lawmind-desktop/src/renderer/lawmind-chat-shell.tsx`：1055 → 1017

## 3. 脚本行为备注

`check-file-size.mjs --update` **不会**自动登记 NEW（未登记的新超标文件）：`nextCeilings` 只为既有条目写入。因此 NEW 的显式豁免是在 `scripts/pre-commit/file-size-baseline.json` 里手写条目完成的——仍属显式动作，但不该被当成「一条命令就绿灯」的捷径。
