import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { recordDeadline } from "../application/services/deadline-service.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { persistDraft } from "../drafts/index.js";
import { writeMatterMailMessage } from "../platform/lawyer-automations.js";
import { compileIntakeBrief, confirmIntakeBrief, saveIntakeBrief } from "./intake-brief.js";
import { matterMaterialsDir } from "./matter-materials.js";
import {
  assembleMatterTimeline,
  buildMatterPulse,
  daysUntilIso,
  hearingCountdownLabel,
} from "./matter-pulse.js";

describe("matter pulse", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("aggregates identity, hearing countdown and empty live lists", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pulse-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, {
      matterId: "case-pulse",
      title: "买卖合同纠纷",
      matterKind: "litigation",
      clientId: "acme",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "case-pulse",
      counterparty: "乙公司",
      causeOfAction: "买卖合同纠纷",
    });
    const due = new Date();
    due.setDate(due.getDate() + 11);
    const dueAt = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}T09:00:00`;
    recordDeadline(workspaceDir, {
      matterId: "case-pulse",
      title: "开庭",
      dueAt,
      eventKind: "hearing",
    });
    const pulse = buildMatterPulse(workspaceDir, "case-pulse");
    expect(pulse?.title).toBe("买卖合同纠纷");
    expect(pulse?.counterparty).toBe("乙公司");
    expect(pulse?.causeOfAction).toBe("买卖合同纠纷");
    expect(pulse?.counts.deadlines).toBe(1);
    expect(pulse?.daysUntilHearing).toBe(11);
    expect(pulse?.timeline.some((row) => row.kind === "hearing" && row.title === "开庭")).toBe(
      true,
    );
    expect(pulse?.materials).toEqual([]);
    expect(pulse?.counts.materials).toBe(0);
    expect(hearingCountdownLabel(pulse?.daysUntilHearing ?? null)).toContain("11");
    expect(loadMatter(workspaceDir, "case-pulse")?.causeOfAction).toBe("买卖合同纠纷");
    expect(loadMatter(workspaceDir, "case-pulse")?.counterparty).toBe("乙公司");
    expect(pulse?.parties.map((row) => `${row.role}:${row.name}`)).toEqual([
      "client:acme",
      "counterparty:乙公司",
    ]);
  });

  it("prefers matter.json identity over a drifted CASE §1 parse", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pulse-json-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, {
      matterId: "case-ssot",
      title: "身份案",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "case-ssot",
      counterparty: "乙公司",
      causeOfAction: "买卖合同纠纷",
    });
    const casePath = path.join(workspaceDir, "cases", "case-ssot", "CASE.md");
    let raw = fs.readFileSync(casePath, "utf8");
    raw = raw.replace(/案由[:：][^\n]*/, "案由: 错误案由");
    raw = raw.replace(/对方当事人[:：][^\n]*/, "对方当事人: 错误对方");
    fs.writeFileSync(casePath, raw);
    const pulse = buildMatterPulse(workspaceDir, "case-ssot");
    expect(pulse?.causeOfAction).toBe("买卖合同纠纷");
    expect(pulse?.counterparty).toBe("乙公司");
  });

  it("does not resurrect a cleared JSON identity from CASE", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pulse-clear-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, {
      matterId: "case-clear",
      title: "清空案",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "case-clear",
      counterparty: "乙公司",
      causeOfAction: "买卖合同纠纷",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "case-clear",
      counterparty: "",
      causeOfAction: "",
    });
    expect(loadMatter(workspaceDir, "case-clear")?.causeOfAction).toBeUndefined();
    expect(loadMatter(workspaceDir, "case-clear")?.counterparty).toBeUndefined();
    const pulse = buildMatterPulse(workspaceDir, "case-clear");
    expect(pulse?.causeOfAction).toBeUndefined();
    expect(pulse?.counterparty).toBeUndefined();
  });

  it("lists materials by mtime and assembles a read-only timeline from live stores", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pulse-tl-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, {
      matterId: "case-tl",
      title: "时间线案",
      matterKind: "litigation",
    });
    const due = new Date("2026-09-20T09:00:00");
    recordDeadline(workspaceDir, {
      matterId: "case-tl",
      title: "开庭",
      dueAt: "2026-09-20T09:00:00",
      eventKind: "hearing",
    });
    writeMatterMailMessage(workspaceDir, "case-tl", {
      id: "mail-reply",
      from: "王敏 <wang@example.com>",
      to: "chen@firm.example",
      subject: "今晚代理意见请尽快确认",
      receivedAt: "2026-09-09T08:22:00",
      bodyText: "陈律师，请今日回复要点。",
      attachments: [],
    });
    persistDraft(workspaceDir, {
      taskId: "draft-complaint",
      matterId: "case-tl",
      title: "民事起诉状",
      output: "docx",
      templateId: "litigation/complaint",
      summary: "解除合同并返还定金。",
      sections: [{ heading: "诉讼请求", body: "解除合同。" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-08T10:00:00",
    });
    const mats = matterMaterialsDir(workspaceDir, "case-tl");
    fs.mkdirSync(path.join(mats, "证据"), { recursive: true });
    fs.writeFileSync(path.join(mats, "合同.docx"), "scan");
    fs.writeFileSync(path.join(mats, "证据", "发票.pdf"), "pdf");
    const pulse = buildMatterPulse(workspaceDir, "case-tl", due);
    expect(pulse?.materials.map((row) => row.relPath).toSorted()).toEqual([
      "materials/合同.docx",
      "materials/证据/发票.pdf",
    ]);
    expect(pulse?.counts.materials).toBe(2);
    expect(pulse?.timeline.map((row) => row.kind)).toEqual(["hearing", "mail", "document"]);
    expect(pulse?.timeline[0]?.title).toBe("开庭");
    expect(pulse?.timeline.some((row) => row.title === "民事起诉状")).toBe(true);
    expect(pulse?.timeline.some((row) => row.kind === "task")).toBe(false);
  });
});

describe("assembleMatterTimeline", () => {
  it("sorts newest first, skips invalid stamps, and caps the list", () => {
    const rows = assembleMatterTimeline({
      deadlines: [
        {
          deadlineId: "d1",
          title: "举证",
          dueAt: "not-a-date",
          status: "open",
          daysUntil: null,
        },
        {
          deadlineId: "d2",
          title: "开庭",
          dueAt: "2026-09-20T09:00:00",
          status: "open",
          eventKind: "hearing",
          daysUntil: 11,
        },
      ],
      mail: [
        {
          id: "m1",
          subject: "请回复",
          from: "a@b.c",
          receivedAt: "2026-09-09T08:00:00",
          label: "needs_reply",
          labelZh: "待回复",
        },
      ],
      documents: [{ id: "t-dup", title: "起诉状", status: "待审核", at: "2026-09-08T10:00:00" }],
      tasks: [
        {
          taskId: "t-dup",
          title: "起草起诉状",
          status: "drafted",
          updatedAt: "2026-09-08T11:00:00",
        },
        {
          taskId: "t-open",
          title: "冲突检索",
          status: "researching",
          updatedAt: "2026-09-07T09:00:00",
        },
      ],
      approvals: [{ approvalId: "ap1", reason: "外发函", requestedAt: "2026-09-10T12:00:00" }],
      intakeConfirmedAt: "bad",
      cap: 3,
    });
    expect(rows.map((row) => row.kind)).toEqual(["hearing", "approval", "mail"]);
    expect(rows.some((row) => row.kind === "task" && row.id === "task:t-dup")).toBe(false);
  });

  it("keeps a distinct open task when it is not already a draft", () => {
    const rows = assembleMatterTimeline({
      deadlines: [],
      mail: [],
      documents: [],
      tasks: [
        {
          taskId: "t-open",
          title: "冲突检索",
          status: "researching",
          updatedAt: "2026-09-07T09:00:00",
        },
      ],
      approvals: [],
      intakeConfirmedAt: "2026-09-01T09:00:00",
    });
    expect(rows.map((row) => row.kind)).toEqual(["task", "intake"]);
  });
});

describe("daysUntilIso", () => {
  it("counts whole local days", () => {
    expect(daysUntilIso("1999-01-01T00:00:00", new Date("1999-01-01T18:00:00"))).toBe(0);
  });
});

describe("confirmIntakeBrief", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("stamps confirmedAt", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-brief-"));
    tmp.push(workspaceDir);
    const brief = compileIntakeBrief({
      matterId: "m1",
      workspaceDir,
      transcript: "客户希望解除合同。已付定金未交货。",
    });
    await saveIntakeBrief(workspaceDir, brief);
    const confirmed = await confirmIntakeBrief(workspaceDir, "m1");
    expect(confirmed?.confirmedAt).toBeTruthy();
  });
});
