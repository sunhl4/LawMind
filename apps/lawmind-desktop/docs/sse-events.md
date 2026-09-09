# LawMind Desktop 统一 SSE 事件总线

桌面端本地 HTTP 服务提供单一 SSE 通道 `/api/events`，用于替代 renderer 中的高频轮询。renderer 通过 `sse-client.ts` / `useSseSubscription.ts` 订阅事件，server 通过 `LawmindSseBus` 广播。

## 事件类型

| 类型 | 触发场景 | 示例 |
|------|---------|------|
| `fs:change` | `/api/fs/write` 成功写文件后 | `{ root, rel, mtimeMs, size }` |
| `task:update` | 任务/草稿内容更新、删除、签批状态变化 | `{ taskId, reviewStatus }` |
| `review:status` | `/api/drafts/:id/review` 签批后 | `{ taskId, reviewStatus }` |
| `approval:update` | `/api/approvals/resolve` 处理审批后 | `{ matterId, approvalId, status }` |
| `delegation:update` | 委派创建/撤销 | `{ delegationId, status, matterId }` |
| `matter:<matterId>:update` | 预留：案件级聚合事件（尚未接入） | — |
| `sync:status` | 预留：同步/索引状态变化 | — |

当前已接入 fs / task / review / approval / delegation 五类事件；matter 与 sync 为预留命名空间，后续按需补充。

## 接入服务端

在 `LawmindDispatchContext` 中 `ctx.sseBus` 已可用。业务路由在数据变更后调用：

```ts
ctx.sseBus?.emit({ type: "task:update", data: { taskId: raw, reviewStatus: updated.reviewStatus } });
```

新增事件类型时：
1. 在上表登记；
2. 在对应路由的写操作成功处 `emit`；
3. 避免在只读路由中 emit。

## 接入 Renderer

### 基础客户端

```ts
import { subscribeToSseStream } from "./sse-client";

const unsubscribe = subscribeToSseStream(
  apiBase,
  ["task:*", "review:*", "fs:change"],
  {
    onMessage: (msg) => {
      if (msg.type === "task:update") {
        void refreshTasks();
      }
    },
    onOpen: () => setPolling(false),
    onError: () => setPolling(true),
  },
);
```

同一 `(apiBase, types)` 的连接会被复用；最后一个订阅者退出时自动关闭。

### React Hook

```ts
import { useSseSubscription } from "./useSseSubscription";

const { connected, error } = useSseSubscription(
  apiBase,
  ["task:*"],
  (msg) => void refresh(),
  { enabled: open },
);
```

组件卸载自动取消订阅。

### 轮询回退

SSE 连接成功后应关闭原有轮询；断开或出错时按原间隔降级轮询。`LawmindTaskDrawer` 是当前示范：

```ts
useEffect(() => {
  if (!open || sseConnected) return;
  const t = window.setInterval(() => void refresh(), 8_000);
  return () => window.clearInterval(t);
}, [open, sseConnected]);
```

## 连接参数

- 路由：`GET /api/events`
- 鉴权：走本地 Bearer token（与 `apiAuthHeaders()` 一致）
- 订阅类型：query `?types=fs:change,task:*` 或 header `x-lawmind-sse-types`
- 客户端 ID：query `?clientId=xxx` 或 header `x-lawmind-sse-client-id`
- 重连时可选带 `?lastEventId=xxx` 或 `Last-Event-ID` 头
- 心跳：15 秒（`: heartbeat` 注释帧）
- 通配：`task:*` 匹配 `task:<id>:update` 等

## 实现文件

- `apps/lawmind-desktop/server/lawmind-sse-bus.ts` — 总线实现
- `apps/lawmind-desktop/server/lawmind-server-route-sse.ts` — `/api/events` 路由
- `apps/lawmind-desktop/src/renderer/sse-client.ts` — 原生 fetch SSE 客户端
- `apps/lawmind-desktop/src/renderer/useSseSubscription.ts` — React 订阅 hook
- `apps/lawmind-desktop/src/renderer/LawmindTaskDrawer.tsx` — 轮询替换示例

## 注意事项

1. 事件广播是**尽力而为**：server 进程内广播，跨进程（如 lawmindd 守护进程）的变更需后续补 IPC 或文件监听。
2. 不要在事件 payload 里放敏感内容（如文件内容、API key），只放变更标识和 ID。
3. 事件类型全部小写，使用 `:` 作为命名空间分隔符。
4. 写失败时总线会自动关闭客户端并清理，业务路由无需处理。
