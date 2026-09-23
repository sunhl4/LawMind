# 第 50 章 实现精读：渲染层

第 24 章是「界面逐屏」。这一章讲**渲染层是怎么组织起来的**：428 个顶层文件、186 个测试，它是怎么避免变成一团面条的。

## 50.1 渲染层的三件难事

一个几百个文件的 React 应用，难在三处：

| 难点                           | 这个仓库的答案                                                            |
| ------------------------------ | ------------------------------------------------------------------------- |
| 组件越写越大（「上帝组件」）   | **props hook + 纯组件**，再加「pick 收窄」                                |
| 状态散落各处、说不清谁拥有什么 | **三层分工**：服务端数据走 Query、事件走 SSE、局部状态走 zustand 域 store |
| 跨源 + 鉴权 + 流式，容易踩坑   | 统一 HTTP 客户端 + 统一的 SSE 客户端（都写清了为什么不能用默认方案）      |

下面逐个讲。

## 50.2 模式一：props hook + 纯组件

`app/` 目录里有一批成对的文件：

| 逻辑（hook）                         | 视图（组件）                  |
| ------------------------------------ | ----------------------------- |
| `useLawmindAppHeaderProps.ts`        | `LawmindAppHeader.tsx`        |
| `useLawmindAppRootLayout.ts`         | `LawmindAppRootView.tsx`      |
| `useLawmindAppRootHandlers.ts`       | —                             |
| `useLawmindAppRootDialogsProps.ts`   | `LawmindAppRootDialogs.tsx`   |
| `useLawmindAppOverlaysProps.ts`      | `LawmindAppOverlays.tsx`      |
| `useLawmindAppSettingsPanelProps.ts` | `LawmindAppSettingsPanel.tsx` |
| `useLawmindAppSidebarProps.ts`       | `LawmindAppSidebar.tsx`       |
| `useLawmindMainBodyContentProps.ts`  | `LawmindMainBodyContent.tsx`  |

**分工是**：

- **hook 里**：所有取数、派生、事件处理、store 订阅、`useMemo`。它导出一个 `UseXxxPropsInput`（输入）并返回组件的 props 对象。
- **组件里**：只接收 props 并渲染。**尽量不 import 数据层**。

`useLawmindAppHeaderProps.ts` 的开头就能看出这个模式：它 import 了 `buildReadinessSnapshot`、`HealthPayload`、两个 store，并声明了一个有 20+ 字段的 `UseLawmindAppHeaderPropsInput`。

**这个模式的好处**：

1. **组件可以脱离数据层单独渲染**（喂 props 就能测）。
2. **逻辑可以被别的组件复用**（hook 就是函数）。
3. **组件文件小**（只管渲染），不容易撞文件大小棘轮。

**代价**：文件数翻倍，而且要维护 hook 的输入类型。

## 50.3 模式二：pick 收窄

主内容区要按当前视图分支渲染五个工作面。如果直接写：

```tsx
{
  mainView === "desk" && <LawmindLawyerWorkbench {...everything} />;
}
```

会有两个问题：`everything` 是一个上百字段的对象（每个分支都要解构一大串），而且**每个分支需要的字段不同**。

这个仓库的答案是**一组 `pick*` 函数**：

| 文件                            | 作用                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `pickMainBodyBranchProps.ts`    | 把 `LawmindMainBodyContentProps` 收窄成五个视图各自的 props |
| `pickWorkspaceMainPaneProps.ts` | 对话工作面的收窄                                            |

`pickMainBodyBranchProps.ts` 的头部注释一句话说明了它存在的理由：

> Narrow `LawmindMainBodyContentProps` → per-view props. Keeps branch JSX free of 100-field destructure noise (R-P1-2).

也就是说：**分支 JSX 里只看到视图真正要的字段**。相关函数也在这个文件里（`pickAgentFleetViewProps`、`pickLawyerWorkbenchProps`、`pickMeetingViewProps`）。

**这两个模式合起来**（props hook + pick 收窄）解决了「上帝组件」：主内容组件不需要知道五个视图各自的几十个字段，只负责「按 view 选一个 pick 结果」。

**注意 `pick*` 是纯函数**——`pickMainBodyBranchProps.ts` 与 `pickWorkspaceMainPaneProps.ts` **各有自己的测试**（`.test.ts`），因为纯函数好测。这也说明这个模式是**被认真对待的基础设施**，不是随手写的胶水。

## 50.4 模式三：状态的三层分工

第 24.11 节讲过「只有五个 zustand store」。这里讲清**为什么只有五个**。

渲染层的状态分三类：

| 类型             | 谁管             | 例子                                     |
| ---------------- | ---------------- | ---------------------------------------- |
| **服务端数据**   | TanStack Query   | 健康、案件列表、草稿详情、验收报告       |
| **服务端推送**   | SSE 订阅 hook    | 回合事件、任务进度、审批请求             |
| **局部 UI 状态** | zustand 域 store | 在办左栏视图、改稿三栏显隐、设置面板分区 |

