import { describe, expect, it } from "vitest";
import { parseProbeErrorBody } from "./probe.js";

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
