import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGetJson, apiSendJson, messageFromOkFalseBody, userMessageFromApiError } from "./api-client.js";

describe("api-client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers message and appends hint for missing_api_key", () => {
    const t = userMessageFromApiError(503, {
      code: "missing_api_key",
      message: "Model API key not configured",
      error: "Model API key not configured",
    });
    expect(t).toContain("API 配置向导");
  });

  it("handles 401 with key wording", () => {
    const t = userMessageFromApiError(401, { message: "Unauthorized" });
    expect(t).toContain("API Key");
  });

  it("apiGetJson returns parsed json body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(apiGetJson<{ ok: boolean; value: number }>("http://127.0.0.1:1234", "/api/test")).resolves.toEqual({
      ok: true,
      value: 3,
    });
  });

  it("messageFromOkFalseBody joins message, error, and validation detail array", () => {
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

  it("apiGetJson throws with snippet when body is HTML", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><title>502</title></html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(apiGetJson("http://127.0.0.1:1234", "/api/test")).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 502,
    });
  });

  it("apiSendJson throws ApiRequestError with parsed body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "invalid_json", message: "invalid json body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      apiSendJson("http://127.0.0.1:1234", "/api/test", "POST", { hello: "world" }),
    ).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 400,
      body: {
        code: "invalid_json",
      },
    });
  });
});