**五个 store 各自的域边界**（`stores/README.md` 里的约定）：

| store                             | 域边界                                         | 持久化               |
| --------------------------------- | ---------------------------------------------- | -------------------- |
| `approval-request-store.ts`       | 工具/案件操作确认状态                          | 否                   |
| `fleet-desk-view-store.ts`        | 在办左栏：列表模式、筛选、分组展开、「稍后看」 | 「稍后看」与手折分组 |
| `matter-overview-view-store.ts`   | 案件概览：工作队列过滤排序 + 洞察折叠          | 否                   |
| `review-pane-visibility-store.ts` | 改稿三栏显隐                                   | 是                   |
| `settings-panel-store.ts`         | 设置面板开关、当前分区、滚动锚点               | 只有分区             |

**注意「持久化」那一列**：只有「记住也没关系」的东西才落 localStorage。审批状态、筛选条件这些**不该被记住**（否则下次打开会看到一个意外的筛选）。

**`stores/README.md` 的四条约定**（第 24.11 节引过）：一个域一个文件、actions 跟 state 一起、临时态与持久态分开、组件用 selector 订阅。

**为什么这条约定重要**：几百个文件的应用里，「状态放哪」如果没有规则，最后会出现同一个数据在三处有副本。**五个 store 是「克制」的产物**——大部分状态其实不该进全局 store。

## 50.5 数据层：统一入口与它的历史

### `api-client.ts` 与 `api-client-proxy.ts`

**实现其实在 `api-client-proxy.ts`**。`api-client.ts` 的头部注释说明了它的角色：

> 实现已迁移至 `api-client-proxy.ts`：本文件保留 loopback 401 重试逻辑与 `apiGetJson` / `apiSendJson` 兼容签名，并 re-export 代理层的错误与工具函数。

也就是说：

| 文件                  | 职责                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `api-client-proxy.ts` | `fetchApi`、`ApiRequestError`、`readJsonFromResponse`、`userMessageFromApiError` |
| `api-client.ts`       | **401 的重试逻辑**（本机服务重启后凭据会变）、兼容签名、re-export                |

**401 重试是本地应用的必需能力**（第 13 章那个端口与凭据的故事）：服务重启后凭据变了，客户端要能自动重新取一次再重试。

`use-api.ts` 里有一行 TODO，说明迁移还没完：

```text
// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
```

**所以看到直接 `fetch` 的地方，那是历史遗留**，不是新写法该模仿的。

### `sse-client.ts`（最有教育意义的一个）

头部注释讲了四条设计约束，第一条是最关键的：

> **`EventSource` 不能自定义 `Authorization` 头**，本地 API 又要求 Bearer，所以用 `fetch` 手动解析 SSE 帧。

这条解释了一个常见疑问：「为什么不用浏览器原生的 `EventSource`？」——因为**认证头塞不进去**。

其余三条：

| 约束     | 做法                                                     |
| -------- | -------------------------------------------------------- |
| 自动重连 | 指数退避，最大 30 秒                                     |
| 断线续传 | 重连时传 `last-event-id`，服务端对最近事件做**有界回放** |
| 多订阅者 | 按 `(apiBase, types)` 聚合，**同一 key 只维护一个连接**  |

**最后一条很重要**：界面里可能有好几个组件同时想订阅同一个事件流（比如侧栏徽标和主面板都想知道审批变化）。聚合意味着**它们共用一条连接**，而不是各开一条。

**这条与服务端的 `SSE_REPLAY_LIMIT = 64`（第 14 章）正好配套**：客户端的 `last-event-id` + 服务端的有界回放 = 断线重连不丢事件。

### `lawmind-query-keys.ts`

```ts
export const lawmindQueryKeys = {
  health: (apiBase) => ["lawmind", "health", apiBase],
  bootstrap: (apiBase) => ["lawmind", "bootstrap", apiBase],
  matterDetail: (apiBase, matterId) => ["lawmind", "matter-detail", apiBase, matterId],
  ...
};
```

两个约定值得注意：

1. **每个 key 都带 `apiBase`**。因为本地服务可能换端口，换了端口就应该重新取（缓存不能跨实例复用）。
2. **前缀统一 `lawmind`**，便于整体失效（`invalidateQueries({ queryKey: ["lawmind"] })`）。

**为什么 key 要集中在一个文件**：key 是「缓存的身份」，散落各处就会出现「我以为失效了其实没有」。集中之后，失效操作能写得准确。

### `lawmind-desktop-bridge.ts`

只有 4 行：

