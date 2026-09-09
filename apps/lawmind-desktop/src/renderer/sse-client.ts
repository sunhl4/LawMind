import { fetchApi } from "./api-client-proxy";

/**
 * 统一 SSE 客户端（原生 fetch + ReadableStream）。
 *
 * 设计约束：
 * - EventSource 不能自定义 Authorization 头，本地 API 又要求 Bearer，所以用 fetch 手动解析 SSE 帧。
 * - 自动重连：指数退避，最大 30 秒。
 * - last-event-id：重连时传给服务端；服务端对最近事件做有界回放。
 * - 多订阅者共享同一连接：按 (apiBase, types) 聚合，同一 key 只维护一个 fetch 连接。
 */

export type SseMessage = {
  id?: string;
  type: string;
  data: unknown;
};

export type SseConnectionState = "connecting" | "open" | "closed" | "error";

export type SseSubscriber = {
  onMessage: (message: SseMessage) => void;
  onOpen?: () => void;
  onError?: () => void;
  onClose?: () => void;
};

type SseConnection = {
  apiBase: string;
  types: string[];
  controller: AbortController;
  state: SseConnectionState;
  subscribers: Set<SseSubscriber>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  lastEventId: string | null;
  closed: boolean;
};

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;

function scheduleTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout> {
  // 在浏览器 renderer 用 window.setTimeout，Node 测试环境回退到全局 setTimeout。
  const timer = typeof window !== "undefined" ? window.setTimeout(callback, ms) : setTimeout(callback, ms);
  return timer as ReturnType<typeof setTimeout>;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer === null) {
    return;
  }
  if (typeof window !== "undefined") {
    window.clearTimeout(timer);
  } else {
    clearTimeout(timer);
  }
}

const connections = new Map<string, SseConnection>();

function connectionKey(apiBase: string, types: string[]): string {
  return `${apiBase.replace(/\/$/, "")}|${types.toSorted().join(",")}`;
}

export function buildSseUrl(apiBase: string, types: string[], lastEventId: string | null): string {
  const base = apiBase.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (types.length > 0) {
    params.set("types", types.join(","));
  }
  if (lastEventId) {
    params.set("lastEventId", lastEventId);
  }
  const q = params.toString();
  return `${base}/api/events${q ? `?${q}` : ""}`;
}

function parseSseFrame(raw: string): SseMessage | null {
  const lines = raw.split("\n");
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
    // comment lines (e.g. `: heartbeat`) are ignored
  }
  if (!event) {
    return null;
  }
  const payload = dataLines.join("\n");
  try {
    return { id, type: event, data: payload ? (JSON.parse(payload) as unknown) : null };
  } catch {
    return { id, type: event, data: payload };
  }
}

function notifyOpen(conn: SseConnection): void {
  if (conn.state === "open") {
    return;
  }
  conn.state = "open";
  conn.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  for (const sub of conn.subscribers) {
    sub.onOpen?.();
  }
}

function notifyError(conn: SseConnection): void {
  conn.state = "error";
  for (const sub of conn.subscribers) {
    sub.onError?.();
  }
}

function notifyClose(conn: SseConnection): void {
  if (conn.state === "closed") {
    return;
  }
  conn.state = "closed";
  for (const sub of conn.subscribers) {
    sub.onClose?.();
  }
}

function notifyMessage(conn: SseConnection, message: SseMessage): void {
  for (const sub of conn.subscribers) {
    sub.onMessage(message);
  }
}

function scheduleReconnect(conn: SseConnection): void {
  if (conn.closed || conn.reconnectTimer) {
    return;
  }
  conn.reconnectTimer = scheduleTimer(() => {
    conn.reconnectTimer = null;
    if (!conn.closed) {
      void openConnection(conn);
    }
  }, conn.reconnectDelay);
  conn.reconnectDelay = Math.min(
    conn.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
    MAX_RECONNECT_DELAY_MS,
  );
}

function cleanupConnection(conn: SseConnection): void {
  conn.closed = true;
  clearTimer(conn.reconnectTimer);
  conn.reconnectTimer = null;
  try {
    conn.controller.abort();
  } catch {
    /* ignore */
  }
  connections.delete(connectionKey(conn.apiBase, conn.types));
  notifyClose(conn);
}

async function openConnection(conn: SseConnection): Promise<void> {
  if (conn.closed) {
    return;
  }
  conn.controller = new AbortController();
  conn.state = "connecting";
  const url = buildSseUrl(conn.apiBase, conn.types, conn.lastEventId);
  try {
    const res = await fetchApi(
      url,
      {
        headers: { accept: "text/event-stream" },
        signal: conn.controller.signal,
      },
      { timeoutMs: 0, tag: "sse-client" },
    );
    if (!res.ok || !res.body) {
      notifyError(conn);
      scheduleReconnect(conn);
      return;
    }
    notifyOpen(conn);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const message = parseSseFrame(frame);
          if (!message) {
            continue;
          }
          if (message.id) {
            conn.lastEventId = message.id;
          }
          notifyMessage(conn, message);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    notifyClose(conn);
    scheduleReconnect(conn);
  } catch {
    if (!conn.closed) {
      notifyError(conn);
      scheduleReconnect(conn);
    }
  }
}

/**
 * 订阅统一 SSE 流。返回取消订阅函数。
 * 同一 (apiBase, types) 的连接会被复用；最后一个订阅者退出时连接关闭。
 */
export function subscribeToSseStream(
  apiBase: string,
  types: string[],
  subscriber: SseSubscriber,
): () => void {
  const key = connectionKey(apiBase, types);
  let conn = connections.get(key);
  if (!conn) {
    conn = {
      apiBase,
      types: types.slice(),
      controller: new AbortController(),
      state: "connecting",
      subscribers: new Set(),
      reconnectTimer: null,
      reconnectDelay: INITIAL_RECONNECT_DELAY_MS,
      lastEventId: null,
      closed: false,
    };
    connections.set(key, conn);
    void openConnection(conn);
  }

  conn.subscribers.add(subscriber);
  if (conn.state === "open") {
    subscriber.onOpen?.();
  }

  return () => {
    conn.subscribers.delete(subscriber);
    if (conn.subscribers.size === 0) {
      cleanupConnection(conn);
    }
  };
}

/** 测试/调试用：获取当前活跃连接数。 */
export function getActiveSseConnectionCount(): number {
  return connections.size;
}

/** 测试用：重置所有连接。 */
export function resetSseConnectionsForTests(): void {
  for (const conn of connections.values()) {
    cleanupConnection(conn);
  }
  connections.clear();
}
