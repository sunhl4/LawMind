import { describe, expect, it } from "vitest";
import { resolveSamplingParameters } from "./sampling-parameters.js";

describe("reproducible sampling parameters", () => {
  it("uses zero temperature and a stable seed only with a supporting provider", () => {
    expect(
      resolveSamplingParameters({
        provider: "openai",
        model: "gpt-test",
        reproducible: true,
        seed: 17,
        temperature: 0.8,
        responseFormat: { type: "json_object" },
      }),
    ).toEqual({
      temperature: 0,
      seed: 17,
      response_format: { type: "json_object" },
    });
    expect(
      resolveSamplingParameters({
        provider: "openai-compatible",
        model: "deepseek-flash",
        reproducible: true,
        seed: 17,
      }),
    ).toEqual({ temperature: 0 });
  });
  it("keeps unsupported parameters off unknown endpoints", () => {
    expect(
      resolveSamplingParameters({
        provider: "custom",
        model: "unknown",
        reproducible: true,
        responseFormat: { type: "json_object" },
      }),
    ).toEqual({ temperature: 0 });
  });
});