```ts
export function hasLawmindDesktopBridge(): boolean {
  return typeof window !== "undefined" && typeof window.lawmindDesktop?.getConfig === "function";
}
```

**它的存在意义**：判断「现在是不是在 Electron 壳里」。`app/LawmindDesktopRequiredPage.tsx` 用它——**在浏览器里打开时会显示「必须用桌面应用」的页面**（第 2 章那条规则在代码里的落点）。

## 50.6 目录结构与各自的职责

| 目录            | 文件数 | 职责                                                                     |
| --------------- | ------ | ------------------------------------------------------------------------ |
| （顶层）        | 428    | 各种组件、hook、纯逻辑模块                                               |
| `app/`          | 约 40  | 壳：根视图、侧栏、顶栏、主内容分支、对话框、设置面板 + 对应的 props hook |
| `matter/`       | 58     | 案件驾舱的全部面板与 hook                                                |
| `review/`       | 11     | 改稿工作面的列组件与数据/动作 hook                                       |
| `settings/`     | —      | 设置的分区组件                                                           |
| `stores/`       | 6      | 五个域 store + README                                                    |
| `insights/`     | 4      | 案件层面的洞察组件（转发自 `insights/`）                                 |
| `file/`         | —      | 文件工作台                                                               |
| `styles/`       | —      | CSS 模块（由同步脚本内联进 `styles.css`）                                |
| `vendor/katex/` | —      | 随包的 KaTeX（聊天里的数学公式）                                         |

**`app/` 是唯一有「成对 hook」模式的地方**（因为壳的 props 最多、最需要收窄）。`matter/` 与 `review/` 用的是普通的「组件 + `use*` hook」写法（比如 `useMatterDetail`、`useReviewWorkbenchData`）。

## 50.7 `review/` 的数据与动作分工

改稿工作面是「读」和「写」分得最清的一处：

| 文件                                | 职责                                                 |
| ----------------------------------- | ---------------------------------------------------- |
| `useReviewWorkbenchData.ts`         | **取数**（草稿、验收、红线、引用完整性……）           |
| `useReviewWorkbenchActions.ts`      | **动作**（签批、导出、处理 hunk、提交改稿）          |
| `ReviewWorkbenchDocumentColumn.tsx` | 文档栏（编辑区 + 预览）                              |
| `ReviewWorkbenchMetaColumn.tsx`     | 元信息栏                                             |
| `review-lint-preview.ts`            | lint 预览的纯逻辑                                    |
| `review-workbench-helpers.ts`       | 共享助手（含 `parseFilenameFromContentDisposition`） |
| `LawmindProvenanceIndicator.tsx`    | 出处指示                                             |

**读/写分成两个 hook** 是有意的：读的那份可以被别的组件复用（比如对话里的草稿状态条也可能要看同一份数据），写的那份只在改稿面里用。

`review-workbench-helpers.ts` 里的 `parseFilenameFromContentDisposition` 值得单独提：导出下载文件时要**从响应头里解析文件名**，而且要优先读 RFC 5987 的 `filename*`（UTF-8 编码形式），否则中文文件名会乱码。这类细节通常会被漏。

## 50.8 `matter/` 的 58 个文件怎么不乱

`matter/` 是最大的一个子目录（58 个文件）。它不乱的原因是**按「面板 + 数据 hook + 纯逻辑」三类分**：

| 类别                  | 例子                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 面板（一个 tab 一个） | `MatterCockpit.tsx`、`MatterCasePanel.tsx`、`MatterReviewMatrixPanel.tsx`、`MatterOpsBrief.tsx`                                       |
| 数据 hook             | `useMatterDetail.ts`、`useMatterWorkbench.ts`、`useMatterWorkbenchOps.ts`、`useMatterSessionTimeline.ts`、`useMatterHealthMetrics.ts` |
| 纯逻辑模块            | `matter-display-labels.ts`、`matter-interaction.ts`、`matter-task-board.ts`、`review-matrix-notes.ts`、`litigation-fee-view.ts`       |

**纯逻辑模块单独成文件**是这里的另一个好习惯。比如：

- `matter-display-labels.ts` 把一堆枚举到中文的映射集中起来（`taskLifecycleLabel`、`queueKindLabel`、`approvalStatusLabel`……），还带自己的测试。
- `matter-task-board.ts` 的 `mergeTaskBoardRows` 把五种来源（任务、队列、审批、草稿、后台任务）合并成一张看板的行——**这个合并逻辑有测试**（`matter-task-board.test.ts`）。
- `litigation-fee-view.ts` 是「诉讼费怎么显示」的纯函数，注释写明「纯函数，便于测试」。

**为什么这个习惯重要**：把「怎么算」从「怎么画」里拿出来，就能给「怎么算」写测试——而**界面测试又慢又脆**。

## 50.9 一个反面例子也得知道

不是所有地方都这么整齐。两处历史遗留：

