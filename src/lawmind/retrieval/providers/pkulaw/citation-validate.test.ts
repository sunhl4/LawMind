import { describe, expect, it, vi } from "vitest";
import {
  isAuthorityCitationValidateEnabled,
  validateCitationsWithAuthority,
} from "./citation-validate.js";

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

  it("posts citations when enabled", async () => {
    const prevFlag = process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE;
    const prevEp = process.env.LAWMIND_AUTHORITY_ENDPOINT;
    process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE = "1";
    process.env.LAWMIND_AUTHORITY_ENDPOINT = "https://authority.example/search";
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
      if (prevFlag === undefined) {
        delete process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE;
      } else {
        process.env.LAWMIND_AUTHORITY_CITATION_VALIDATE = prevFlag;
      }
      if (prevEp === undefined) {
        delete process.env.LAWMIND_AUTHORITY_ENDPOINT;
      } else {
        process.env.LAWMIND_AUTHORITY_ENDPOINT = prevEp;
      }
    }
  });
});
