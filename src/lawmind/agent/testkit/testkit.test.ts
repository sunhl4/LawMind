import { afterEach, describe, expect, it } from "vitest";
import { callModelWithRetry } from "../runtime-model-call.js";
import { cassetteAssistant, startCassetteModelServer, withTestLawMind } from "./index.js";

describe("cassette model server", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("renders JSON or SSE from the same semantic round and 400s when exhausted", async () => {
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteAssistant("hello-json"), cassetteAssistant("hello-sse"));

    const json = await callModelWithRetry(
      {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "k",
        model: "m",
        timeoutMs: 5_000,
        maxRetries: 0,
      },
      [{ role: "user", content: "hi" }],
      [],
    );
    expect(json.choices[0]?.message.content).toBe("hello-json");
    expect(server.requests[0]?.streamed).toBe(false);

    const streamed = await callModelWithRetry(
      {
        provider: "openai-compatible",
        baseUrl: server.url,
        apiKey: "k",
        model: "m",
        timeoutMs: 5_000,
        maxRetries: 0,
      },
      [{ role: "user", content: "hi" }],
      [],
      { stream: true },
    );
    expect(streamed.choices[0]?.message.content).toBe("hello-sse");
    expect(server.requests[1]?.streamed).toBe(true);

    await expect(
      callModelWithRetry(
        {
          provider: "openai-compatible",
          baseUrl: server.url,
          apiKey: "k",
          model: "m",
          timeoutMs: 5_000,
          maxRetries: 0,
        },
        [{ role: "user", content: "hi" }],
        [],
      ),
    ).rejects.toThrow(/cassette exhausted/);
  });

  it("does not consume a cassette round on GET or a non-completions path", async () => {
    const server = await startCassetteModelServer();
    servers.push(server);
    server.enqueue(cassetteAssistant("keep-me"));
    const wrongMethod = await fetch(`${server.url}/chat/completions`);
    expect(wrongMethod.status).toBe(404);
    const wrongPath = await fetch(`${server.url}/models`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(wrongPath.status).toBe(404);
    expect(server.remaining()).toBe(1);
    expect(server.requests).toHaveLength(0);
  });
});

describe("TestLawMindBuilder", () => {
  it("runs a real turn and captures advertised tools", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("本回合按交办执行。"));
        const result = await h.runTurn("继续不澄清。请直接说明下一步。");
        expect(result.turn.status).toBe("completed");
        expect(h.requests).toHaveLength(1);
        expect(h.request(0).hasAdvertisedTool("list_more_tools")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("analyze_document")).toBe(true);
        expect(h.request(0).hasAdvertisedTool("update_plan")).toBe(true);
      },
    );
  });

  it("工具轮不开上游流式，但 onEvent 仍收到整段 delta 补发", async () => {
    await withTestLawMind(
      (b) => b,
      async (h) => {
        h.enqueue(cassetteAssistant("流式收尾。"));
        const deltas: string[] = [];
        const result = await h.runTurn("继续不澄清。请直接回答。", {
          onEvent: (event) => {
            if (event.type === "delta") {
              deltas.push(event.text);
            }
          },
        });
        expect(result.reply).toContain("流式收尾");
        // 工具轮降噪设计（a763733dc 起）：广告了工具的决策轮不开上游 SSE，
        // 收齐后由 emitQuietSegment 把文本整段补发成一条 delta。
        expect(h.request(0).streamed).toBe(false);
        expect(deltas.join("")).toContain("流式收尾");
      },
    );
  });
});
