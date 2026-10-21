import { describe, expect, it, vi } from "vitest";
import { sampleModelDecision } from "./sampling-loop.js";

describe("shared model decision sampling", () => {
  it("retries an empty choice once and preserves one shared flag across rounds", async () => {
    const sample = vi
      .fn()
      .mockResolvedValueOnce({ choices: [] })
      .mockResolvedValueOnce({ choices: [{ finish_reason: "stop" }] });
    const flags = { emptyChoiceRetryUsed: false };
    await sampleModelDecision({ sample, toolsAdvertised: true, flags });
    expect(sample).toHaveBeenCalledTimes(2);
    expect(flags.emptyChoiceRetryUsed).toBe(true);
    sample.mockResolvedValue({ choices: [] });
    await expect(sampleModelDecision({ sample, toolsAdvertised: true, flags })).rejects.toThrow(
      "Empty response",
    );
    expect(sample).toHaveBeenCalledTimes(3);
  });
  it("counts every response without converting a failed sample to a completion", async () => {
    const onResponse = vi.fn();
    const sample = vi
      .fn()
      .mockResolvedValueOnce({ choices: [] })
      .mockRejectedValueOnce(new Error("network failed"));
    await expect(
      sampleModelDecision({
        sample,
        toolsAdvertised: false,
        flags: { emptyChoiceRetryUsed: false },
        onResponse,
      }),
    ).rejects.toThrow("network failed");
    expect(onResponse).toHaveBeenCalledTimes(1);
  });
});
