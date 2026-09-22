import { afterEach, describe, expect, it } from "vitest";
import {
  callModelWithRetry,
  combineAbortSignals,
  ModelCallHttpError,
  ModelCallUserAbortError,
  TOOL_PAIRING_REPAIR_HINT,
} from "./runtime-model-call.js";
import { cassetteAssistant, cassetteHttpError, startCassetteModelServer } from "./testkit/index.js";

const PAIRING_REJECT_BODY = JSON.stringify({
  error: {
    message:
      "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
    type: "invalid_request_error",
    param: null,
    code: "invalid_request_error",
  },
});

describe("combineAbortSignals", () => {
  it("wasUserAbort becomes true when external signal aborts", async () => {
    const external = new AbortController();
    const combined = combineAbortSignals(60_000, external.signal);
    expect(combined.wasUserAbort()).toBe(false);
    external.abort();
    expect(combined.signal.aborted).toBe(true);
    expect(combined.wasUserAbort()).toBe(true);
    combined.cleanup();
  });

  it("timeoutMs 0 does not auto-abort without external signal", async () => {
    const combined = combineAbortSignals(0);
    await new Promise((r) => setTimeout(r, 30));
    expect(combined.signal.aborted).toBe(false);
    combined.cleanup();
  });

  it("ModelCallUserAbortError has stable name", () => {
    const err = new ModelCallUserAbortError();
    expect(err.name).toBe("ModelCallUserAbortError");
    expect(err.message).toMatch(/cancelled|stop/i);
  });
});

describe("ModelCallHttpError", () => {
  it("flags a tool-pairing 400 but not other failures", () => {
    expect(new ModelCallHttpError(400, PAIRING_REJECT_BODY, "x").isToolPairingReject).toBe(true);
    expect(
      new ModelCallHttpError(400, '{"error":{"message":"Invalid temperature"}}', "x")
        .isToolPairingReject,
    ).toBe(false);
    // 只有 400 才走自愈；5xx 不能按「配对损坏」处理。
    expect(new ModelCallHttpError(500, PAIRING_REJECT_BODY, "x").isToolPairingReject).toBe(false);
  });

  it("exposes a repair hint in the thrown message", () => {
    expect(TOOL_PAIRING_REPAIR_HINT).toContain("自动修复历史并重发");
  });
});

describe("wire-level tool pairing guard", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  const config = (url: string) => ({
    provider: "openai-compatible" as const,
    baseUrl: url,
    apiKey: "k",
    model: "m",
    timeoutMs: 5_000,
    maxRetries: 0,
  });

  it("drops orphan results and fills missing outputs before the request leaves", async () => {
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteAssistant("ok"));

    await callModelWithRetry(
      config(server.url),
      [
        { role: "user", content: "hi" },
        { role: "tool", content: "{}", tool_call_id: "gone" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "live", type: "function", function: { name: "t", arguments: "{}" } }],
        },
      ],
      [],
    );

    const sent = server.requests[0]?.messages() ?? [];
    expect(sent.some((m) => m.role === "tool" && m.tool_call_id === "gone")).toBe(false);
    const synthetic = sent.find((m) => m.role === "tool" && m.tool_call_id === "live");
    expect(synthetic).toBeTruthy();
    expect(String(synthetic?.content)).toContain("已取消");
  });

  it("repairs and resends once on a pairing 400 without spending retry budget", async () => {
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteHttpError(400, PAIRING_REJECT_BODY), cassetteAssistant("repaired-ok"));

    const repaired = [{ role: "user" as const, content: "只剩可送出的一条" }];
    let repairCalls = 0;
    const response = await callModelWithRetry(
      config(server.url),
      [
        { role: "user", content: "hi" },
        { role: "tool", content: "{}", tool_call_id: "gone" },
      ],
      [],
      {
        onToolPairingReject: () => {
          repairCalls += 1;
          return repaired;
        },
      },
    );

    expect(response.choices[0]?.message.content).toBe("repaired-ok");
    expect(repairCalls).toBe(1);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.messages()).toEqual(repaired);
    // maxRetries=0，所以第二次请求只可能来自配对自愈。
    expect(server.remaining()).toBe(0);
  });

  it("surfaces the actionable hint when a pairing 400 cannot be healed", async () => {
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteHttpError(400, PAIRING_REJECT_BODY));

    await expect(
      callModelWithRetry(config(server.url), [{ role: "user", content: "hi" }], []),
    ).rejects.toThrow(/自动修复历史并重发/);
  });
});