**第一：`use-api.ts` 里那行 TODO。**

> `TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.`

**第二：`matter/useMatterDetail.ts` 与 `useMatterWorkbench.ts` 头部有同样的 TODO。**

说明**「把 fetch 统一到代理层」这件事还没做完**。看到新代码里直接 `fetch` 要当心——那可能是跟着旧写法抄的。

**第三：`useMatterSessionTimeline.ts` 标了 `@deprecated`**（说 `refreshVersion` 参数被忽略，改用查询失效）。

这些都是「知道但不急着改」的状态，读代码时别把它们当规范。

## 50.10 界面文案的机械约束（代码层面）

第 32 章讲了文案规范。落到渲染层，它有一个**机械执行点**：

```bash
pnpm lawmind:ui-copy-lint
```

它扫渲染层文案，按 `BANNED_PATTERNS` 拦 10 类模式（路径、英文枚举、门禁术语等）。存量合法用例登记在 `scripts/lawmind/ui-copy-lint-allowlist.json`。

**所以改渲染层的文案，改完要跑这条命令。** 这也是为什么渲染层里会看到「案件档案」而不是 `CASE.md`、「已批准」而不是 `approved`——**不是自觉，是有 lint 守着**。

## 50.11 文件大小棘轮对渲染层的影响

第 18 章讲过：渲染层 `.ts` / `.tsx` 的软上限是 **800 行**，存量超标的冻结在 `file-size-baseline.json` 里。

当前冻结的渲染层文件（我查过基线）包括：

| 文件                                     | 冻结上限 |
| ---------------------------------------- | -------- |
| `LawmindLawyerWorkbench.tsx`             | 2615     |
| `LawmindSettingsDoctor.tsx`              | 1267     |
| `lawmind-chat-shell.tsx`                 | 1055     |
| `LawmindAutomationsPanel.tsx`            | 1027     |
| `file/FileWorkbenchImpl.tsx`             | 930      |
| `LawmindAgentFleetPanel.tsx`             | 928      |
| `matter/useMatterProductIntelligence.ts` | 802      |

**这七个文件是「已知的大文件」**——它们可以保持现状，但**不许再长**。

**这解释了渲染层的两个现象**：

1. 为什么会有 props hook、pick 收窄、纯逻辑模块单独成文件——**因为超过 800 行的文件会挡住 CI**。
2. 为什么 `MatterWorkbench` 的形态是「tab 容器 + 路由这些视图，单文件 < 300 行」（`matter/index.ts` 的注释原话）。

**也就是说：这个仓库的渲染层结构，一部分是被棘轮「逼」出来的。** 这不是坏事——棘轮把「要不要拆」这个反复出现的争论变成了一个机械判据。

## 50.12 加一个新面的清单

如果你想加一个新的工作面板，按这个顺序：

```text
① 数据层：如果是新数据，加 query key（lawmind-query-keys.ts）+ query hook
② 纯逻辑：把「怎么算」写成纯模块（带测试）
③ 面板组件：只接收 props
④ 数据/动作 hook：取数与写操作分开
⑤ 挂载点：加到对应目录的 index 或 tab 容器
⑥ 如果是新的主视图：改 lawmind-main-view.ts + LawmindMainBodyContent 的分支 + pick 函数
⑦ 状态：只有「跨组件共享的 UI 状态」才进 store
⑧ 文案：跑 pnpm lawmind:ui-copy-lint
⑨ 测试：纯逻辑必测；组件的交互契约测（比如「预览不写入、确认后才落盘」）
⑩ 如果碰了主视图或深链：看 e2e/ 里有没有相关 spec 要同步
```

## 50.13 已知坑（本章相关）

- **实现已迁到 `api-client-proxy.ts`**，`api-client.ts` 只是兼容层 + 401 重试。
- **还有直接 `fetch` 的地方**（有 TODO 标着），别当新写法模仿。
- **SSE 不用 `EventSource` 是因为设不了 `Authorization` 头。**
- **SSE 连接按 `(apiBase, types)` 聚合**，同一 key 只开一条。
- **query key 都带 `apiBase`**（端口变了要重新取）。
- **只有五个 zustand store，这是克制的产物。** 新状态先问「该不该全局」。
- **持久化只给「记住也没关系」的东西。** 筛选条件、审批状态不该落 localStorage。
- **`pick*` 是纯函数且有测试**，改它要跑测试。
- **渲染层有 800 行软上限，七个文件冻结在基线里。** 加东西到这些文件会让 CI 红。
- **文案有机械 lint。** 改文案要跑 `pnpm lawmind:ui-copy-lint`。
- **`useMatterSessionTimeline` 标了 `@deprecated`。**
- **`lawmind-desktop-bridge.ts` 只有 4 行，但它是「必须用桌面应用」那条规则的落点。**
