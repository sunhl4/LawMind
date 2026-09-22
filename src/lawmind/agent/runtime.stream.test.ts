import { describe, it, expect } from "vitest";
import { aggregateStreamChunks, parseSseChunks } from "./runtime.js";

describe("parseSseChunks", () => {
  it("splits well-formed events", () => {
    const buf = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n");
    const { events, done, rest } = parseSseChunks(buf);
    expect(events).toHaveLength(2);
    expect(events[0].choices?.[0].delta?.content).toBe("Hello");
    expect(events[1].choices?.[0].delta?.content).toBe(" world");
    expect(done).toBe(true);
    expect(rest).toBe("");
  });

  it("keeps trailing partial event in `rest`", () => {
    const buf = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
      "",
      "data: {",
    ].join("\n");
    const { events, rest, done } = parseSseChunks(buf);
    expect(events).toHaveLength(1);
    expect(done).toBe(false);
    expect(rest).toBe("data: {");
  });

  it("ignores comments / pings", () => {
    const buf = `: ping\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`;
    const { events } = parseSseChunks(buf);
    expect(events).toHaveLength(1);
  });

  it("skips malformed JSON", () => {
    const buf = `data: not-json\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: "y" } }] })}\n\n`;
    const { events } = parseSseChunks(buf);
    expect(events).toHaveLength(1);
  });
});

describe("aggregateStreamChunks", () => {
  it("concatenates content deltas", () => {
    const result = aggregateStreamChunks([
      { choices: [{ delta: { role: "assistant", content: "He" } }] },
      { choices: [{ delta: { content: "llo" } }] },
      { choices: [{ delta: { content: "!" }, finish_reason: "stop" }] },
    ]);
    expect(result.choices[0].message.content).toBe("Hello!");
    expect(result.choices[0].finish_reason).toBe("stop");
  });

  it("assembles tool_calls deltas across chunks", () => {
    const result = aggregateStreamChunks([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "search_law", arguments: '{"q":"' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '合同"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
    const tc = result.choices[0].message.tool_calls;
    expect(tc).toBeDefined();
    expect(tc?.[0].id).toBe("call_a");
    expect(tc?.[0].function.name).toBe("search_law");
    expect(tc?.[0].function.arguments).toBe('{"q":"合同"}');
    expect(result.choices[0].finish_reason).toBe("tool_calls");
  });

  it("captures usage when sent in the final chunk", () => {
    const result = aggregateStreamChunks([
      { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] },
      { usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } },
    ]);
    expect(result.usage?.prompt_tokens).toBe(10);
    expect(result.usage?.completion_tokens).toBe(1);
  });
});
