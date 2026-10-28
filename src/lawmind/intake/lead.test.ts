import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { attachIntakeItem } from "./filing.js";
import { acceptIntakeLead, setIntakeLeadStage } from "./lead.js";
import { getIntakeItem, listIntakeItems, readIntakeEvents, recordIntakeItem } from "./store.js";
import type { NewIntakeItem } from "./types.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-lead-"));
  dirs.push(dir);
  return dir;
}

function input(patch: Partial<NewIntakeItem> = {}): NewIntakeItem {
  return {
    channel: "email",
    externalKey: "email:acc-1:lead-1",
    receivedAt: "2026-10-26T02:00:00.000Z",
    from: { display: "李四 <li@newclient.test>", address: "li@newclient.test" },
    subject: "想咨询一起买卖合同纠纷",
    text: "我们这边有一批货被拒收，想做诉讼。",
    attachments: [],
    ...patch,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("intake new-case leads", () => {
  it("moves a lead to needs-info and conflict-pending without touching the item status", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, input()).item;

    const needsInfo = setIntakeLeadStage(dir, item.id, "needs_info", {
      note: "缺合同与送货单",
    });
    expect(needsInfo.ok).toBe(true);
    expect(getIntakeItem(dir, item.id)).toMatchObject({
      status: "pending",
      lead: { stage: "needs_info", by: "lawyer", note: "缺合同与送货单" },
    });

    expect(setIntakeLeadStage(dir, item.id, "conflict_pending").ok).toBe(true);
    expect(getIntakeItem(dir, item.id)?.lead?.stage).toBe("conflict_pending");
    expect(readIntakeEvents(dir).filter((event) => event.kind === "lead")).toHaveLength(2);
  });

  it("declining a lead also clears it from the pending queue", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, input()).item;

    expect(setIntakeLeadStage(dir, item.id, "declined").ok).toBe(true);
    expect(getIntakeItem(dir, item.id)).toMatchObject({
      status: "ignored",
      lead: { stage: "declined" },
    });
    expect(listIntakeItems(dir, { statuses: ["pending"] })).toHaveLength(0);

    // 婉拒后不能直接进入收案；要先重新打开。
    expect(acceptIntakeLead(dir, item.id, "李四买卖合同案").error).toBe("not_pending");
  });

  it("accepting a lead creates an intake-status matter and files the item into it", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, input()).item;
    setIntakeLeadStage(dir, item.id, "conflict_pending");

    const accepted = acceptIntakeLead(dir, item.id, "李四买卖合同案", {
      now: new Date("2026-10-26T03:00:00.000Z"),
    });

    expect(accepted.ok).toBe(true);
    const matter = loadMatter(dir, "李四买卖合同案");
    // 只进收案，不直接成为在办案件。
    expect(matter?.status).toBe("intake");
    expect(getIntakeItem(dir, item.id)).toMatchObject({
      status: "attached",
      filing: { matterId: "李四买卖合同案", by: "lawyer" },
      lead: { stage: "accepted", matterId: "李四买卖合同案" },
    });
    expect(fs.existsSync(path.join(dir, "cases", "李四买卖合同案", "mail", "inbox"))).toBe(true);
  });

  it("refuses to accept into an existing matter", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "既有案件", title: "既有案件" });
    const item = recordIntakeItem(dir, input()).item;

    expect(acceptIntakeLead(dir, item.id, "既有案件").error).toBe("matter_exists");
    expect(getIntakeItem(dir, item.id)?.status).toBe("pending");
  });

  it("requires a valid matter name from the lawyer", () => {
    const dir = workspace();
    const item = recordIntakeItem(dir, input()).item;

    expect(acceptIntakeLead(dir, item.id, "  ").error).toBe("invalid_matter_title");
    expect(acceptIntakeLead(dir, item.id, "../escape").error).toBe("invalid_matter_title");
    expect(getIntakeItem(dir, item.id)?.status).toBe("pending");
    expect(fs.existsSync(path.join(dir, "matters")), "无效名称不得留下案件目录").toBe(false);
  });

  it("does not open a lead on an already filed item", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "甲案", title: "甲案" });
    const item = recordIntakeItem(dir, input()).item;
    expect(attachIntakeItem(dir, item.id, "甲案", { by: "lawyer" }).ok).toBe(true);
    expect(setIntakeLeadStage(dir, item.id, "needs_info").error).toBe("not_pending");
  });
});
