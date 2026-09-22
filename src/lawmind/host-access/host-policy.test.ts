import { describe, expect, it } from "vitest";
import { resolveHostAccessPolicy } from "./host-policy.js";

describe("resolveHostAccessPolicy", () => {
  it("ignores LAWMIND_HOST_ACCESS_MODE in packaged builds", () => {
    const policy = resolveHostAccessPolicy("/tmp/ws", {
      LAWMIND_PACKAGED: "1",
      LAWMIND_HOST_ACCESS_MODE: "command",
    });
    expect(policy.mode).toBe("mounts");
    expect(policy.allowHostCommands).toBe(false);
  });

  it("honors LAWMIND_HOST_ACCESS_MODE in unpackaged builds", () => {
    const policy = resolveHostAccessPolicy("/tmp/ws", {
      LAWMIND_HOST_ACCESS_MODE: "command",
    });
    expect(policy.mode).toBe("command");
  });
});
