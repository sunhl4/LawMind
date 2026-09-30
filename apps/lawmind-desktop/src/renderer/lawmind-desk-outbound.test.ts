import { describe, expect, it } from "vitest";
import { outboundCountByMatter, pendingOutboundItems } from "./lawmind-desk-outbound";
import type { ActionSummaryPayload } from "./lawmind-requires-action";

describe("pending outbound", () => {
  it("keeps open sends for a matter and skips internal inbox rows", () => {
    const summary: ActionSummaryPayload = {
      automationInbox: [
        {
          id: "in-1",
          automationId: "a",
          matterId: "m1",
          title: "周报",
          summary: "",
          status: "open",
          createdAt: "t",
          pendingSend: {
            to: "a@b.com",
            subject: "本周",
            body: "请查收",
            attachmentRelativePaths: ["cases/m1/周报.docx"],
          },
        },
        {
          id: "in-2",
          automationId: "a",
          matterId: "m1",
          title: "已阅",
          summary: "",
          status: "done",
          createdAt: "t",
          pendingSend: { to: "a@b.com", subject: "旧", body: "" },
        },
        {
          id: "in-3",
          automationId: "a",
          matterId: "m2",
          title: "没有收件人",
          summary: "",
          status: "open",
          createdAt: "t",
        },
      ],
      toolApprovals: [
        {
          actionId: "act-1",
          sessionId: "s1",
          matterId: "m1",
          toolName: "send_email",
          title: "发送函",
          summary: "",
          toolArgs: { to: "c@d.com", subject: "函" },
          createdAt: "t",
        },
        {
          actionId: "act-2",
          sessionId: "s1",
          matterId: "m1",
          toolName: "write_document",
          title: "写",
          summary: "",
          createdAt: "t",
        },
      ],
    };
    const items = pendingOutboundItems(summary);
    expect(items.map((item) => item.id)).toEqual(["in-1", "act-1"]);
    expect(outboundCountByMatter(items).get("m1")).toBe(2);
    expect(outboundCountByMatter(items).has("m2")).toBe(false);
  });
});
