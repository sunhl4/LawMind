import { describe, expect, it, vi, afterEach } from "vitest";
import { listSharePointDriveChildren } from "./sharepoint-graph.js";

/**
 * Graph 主机是模块常量，无法指向回环；出口代理又绕过 global fetch
 * （DNS pinning）。因此在代理模块这一传输缝注入脚本化 fetch——
 * token 换取与 children 映射保持真实。
 */
const { proxyFetchMock } = vi.hoisted(() => ({ proxyFetchMock: vi.fn() }));
vi.mock("../platform/outbound-proxy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/outbound-proxy.js")>();
  return { ...actual, createOutboundProxy: () => ({ fetch: proxyFetchMock }) };
});

describe("sharepoint-graph", () => {
  afterEach(() => {
    proxyFetchMock.mockReset();
  });

  it("maps Graph children to integration documents", async () => {
    proxyFetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("oauth2")) {
        return Response.json({ access_token: "tok" });
      }
      return Response.json({
        value: [
          {
            name: "MSA.docx",
            size: 1024,
            lastModifiedDateTime: "2026-01-01T00:00:00Z",
            id: "item-1",
            webUrl: "https://contoso.sharepoint.com/sites/legal/MSA.docx",
          },
        ],
      });
    });

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
