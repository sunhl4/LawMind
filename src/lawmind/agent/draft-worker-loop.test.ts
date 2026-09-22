import { describe, expect, it } from "vitest";
import { extractWorkerToolCalls } from "./draft-worker-loop.js";

describe("extractWorkerToolCalls", () => {
  it("parses OpenAI-style function calls", () => {
    const calls = extractWorkerToolCalls({
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: "c1",
                function: { name: "search_statute", arguments: '{"query":"违约金"}' },
              },
            ],
          },
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("search_statute");
    expect(calls[0]?.arguments).toEqual({ query: "违约金" });
  });

  it("skips nameless calls and invalid JSON args", () => {
    const calls = extractWorkerToolCalls({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "", arguments: "{}" } },
              { id: "c2", function: { name: "list_dir", arguments: "not-json" } },
            ],
          },
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("list_dir");
    expect(calls[0]?.arguments).toEqual({});
  });
});
