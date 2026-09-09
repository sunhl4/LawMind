import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

function parseSseTypes(input: string | null): string[] | undefined {
  if (!input?.trim()) {
    return undefined;
  }
  return input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseSseTypesFromSearch(searchParams: URLSearchParams): string[] | undefined {
  const all = searchParams.getAll("types");
  if (all.length === 0) {
    return undefined;
  }
  const out: string[] = [];
  for (const raw of all) {
    out.push(...(parseSseTypes(raw) ?? []));
  }
  return out.length > 0 ? out : undefined;
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return typeof raw === "string" ? raw : undefined;
}

export function handleSseRoute({ ctx, req, res, url, c }: LawmindRouteContext): boolean {
  if (req.method !== "GET" || url.pathname !== "/api/events") {
    return false;
  }
  const sseBus = ctx.sseBus;
  if (!sseBus) {
    res.writeHead(503, { "content-type": "application/json", ...c });
    res.end(JSON.stringify({ ok: false, error: "sse_bus_unavailable" }));
    return true;
  }
  const types =
    parseSseTypesFromSearch(url.searchParams) ??
    parseSseTypes(firstHeader(req.headers, "x-lawmind-sse-types"));
  const clientId =
    url.searchParams.get("clientId")?.trim() ||
    firstHeader(req.headers, "x-lawmind-sse-client-id")?.trim();
  const lastEventId =
    url.searchParams.get("lastEventId")?.trim() ||
    firstHeader(req.headers, "last-event-id")?.trim();

  // 注意：此处返回的关闭函数由 req/res 生命周期事件触发，调用方无需再显式调用。
  sseBus.handleConnection(req, res, c, { clientId, types, lastEventId });
  return true;
}
