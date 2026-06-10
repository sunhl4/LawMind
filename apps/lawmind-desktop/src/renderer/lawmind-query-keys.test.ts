import { describe, expect, it } from "vitest";
import { lawmindQueryKeys } from "./lawmind-query-keys";

describe("lawmind-query-keys", () => {
  it("builds stable health key", () => {
    expect(lawmindQueryKeys.health("http://127.0.0.1:8765")).toEqual([
      "lawmind",
      "health",
      "http://127.0.0.1:8765",
    ]);
  });

  it("scopes matter detail by matterId", () => {
    const a = lawmindQueryKeys.matterDetail("http://x", "m1");
    const b = lawmindQueryKeys.matterDetail("http://x", "m2");
    expect(a).not.toEqual(b);
  });
});
