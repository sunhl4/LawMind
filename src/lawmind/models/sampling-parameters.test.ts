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
  it("does not send seed to unknown endpoints but still asks for JSON", () => {
    // JSON 模式对未知端点默认照发：真拒绝时调用方有 400 降级（guardian），
    // 悄悄去掉只会让模型回散文，审稿被静默跳过。seed 没有降级路径，才保持关闭。
    expect(
      resolveSamplingParameters({
        provider: "custom",
        model: "unknown",
        reproducible: true,
        responseFormat: { type: "json_object" },
      }),
    ).toEqual({ temperature: 0, response_format: { type: "json_object" } });
  });
});
