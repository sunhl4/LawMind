/**
 * Microsoft Graph mail — config validation + mocked connect.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGraphMessages, sendGraphMail, testGraphMailConnection } from "./graph-mail.js";
import type { MailAccount } from "./mail-accounts.js";

const dirs: string[] = [];

function fetchCallUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function jsonBody(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function tmpRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-graph-mail-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("mail/graph-mail", () => {
  const baseAccount: MailAccount = {
    id: "acc-1",
    label: "M365",
    email: "lawyer@firm.com",
    provider: "graph",
    tenantId: "tenant-1",
    clientId: "client-1",
    graphMailbox: "lawyer@firm.com",
  };

  it("testGraphMailConnection fails when tenant/client missing", async () => {
    const root = tmpRoot();
    const r = await testGraphMailConnection({ ...baseAccount, tenantId: "", clientId: "" }, root);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("graph_tenant_client_required");
  });

  it("testGraphMailConnection fails when client secret missing", async () => {
    const root = tmpRoot();
    const r = await testGraphMailConnection(baseAccount, root);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_client_secret");
  });

  it("testGraphMailConnection succeeds with mocked token + inbox", async () => {
    const root = tmpRoot();
    process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = fetchCallUrl(input);
        if (url.includes("oauth2/v2.0/token")) {
          return Response.json({ access_token: "tok" });
        }
        if (url.includes("mailFolders/inbox")) {
          return Response.json({ totalItemCount: 3, displayName: "收件箱" });
        }
        return new Response("nope", { status: 404 });
      }),
    );
    const r = await testGraphMailConnection(baseAccount, root);
    expect(r.ok).toBe(true);
    expect(r.messageCount).toBe(3);
    delete process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET;
  });

  it("fetchGraphMessages maps Graph payload to FetchedMailMessage", async () => {
    const root = tmpRoot();
    process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = fetchCallUrl(input);
        if (url.includes("oauth2/v2.0/token")) {
          return Response.json({ access_token: "tok" });
        }
        if (url.includes("/messages")) {
          return Response.json({
            value: [
              {
                id: "m1",
                subject: "合同",
                from: { emailAddress: { address: "a@firm.com", name: "A" } },
                toRecipients: [{ emailAddress: { address: "lawyer@firm.com" } }],
                receivedDateTime: "2026-07-18T08:00:00Z",
                bodyPreview: "正文",
                hasAttachments: false,
              },
            ],
          });
        }
        return new Response("nope", { status: 404 });
      }),
    );
    const msgs = await fetchGraphMessages(baseAccount, root, { limit: 5 });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.subject).toBe("合同");
    expect(msgs[0]?.attachments.length).toBeGreaterThanOrEqual(0);
    delete process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET;
  });

  it("sendGraphMail posts sendMail when configured", async () => {
    const root = tmpRoot();
    process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET = "secret";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = fetchCallUrl(input);
      if (url.includes("oauth2/v2.0/token")) {
        return Response.json({ access_token: "tok" });
      }
      if (url.includes("/sendMail")) {
        return new Response(null, { status: 202 });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendGraphMail({ ...baseAccount, sendFormat: { fromName: "张三律师" } }, root, {
      to: "client@example.com",
      subject: "更新",
      body: "正文",
    });
    expect(r.ok).toBe(true);
    const sendCall = fetchMock.mock.calls.find((c) => fetchCallUrl(c[0]).includes("/sendMail"));
    const sentBody = jsonBody((sendCall?.[1] as RequestInit | undefined)?.body) as {
      message?: { from?: { emailAddress?: { name?: string } } };
    };
    expect(sentBody.message?.from?.emailAddress?.name).toBe("张三律师");
    delete process.env.LAWMIND_MAIL_GRAPH_CLIENT_SECRET;
  });
});
