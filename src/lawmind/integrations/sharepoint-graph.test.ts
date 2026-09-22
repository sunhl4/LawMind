import { describe, expect, it, vi, afterEach } from "vitest";
import { listSharePointDriveChildren } from "./sharepoint-graph.js";

describe("sharepoint-graph", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Graph children to integration documents", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("oauth2")) {
        return {
          ok: true,
          json: async () => ({ access_token: "tok" }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          value: [
            {
              name: "MSA.docx",
              size: 1024,
              lastModifiedDateTime: "2026-01-01T00:00:00Z",
              id: "item-1",
              webUrl: "https://contoso.sharepoint.com/sites/legal/MSA.docx",
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listSharePointDriveChildren({
      tenantId: "tenant",
      clientId: "client",
      clientSecret: "secret",
      siteId: "site-abc",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents[0]?.name).toBe("MSA.docx");
      expect(result.documents[0]?.source).toBe("sharepoint");
      expect(result.documents[0]?.webUrl).toContain("sharepoint.com");
    }
  });
});
