import http from "node:http";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";

/**
 * 统一 SSE 事件总线。
 *
 * 设计约束：
 * - 单连接广播，客户端通过 query/header 声明订阅的事件类型（支持 `task:*` 通配）。
 * - 原生 `res.writeHead` + `text/event-stream` 实现，不依赖第三方库。
 * - 心跳 15 秒，写失败时自动关闭并清理。
 * - 测试可注入自定义 EventEmitter 作为事件源。
 */

export const LAWMIND_SSE_HEARTBEAT_MS = 15_000;
const SSE_REPLAY_LIMIT = 64;

export type SseEventType = string;

export type SseEventPayload = {
  type: SseEventType;
  data: unknown;
  eventId?: string;
};

export type SseClientSubscription = string;

type SseClient = {
  clientId: string;
  res: http.ServerResponse;
  subscriptions: Set<SseClientSubscription>;
  heartbeat: ReturnType<typeof setInterval>;
  closed: boolean;
};

function generateClientId(): string {
  return `lm-${randomBytes(8).toString("hex")}`;
}

function buildSseFrame(event: SseEventPayload, eventId: string): string {
  const data = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  return `id: ${eventId}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

function normalizeEventType(type: string): string {
  return type.trim().toLowerCase();
}

type RecentSseEvent = {
  id: string;
  type: string;
  frame: string;
};

export class LawmindSseBus {
  private clients = new Map<string, SseClient>();
  private emitter = new EventEmitter();
  private eventIdSeq = 0;
  private customSource: EventEmitter | null = null;
  private recentEvents: RecentSseEvent[] = [];

  /**
   * 测试注入：用外部 EventEmitter 作为事件源。
   * 外部应 emit `lawmind:sse` 事件并传入 SseEventPayload。
   */
  setEventSource(source: EventEmitter): () => void {
    if (this.customSource) {
      this.customSource.removeAllListeners("lawmind:sse");
    }
    this.customSource = source;
    const handler = (event: SseEventPayload) => this.emit(event);
    source.on("lawmind:sse", handler);
    return () => {
      source.off("lawmind:sse", handler);
      this.customSource = null;
    };
  }

  /**
   * 向所有匹配订阅的客户端广播事件。
   */
  emit(event: SseEventPayload): void {
    const normalizedType = normalizeEventType(event.type);
    const eventId = event.eventId ?? String(++this.eventIdSeq);
    const frame = buildSseFrame({ ...event, type: normalizedType }, eventId);
    this.recentEvents.push({ id: eventId, type: normalizedType, frame });
    if (this.recentEvents.length > SSE_REPLAY_LIMIT) {
      this.recentEvents.splice(0, this.recentEvents.length - SSE_REPLAY_LIMIT);
    }
    for (const client of this.clients.values()) {
      if (client.closed) {
        continue;
      }
      if (!this.matchesSubscription(client.subscriptions, normalizedType)) {
        continue;
      }
      try {
        const ok = client.res.write(frame);
        if (!ok) {
          // 背压：下次 drain 再继续；这里不做复杂流控，直接关闭避免拖垮。
          this.closeClient(client);
        }
      } catch {
        this.closeClient(client);
      }
    }
  }

  /**
   * 处理 `/api/events` SSE 连接。
   * 返回关闭函数，供路由在请求关闭时调用。
   */
  handleConnection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    c: Record<string, string>,
    opts?: { clientId?: string; types?: string[]; lastEventId?: string },
  ): () => void {
    const clientId = opts?.clientId?.trim() || generateClientId();
    const subscriptions = new Set<SseClientSubscription>(
      (opts?.types ?? ["*"]).map((t) => normalizeEventType(t)).filter(Boolean),
    );

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...c,
    });

    const connectedId = String(++this.eventIdSeq);
    res.write(
      buildSseFrame(
        { type: "connected", data: { clientId, subscriptions: Array.from(subscriptions) } },
        connectedId,
      ),
    );

    const heartbeat = setInterval(() => {
      const client = this.clients.get(clientId);
      if (!client || client.closed) {
        clearInterval(heartbeat);
        return;
      }
      try {
        const ok = client.res.write(": heartbeat\n\n");
        if (!ok) {
          this.closeClient(client);
        }
      } catch {
        this.closeClient(client);
      }
    }, LAWMIND_SSE_HEARTBEAT_MS);

    const client: SseClient = {
      clientId,
      res,
      subscriptions,
      heartbeat,
      closed: false,
    };
    this.clients.set(clientId, client);
    this.replaySince(client, opts?.lastEventId);

    const cleanup = () => this.closeClient(client);
    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);

    return cleanup;
  }

  private replaySince(client: SseClient, lastEventId?: string): void {
    const cursor = lastEventId?.trim();
    if (!cursor || client.closed) {
      return;
    }
    const idx = this.recentEvents.findIndex((e) => e.id === cursor);
    const slice = idx >= 0 ? this.recentEvents.slice(idx + 1) : this.recentEvents;
    for (const event of slice) {
      if (!this.matchesSubscription(client.subscriptions, event.type)) {
        continue;
      }
      try {
        const ok = client.res.write(event.frame);
        if (!ok) {
          this.closeClient(client);
          return;
        }
      } catch {
        this.closeClient(client);
        return;
      }
    }
  }

  private matchesSubscription(subscriptions: Set<SseClientSubscription>, type: string): boolean {
    for (const sub of subscriptions) {
      if (sub === type) {
        return true;
      }
      if (sub === "*") {
        return true;
      }
      // 支持 `task:*` 匹配 `task:abc:update` 等。
      if (sub.endsWith(":*") && type.startsWith(sub.slice(0, -1))) {
        return true;
      }
      // 支持 `task:*:update` 匹配 `task:abc:update`。
      if (sub.includes(":*")) {
        const pattern = sub.replace(/\*/g, "[^:]*");
        const re = new RegExp(`^${pattern}$`);
        if (re.test(type)) {
          return true;
        }
      }
    }
    return false;
  }

  private closeClient(client: SseClient): void {
    if (client.closed) {
      return;
    }
    client.closed = true;
    clearInterval(client.heartbeat);
    this.clients.delete(client.clientId);
    if (!client.res.writableEnded) {
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
  }

  /** 测试用：返回当前活跃连接数。 */
  getClientCount(): number {
    return this.clients.size;
  }

  /** 测试用：返回某个客户端的订阅类型。 */
  getClientSubscriptions(clientId: string): string[] | undefined {
    const client = this.clients.get(clientId);
    return client ? Array.from(client.subscriptions) : undefined;
  }
}

let globalSseBus: LawmindSseBus | null = null;

/** 获取或创建单进程级 SSE 总线实例。 */
export function getGlobalSseBus(): LawmindSseBus {
  if (!globalSseBus) {
    globalSseBus = new LawmindSseBus();
  }
  return globalSseBus;
}

/** 测试用：重置全局总线。 */
export function resetGlobalSseBusForTests(): void {
  globalSseBus = null;
}
