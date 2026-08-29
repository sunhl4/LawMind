"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { probeModelInline } = require("./lawmind-model-probe.cjs");

void describe("lawmind-model-probe", () => {
  void it("rejects missing api key", async () => {
    const result = await probeModelInline({
      apiKey: "",
      baseUrl: "https://example.com/v1",
      model: "test",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "missing_api_key");
  });
});
