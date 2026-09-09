/**
 * 连接层 SSRF pin：把权威端点的 fetch 从「fetch 前 DNS 校验 + fetch 重新解析」
 * （存在 DNS rebinding TOCTOU）升级为「校验解析地址 → 用 node:http(s) Agent 的
 * 自定义 lookup 把连接锁定到已校验的 IP」。TLS 仍按原 hostname 校验证书。
 *
 * 仅用于**商业权威端点**（pkulaw/generic/LexEdge）——这些端点禁止 loopback/私网。
 * open-law 的 NPC / caseopen 有各自的 loopback 放行逻辑，不走本 pin。
 */
import http from "node:http";
import https from "node:https";
import {
  denyReasonForAuthorityIpAddress,
  denyReasonForAuthorityHostname,
  type AuthorityDnsLookupFn,
} from "./authority-url-guard.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function defaultLookup(hostname: string): Promise<Array<{ address: string; family?: number }>> {
  if (process.env.VITEST === "true") {
    void hostname;
    return Promise.resolve([{ address: "203.0.113.10", family: 4 }]);
  }
  return import("node:dns/promises").then((dns) =>
    dns.lookup(hostname, { all: true, verbatim: true }),
  );
}

/** 默认响应体上限（防权威端点异常放大导致整缓冲 OOM）。 */
export const DEFAULT_MAX_AUTHORITY_RESPONSE_BYTES = 8 * 1024 * 1024;

type AgentLookupCallback = {
  (err: NodeJS.ErrnoException | null, address: string, family: number): void;
  (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>): void;
};

/** Convert fetch HeadersInit into a plain object `http.request` can send. */
export function headersInitToNodeRecord(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Node 22+ Agent lookup may request `{ all: true }` (Happy Eyeballs).
 * Passing a bare IP string in that mode becomes `address.address === undefined`
 * → `Invalid IP address: undefined`.
 */
export function createPinnedAgentLookup(
  pinnedIp: string,
  family: 4 | 6,
): (hostname: string, options: unknown, callback?: AgentLookupCallback) => void {
  return (_hostname, options, callback) => {
    const cb = (typeof options === "function" ? options : callback) as
      | AgentLookupCallback
      | undefined;
    if (!cb) {
      return;
    }
    const opts = typeof options === "object" && options ? (options as { all?: boolean }) : {};
    if (opts.all) {
      cb(null, [{ address: pinnedIp, family }]);
      return;
    }
    cb(null, pinnedIp, family);
  };
}

/**
 * Returns a fetch-compatible function that pins each connection to a DNS-resolved
 * and SSRF-validated IP, defeating DNS rebinding between check and connect.
 */
export function createPinnedAuthorityFetch(opts?: {
  lookup?: AuthorityDnsLookupFn;
  maxResponseBytes?: number;
}): typeof fetch {
  const lookup = opts?.lookup ?? defaultLookup;
  const maxResponseBytes =
    opts?.maxResponseBytes && opts.maxResponseBytes > 0
      ? opts.maxResponseBytes
      : DEFAULT_MAX_AUTHORITY_RESPONSE_BYTES;
  return async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    const hostname = url.hostname;

    // Sync hostname deny (literal IPs, localhost, .local, …).
    const hostDeny = denyReasonForAuthorityHostname(hostname);
    if (hostDeny) {
      throw new Error(hostDeny);
    }

    // Resolve + validate; fail-closed on resolve failure / empty / private IP.
    let addrs: Array<{ address: string; family?: number }>;
    try {
      addrs = await lookup(hostname);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`权威端点 DNS 解析失败（fail-closed）：${detail}`, { cause: e });
    }
    if (!addrs.length) {
      throw new Error("权威端点 DNS 无解析结果（fail-closed）");
    }
    let pinnedIp = "";
    for (const row of addrs) {
      const ipDeny = denyReasonForAuthorityIpAddress(row.address);
      if (ipDeny) {
        throw new Error(`权威端点解析到不可达地址：${ipDeny}`);
      }
      if (!pinnedIp) {
        pinnedIp = row.address;
      }
    }
    if (!pinnedIp) {
      throw new Error("权威端点无可用解析地址（fail-closed）");
    }

    // Connect via node:http(s) with a custom-lookup Agent pinned to the validated IP.
    const isHttps = url.protocol === "https:";
    const family = addrs.find((a) => a.address === pinnedIp)?.family === 6 ? 6 : 4;
    const pinLookup = createPinnedAgentLookup(pinnedIp, family);
    const agent = isHttps
      ? new https.Agent({
          // Pin DNS: always resolve to the validated IP, ignoring real DNS at connect time.
          lookup: pinLookup,
          // Keep TLS SNI / cert validation against the original hostname (default).
        })
      : new http.Agent({
          lookup: pinLookup,
        });

    const method = init?.method ?? "GET";
    const headers = headersInitToNodeRecord(init?.headers);
    const body = init?.body;

    return new Promise<Response>((resolve, reject) => {
      const req = isHttps
        ? https.request(url, { method, headers, agent }, onResponse)
        : http.request(url, { method, headers, agent }, onResponse);
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) {
          req.destroy();
        } else {
          signal.addEventListener("abort", () => req.destroy(), { once: true });
        }
      }
      req.on("error", reject);
      if (body) {
        if (typeof body === "string" || body instanceof Uint8Array) {
          req.write(body);
        }
      }
      req.end();

      function onResponse(res: http.IncomingMessage): void {
        const chunks: Buffer[] = [];
        let received = 0;
        let abortedForSize = false;
        res.on("data", (c: Buffer) => {
          received += c.length;
          // 响应体上限：权威端点异常放大时立即断开，避免整缓冲 OOM。
          if (received > maxResponseBytes && !abortedForSize) {
            abortedForSize = true;
            res.destroy(new Error(`authority_response_too_large:>${maxResponseBytes}`));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const respHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) {
              for (const item of v) {
                if (item != null) {
                  respHeaders.append(k, item);
                }
              }
            } else if (v != null) {
              respHeaders.set(k, v);
            }
          }
          const status = res.statusCode ?? 0;
          resolve(new Response(buf, { status, headers: respHeaders }));
        });
        res.on("error", reject);
      }
    });
  };
}
