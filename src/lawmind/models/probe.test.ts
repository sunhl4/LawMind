import { describe, expect, it } from "vitest";
import { formatUpstreamProbeError, parseProbeErrorBody } from "./probe.js";

describe("parseProbeErrorBody", () => {
  it("returns error message from OpenAI-style error object", () => {
    expect(
      parseProbeErrorBody(
        JSON.stringify({
          error: { message: "Incorrect API key provided", type: "invalid_request_error" },
        }),
      ),
    ).toContain("Incorrect API key");
  });

  it("flags 200 responses without choices", () => {
    expect(parseProbeErrorBody(JSON.stringify({ id: "x", object: "chat.completion" }))).toContain(
      "choices",
    );
  });

  it("returns null for successful choice payload", () => {
    expect(
      parseProbeErrorBody(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      ),
    ).toBeNull();
  });
});

describe("formatUpstreamProbeError", () => {
  it("explains 401 as an invalid key, not a missing config", () => {
    const msg = formatUpstreamProbeError(401, '{"error":{"message":"Authentication Fails"}}', {
      model: "deepseek-flash",
      baseUrl: "https://api.deepseek.com/v1",
    });
    expect(msg).toContain("密钥无效或已过期");
    expect(msg).toContain("连接向导");
    expect(msg).not.toContain("deepseek-flash");
    expect(msg).not.toContain("http");
  });

  it("says 欠费 for an arrears body instead of the raw JSON", () => {
    const msg = formatUpstreamProbeError(
      400,
      '{"error":{"message":"Access denied, please make sure your account is in good standing","code":"Arrearage"}}',
      { model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    );
    expect(msg).toMatch(/欠费/);
    expect(msg).not.toContain("Arrearage");
    expect(msg).not.toContain("http");
  });
});
