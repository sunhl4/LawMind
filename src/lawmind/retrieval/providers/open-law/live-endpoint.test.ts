import { describe, expect, it } from "vitest";
import { assertOpenLawLiveEndpointSafe, validateOpenLawLiveEndpointUrl } from "./live-endpoint.js";

describe("open-law/live-endpoint", () => {
  it("rejects loopback unless allowLoopback", () => {
    expect(validateOpenLawLiveEndpointUrl("http://127.0.0.1:8081/api/search").ok).toBe(false);
    const ok = validateOpenLawLiveEndpointUrl("http://127.0.0.1:8081/api/search", {
      allowLoopback: true,
    });
    expect(ok.ok).toBe(true);
  });

  it("still rejects private LAN even with allowLoopback", () => {
    expect(
      validateOpenLawLiveEndpointUrl("http://192.168.1.10/api/search", { allowLoopback: true }).ok,
    ).toBe(false);
  });

  it("assert allows loopback without DNS when opted in", async () => {
    const r = await assertOpenLawLiveEndpointSafe("http://127.0.0.1:8081/api/search", {
      allowLoopback: true,
    });
    expect(r.ok).toBe(true);
  });
});
