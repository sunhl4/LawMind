import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchApi,
  fetchApiJson,
  ApiRequestError,
  messageFromOkFalseBody,
  setDefaultApiBaseForTests,
  setLoopbackApiAuthTokenForTests,
  getLoopbackApiAuthTokenForTests,
  setAuditEnabledForTests,
} from "./api-client-proxy.ts";

function jsonDetail(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

describe("api-client-proxy", () => {
  beforeEach(() => {
    setAuditEnabledForTests(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDefaultApiBaseForTests(null);
    setLoopbackApiAuthTokenForTests(null);
    setAuditEnabledForTests(true);
  });

  it("injects local API auth header when token is set", async () => {
    setLoopbackApiAuthTokenForTests("renderer-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await fetchApi("http://127.0.0.1:1234/api/test", { method: "GET" });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer renderer-token");
  });

  it("does not override explicit authorization header", async () => {
    setLoopbackApiAuthTokenForTests("renderer-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await fetchApi("http://127.0.0.1:1234/api/test", {
      headers: { authorization: "Bearer custom" },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer custom");
  });

  it("rejects non-local http by default", async () => {
    await expect(
      fetchApi("http://example.com/api/test", { method: "GET" }),
    ).rejects.toThrow(ApiRequestError);
  });

  it("rejects external https by default", async () => {
    await expect(
      fetchApi("https://api.openai.com/v1/models", { method: "GET" }),
    ).rejects.toThrow(ApiRequestError);
  });

  it("allows external https with allowExternal=true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      fetchApi("https://api.openai.com/v1/models", { method: "GET" }, { allowExternal: true }),
    ).resolves.toBeDefined();
  });

  it("allows non-local http with allowInsecure=true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await expect(
      fetchApi("http://example.com/api/test", { method: "GET" }, { allowInsecure: true }),
    ).resolves.toBeDefined();
  });

  it("resolves relative paths against default local base", async () => {
    setDefaultApiBaseForTests("http://127.0.0.1:5555");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await fetchApi("/api/test", { method: "GET" });

    const requestUrl = fetchMock.mock.calls[0]?.[0] as string | Request;
    const url = typeof requestUrl === "string" ? requestUrl : requestUrl.url;
    expect(url).toBe("http://127.0.0.1:5555/api/test");
  });

  it("converts network error to ApiRequestError after retry", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(
      fetchApi("http://127.0.0.1:1234/api/test", {}, { maxRetries: 1 }),
    ).rejects.toThrow(ApiRequestError);
  });

  it("applies timeout and aborts slow responses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(new Response("ok", { status: 200 })),
            100_000,
          );
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          }
        }),
    );

    const promise = fetchApi("http://127.0.0.1:1234/api/test", {}, { timeoutMs: 50 });
    vi.advanceTimersByTime(100);
    await expect(promise).rejects.toThrow(ApiRequestError);
    vi.useRealTimers();
  });

  it("retries once on 502 then returns the response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 }),
    );

    const res = await fetchApi("http://127.0.0.1:1234/api/test", {}, { maxRetries: 1 });
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetchApiJson parses JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 7 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      fetchApiJson<{ value: number }>("http://127.0.0.1:1234/api/test"),
    ).resolves.toEqual({
      ok: true,
      value: 7,
    });
  });

  it("messageFromOkFalseBody joins validation detail array", () => {
    const t = messageFromOkFalseBody(
      {
        message: "Bad input",
        detail: [
          { loc: ["body", "matterId"], msg: "too short" },
          { loc: ["query", "x"], msg: "invalid" },
        ],
      },
      "fallback",
    );
    expect(t).toContain("Bad input");
    expect(t).toContain("body.matterId: too short");
    expect(t).toContain("query.x: invalid");
  });

  it("exposes loopback token setter for tests", () => {
    setLoopbackApiAuthTokenForTests("abc");
    expect(getLoopbackApiAuthTokenForTests()).toBe("abc");
    setLoopbackApiAuthTokenForTests(null);
    expect(getLoopbackApiAuthTokenForTests()).toBeNull();
  });

  it("emits outbound_http audit event after a successful fetch", async () => {
    setAuditEnabledForTests(true);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await fetchApi("http://127.0.0.1:1234/api/test", { method: "GET" }, { tag: "audit-test" });

    // 第二次 fetch 应为审计事件 POST。
    const auditCall = fetchMock.mock.calls[1];
    expect(auditCall).toBeDefined();
    const auditUrl =
      typeof auditCall[0] === "string" ? auditCall[0] : (auditCall[0] as Request).url;
    expect(auditUrl).toBe("http://127.0.0.1:1234/api/audit/event");
    const auditInit = auditCall[1];
    expect(auditInit?.method).toBe("POST");
    const body = JSON.parse((await new Response(auditInit?.body as BodyInit).text())) as Record<string, unknown>;
    expect(body.kind).toBe("outbound_http");
    expect(body.actor).toBe("lawyer");
    expect(body.taskId).toBe("renderer");
    const detail = jsonDetail(body.detail);
    expect(detail.method).toBe("GET");
    expect(detail.pathname).toBe("/api/test");
    expect(detail.status).toBe(200);
    expect(detail.tag).toBe("audit-test");
  });
});
