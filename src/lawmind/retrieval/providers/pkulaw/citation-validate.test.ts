import { describe, expect, it, vi } from "vitest";
import {
  isAuthorityCitationValidateEnabled,
  validateCitationsWithAuthority,
} from "./citation-validate.js";

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = prev;
  }
}

describe("citation-validate", () => {
  it("skips when flag off", async () => {
    expect(isAuthorityCitationValidateEnabled({ flag: "" })).toBe(false);
    const prev = process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE;
    delete process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE;
    try {
      const r = await validateCitationsWithAuthority({ citations: ["《民法典》第563条"] });
      expect(r.skipped).toBe(true);
      expect(r.ok).toBe(true);
    } finally {
      if (prev !== undefined) {
        process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE = prev;
      }
    }
  });

  it("skips official pkulaw MCP /validate unless a dedicated path is set", async () => {
    const prev = {
      flag: process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE,
      provider: process.env.LAWMIND_AUTHORITY_PROVIDER,
      mode: process.env.LAWMIND_PKULAW_MODE,
      path: process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH,
      endpoint: process.env.LAWMIND_AUTHORITY_ENDPOINT,
    };
    process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE = "1";
    process.env.LAWMIND_AUTHORITY_PROVIDER = "pkulaw";
    process.env.LAWMIND_PKULAW_MODE = "mcp_tools_call";
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://apim-gateway.example/mcp-law";
    delete process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH;
    try {
      const fetchImpl = vi.fn();
      const r = await validateCitationsWithAuthority({
        citations: ["《劳动合同法》第36条"],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.skipped).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.message).toContain("adjust_provisions");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      restoreEnv("LAWMIND_AUTHORITY_CITATION_VALIDATE", prev.flag);
      restoreEnv("LAWMIND_AUTHORITY_PROVIDER", prev.provider);
      restoreEnv("LAWMIND_PKULAW_MODE", prev.mode);
      restoreEnv("LAWMIND_AUTHORITY_CITATION_VALIDATE_PATH", prev.path);
      restoreEnv("LAWMIND_AUTHORITY_ENDPOINT", prev.endpoint);
    }
  });

  it("posts citations when enabled", async () => {
    const prevFlag = process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE;
    const prevEp = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    const prevProvider = process.env.LAWMIND_AUTHORITY_PROVIDER;
    const prevMode = process.env.LAWMIND_PKULAW_MODE;
    process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE = "1";
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://authority.example/search";
    process.env.LAWMIND_AUTHORITY_PROVIDER = "generic";
    delete process.env.LAWMIND_PKULAW_MODE;
    try {
      const fetchImpl = vi.fn(async () => Response.json({ ok: true, issues: [] }));
      const r = await validateCitationsWithAuthority({
        citations: ["《民法典》第563条"],
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(r.skipped).toBe(false);
      expect(r.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      restoreEnv("LAWMIND_AUTHORITY_CITATION_VALIDATE", prevFlag);
      restoreEnv("LAWMIND_AUTHORITY_ENDPOINT", prevEp);
      restoreEnv("LAWMIND_AUTHORITY_PROVIDER", prevProvider);
      restoreEnv("LAWMIND_PKULAW_MODE", prevMode);
    }
  });
});
