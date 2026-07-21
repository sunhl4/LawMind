import { describe, expect, it } from "vitest";
import { isPrivilegeSentinelEnabled, scanPrivilegeTip } from "./privilege-sentinel.js";

describe("privilege-sentinel", () => {
  it("flags privilege markers and respects disable", () => {
    expect(scanPrivilegeTip("本函为 attorney-client privileged 材料").code).toBe(
      "privilege_marker",
    );
    expect(scanPrivilegeTip("普通催告函")).toBeNull();
    expect(isPrivilegeSentinelEnabled({ env: { LAWMIND_PRIVILEGE_SENTINEL: "0" } })).toBe(false);
    expect(isPrivilegeSentinelEnabled({ policy: { privilegeSentinel: false } })).toBe(false);
  });
});
