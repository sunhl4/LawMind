import { describe, expect, it } from "vitest";
import { checkNetworkAllowlist, hostnameFromUrl } from "./network-allowlist.js";

describe("network allowlist", () => {
  it("allows brave host when listed", () => {
    const r = checkNetworkAllowlist({
      policy: { schemaVersion: 1, networkAllowlist: ["api.search.brave.com"] },
      edition: "firm",
      hostname: "api.search.brave.com",
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks firm mode without allowlist", () => {
    const r = checkNetworkAllowlist({
      policy: { schemaVersion: 1 },
      edition: "firm",
      hostname: "api.search.brave.com",
    });
    expect(r.allowed).toBe(false);
  });

  it("parses hostname from URL", () => {
    expect(hostnameFromUrl("https://api.search.brave.com/res/v1/web/search")).toBe(
      "api.search.brave.com",
    );
  });
});
