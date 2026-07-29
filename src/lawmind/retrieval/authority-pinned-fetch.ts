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

/**
 * Returns a fetch-compatible function that pins each connection to a DNS-resolved
 * and SSRF-validated IP, defeating DNS rebinding between check and connect.
 */
export function createPinnedAuthorityFetch(opts?: { lookup?: AuthorityDnsLookupFn }): typeof fetch {
  const lookup = opts?.lookup ?? defaultLookup;
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
    const family = addrs.find((a) => a.address === pinnedIp)?.family ?? 4;
    const agent = isHttps
      ? new https.Agent({
          // Pin DNS: always resolve to the validated IP, ignoring real DNS at connect time.
          lookup: (
            _h: string,
            _o: unknown,
            cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
          ) => cb(null, pinnedIp, family),
          // Keep TLS SNI / cert validation against the original hostname (default).
        })
      : new http.Agent({
          lookup: (
            _h: string,
            _o: unknown,
            cb: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
          ) => cb(null, pinnedIp, family),
        });

    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body;

    return new Promise<Response>((resolve, reject) => {
      const req = isHttps
        ? https.request(
            url,
            { method, headers: headers as unknown as Record<string, string>, agent },
            onResponse,
          )
        : http.request(
            url,
            { method, headers: headers as unknown as Record<string, string>, agent },
            onResponse,
          );
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
        res.on("data", (c: Buffer) => chunks.push(c));
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
