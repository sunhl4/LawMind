# renderer/stores — zustand 域 store 约定

主壳状态默认仍是组件 `useState` + props 工厂（`app/useLawmindMainBodyContentProps.ts`）。
本目录是**域 store 试点**：把「一个自包含域」的状态收进 zustand，组件改为订阅 store。

已落地的域 store：

- `fleet-desk-view-store.ts`：在办左栏视图状态（团队/队列、筛选、分组展开、稍后看）。
- `matter-overview-view-store.ts`：案件概览工作队列过滤/排序 + 洞察折叠展开。
- `review-pane-visibility-store.ts`：文书台 meta / editor / preview 三栏可见性。
- `settings-panel-store.ts`：设置面板开关、当前分区、滚动锚点。

## 何时用 store vs props / useState

满足**全部**条件才考虑建域 store：

1. **自包含**：状态主要在一个组件子树内消费，不跨域共享；
2. **props 工厂依赖少**：字段不在 `useLawmindMainBodyContentProps` 里（或只占可退役的专属部分）；
3. **有跨层级传递**：同一状态要穿 2 层以上 props（如 Panel → Aside），收进 store 能明显削接口。

不满足时保持现状：

- 单组件内部的表单/加载态 → 继续 `useState`；
- 跨域共享或根壳编排的状态 → 继续走 props 工厂，不要为迁移而迁移。

## props 工厂的两层职责

`useLawmindMainBodyContentProps` 只负责：

1. **从上下文/路由解析当前应渲染的 body 分支**（`mainView` + `matterCockpitOpen` + `config`）；
2. **把公共上下文注入分支**（如 `matterId`、当前助手身份、全局事件处理器、深链 handler）。

不再聚合 30+ 子组件的 UI 状态。各子组件通过对应 store 自行订阅；分支选择器 `pickMainBodyBranchProps` 只保留跨域协调所需字段。

## 模式约定（照 fleet-desk-view-store 样板）

- **一个域一个文件**：`stores/<domain>-store.ts`，导出 `use<Domain>Store` 与 `reset<Domain>StoreForTest`。
- **状态切片 + 动作同文件**：动作（`setXxx` / 复合动作）写在 store 里，组件不直接 `setState` 拼业务语义。
- **瞬时态 vs 持久态显式分开**：
  - 持久化切片（localStorage）在 store 创建时读取、动作内写回；
  - 瞬时切片提供 `resetTransient()`，由面板挂载时调用，**对齐原 `useState` 初始语义**
    （模块级 store 生命周期长于组件，不复位会把上一视图的筛选/模式带过去）。
- **组件订阅用选择器**：`useFleetDeskViewStore((s) => s.listMode)`，逐字段订阅，避免整店订阅多渲染。
- **联动副作用留在调用方**：store 动作只管视图状态；选中项、滚动定位等仍由组件编排
  （例：`selectAssistant` 只改筛选与模式，展开组 + 选中首行留在 Panel 的 `onSelectAssistant`）。
- **测试**：colocate `<domain>-store.test.ts`，覆盖状态转移与持久化键；组件行为测试走原有
  组件测试，不在 store 测试里重复。

## 新建域 store 检查单

1. 列出域内全部 `useState` 与穿层 props，标出瞬时 / 持久；
2. 确认该域**不**被根壳/其他域直接读写，或读写可通过 store 动作完成；
3. 建 store，动作语义与原地逐一对齐（尤其带副作用的复合动作）；
4. 组件改订阅；被削掉的 props 从接口与全部调用点删除；
5. props 工厂中该域**专属**字段退役；被其他域共用的字段保留；
6. 跑该域组件测试 + store 单测 + `pnpm --filter lawmind-desktop typecheck`。

## 后续迁移顺序建议（按侵入性与收益）

1.  Workspace 面板布局状态（`wsShowEditor` / `wsShowChat` / `wsChatColWidth`）——
    根壳、header、workspace 主面板三方共享，收益高但需把 `usePaneResizePx` 持久化也纳入 store；
2.  案件列表内部状态（搜索、选中、未关联 bucket tab）——目前由 `useMatterDetail` 持有，
    可收为 `matter-list-view-store`；
3.  对话 composer 局部状态（如 template gallery 展开、compose model 提示）——
    仅在 `LawmindWorkspaceMainPane` 内部，优先下沉为组件 own state，不必建 store；
4.  跨域导航状态（`reviewFocus*` / `agentsDeskTab` / `agentsNeedsDecisionFocus`）——
    涉及深链 handler 与根壳，放到最后，建独立的 `shell-navigation-store` 统一处理。
