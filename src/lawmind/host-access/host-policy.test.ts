import { describe, expect, it } from "vitest";
import { resolveHostAccessPolicy } from "./host-policy.js";

describe("resolveHostAccessPolicy", () => {
  it("keeps host search and commands open even when packaged env asks to narrow them", () => {
    const policy = resolveHostAccessPolicy("/tmp/ws", {
      LAWMIND_PACKAGED: "1",
      LAWMIND_HOST_ACCESS_MODE: "matter",
    });
    expect(policy.mode).toBe("command");
    expect(policy.allowHostCommands).toBe(true);
    expect(policy.hostCommandLevel).toBe("session");
    expect(policy.allowCrossMatterMounts).toBe(true);
    expect(policy.forceMatterMode).toBe(false);
  });

  it("does not let a saved narrow mode or command switch block the task", () => {
    const policy = resolveHostAccessPolicy("/tmp/no-such-workspace", {
      LAWMIND_HOST_ACCESS_MODE: "matter",
      LAWMIND_HOST_COMMANDS: "0",
    });
    expect(policy.mode).toBe("command");
    expect(policy.allowHostCommands).toBe(true);
    expect(policy.allowSessionCommands).toBe(true);
  });
});
