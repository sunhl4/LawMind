import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMemoryAdoptionWrite } from "./adoption-apply.js";
import { suggestMemoryAdoption } from "./adoption-service.js";
import { ensureLawyerProfileSkeleton } from "./lawyer-profile-learning.js";

describe("applyMemoryAdoptionWrite", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("writes case.progress to session-summary.md and CASE progress", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-apply-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "matter",
        kind: "case.progress",
        targetId: "matter-a",
        payload: "### 对话压缩沉淀（2026-07-22）\n\n律师：本案管辖条款需单独列出。\n助手：已记录。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.written.some((p) => p.includes("session-summary.md"))).toBe(true);
    const summary = fs.readFileSync(
      path.join(ws, "cases", "matter-a", "session-summary.md"),
      "utf8",
    );
    expect(summary).toContain("管辖条款");
    const caseMd = fs.readFileSync(path.join(ws, "cases", "matter-a", "CASE.md"), "utf8");
    expect(caseMd).toContain("工作进展记录");
  });

  it("writes lawyer.profile_learning into LAWYER_PROFILE.md", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-lawyer-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    await ensureLawyerProfileSkeleton(ws);
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "lawyer",
        kind: "lawyer.profile_learning",
        targetId: "lawyer",
        payload: "对话压缩沉淀：以后请用正式书面语气。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    await applyMemoryAdoptionWrite(ws, rec);
    const profile = fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8");
    expect(profile).toContain("正式书面语气");
  });

  it("writes historical.knowledge to memory/topics and habit to profile + preferences", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-hist-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    await ensureLawyerProfileSkeleton(ws);
    const knowledge = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "project",
        kind: "historical.knowledge",
        payload: "# 历史材料扫描\n\n- contract：2",
        origin: "engine",
      },
      { autoAdopt: false },
    );
    const habit = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "lawyer",
        kind: "lawyer.habit_pattern",
        payload: "审查「管辖」条款时，默认采用：提交北京仲裁委员会仲裁（5 次，已取最新改法）",
        origin: "engine",
      },
      { autoAdopt: false },
    );
    const kn = await applyMemoryAdoptionWrite(ws, knowledge);
    const hb = await applyMemoryAdoptionWrite(ws, habit);
    expect(kn.written).toContain("memory/topics/historical-scan.md");
    expect(
      fs.readFileSync(path.join(ws, "memory", "topics", "historical-scan.md"), "utf8"),
    ).toContain("contract：2");
    expect(hb.written).toContain("LAWYER_PROFILE.md");
    expect(fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8")).toContain("北京仲裁委员会");
    expect(fs.existsSync(path.join(ws, "lawmind", "lawyer-preferences.json"))).toBe(true);
    expect(hb.written).toContain("lawmind/stance/items.json");
    expect(fs.readFileSync(path.join(ws, "lawmind", "stance", "items.json"), "utf8")).toContain(
      "管辖",
    );
  });

  it("writes firm.preference into FIRM_PROFILE.md", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-firm-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "firm",
        kind: "firm.preference",
        payload: "对外函件须所内复核后再发。",
        origin: "lawyer",
      },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.written).toContain("FIRM_PROFILE.md");
    expect(fs.readFileSync(path.join(ws, "FIRM_PROFILE.md"), "utf8")).toContain("所内复核");
  });

  it("writes client.profile_note into clients/<id>/CLIENT_PROFILE.md", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-client-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "client",
        kind: "client.profile_note",
        targetId: "client-1",
        payload: "常年顾问单位，偏好简明函件。",
        origin: "lawyer",
      },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.noopReason).toBeUndefined();
    expect(out.written).toContain("clients/client-1/CLIENT_PROFILE.md");
    expect(
      fs.readFileSync(path.join(ws, "clients", "client-1", "CLIENT_PROFILE.md"), "utf8"),
    ).toContain("常年顾问单位");
  });

  it("writes opponent.note into playbooks/COURT_AND_OPPONENT_PROFILE.md", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-opp-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      {
        scope: "opponent",
        kind: "opponent.note",
        payload: "对方代理律师偏好拖延举证。",
        origin: "lawyer",
      },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.noopReason).toBeUndefined();
    expect(out.written).toContain("playbooks/COURT_AND_OPPONENT_PROFILE.md");
    expect(
      fs.readFileSync(path.join(ws, "playbooks", "COURT_AND_OPPONENT_PROFILE.md"), "utf8"),
    ).toContain("拖延举证");
  });

  it("无落盘面的 kind 如实返回 noopReason，不静默宣称已生效", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-noop-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const cases = [
      { scope: "project", kind: "project.note", payload: "项目级备注" },
      { scope: "matter", kind: "source.annotation", payload: "[来源 s1] 批注内容" },
    ] as const;
    for (const c of cases) {
      const rec = await suggestMemoryAdoption(ws, path.join(ws, "audit"), c, {
        autoAdopt: false,
      });
      const out = await applyMemoryAdoptionWrite(ws, rec);
      expect(out.written).toEqual([]);
      expect(out.noopReason).toBeTruthy();
    }
  });

  it("returns empty_payload noop instead of claiming adopted", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-empty-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      { scope: "lawyer", kind: "lawyer.profile_learning", payload: "   " },
      { autoAdopt: false },
    );
    const out = await applyMemoryAdoptionWrite(ws, rec);
    expect(out.written).toEqual([]);
    expect(out.noopReason).toBe("empty_payload");
  });

  it("habit payload that does not parse fails closed instead of adopting profile only", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-habit-miss-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const rec = await suggestMemoryAdoption(
      ws,
      path.join(ws, "audit"),
      { scope: "lawyer", kind: "lawyer.habit_pattern", payload: "这不是可解析的习惯句式" },
      { autoAdopt: false },
    );
    await expect(applyMemoryAdoptionWrite(ws, rec)).rejects.toThrow("stance_write_failed");
    expect(fs.existsSync(path.join(ws, "LAWYER_PROFILE.md"))).toBe(false);
  });

  it("review_label adopt writes labels and clears the learning-queue row", async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-adopt-label-"));
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    const { persistDraft } = await import("../drafts/index.js");
    const { enqueueLearningSuggestion, listLearningSuggestions } =
      await import("../learning/suggestion-queue.js");
    persistDraft(ws, {
      taskId: "task-label-1",
      title: "T",
      output: "docx",
      templateId: "default",
      summary: "s",
      sections: [],
      reviewNotes: [],
      reviewStatus: "approved",
      reviewedBy: "lawyer",
      reviewedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    await enqueueLearningSuggestion(ws, path.join(ws, "audit"), {
      taskId: "task-label-1",
      reviewStatus: "approved",
      labels: ["语气过弱"],
    });
    const pending = await import("./adoption-service.js").then((m) =>
      m.listPendingMemorySuggestions(ws),
    );
    const rec = pending.find((r) => r.kind === "review_label");
    expect(rec).toBeDefined();
    const out = await applyMemoryAdoptionWrite(ws, rec!, { auditDir: path.join(ws, "audit") });
    expect(out.noopReason).toBeUndefined();
    expect(out.written).toContain("LAWYER_PROFILE.md");
    expect(fs.readFileSync(path.join(ws, "LAWYER_PROFILE.md"), "utf8")).toContain("语气过弱");
    const still = await listLearningSuggestions(ws, "pending");
    expect(still).toHaveLength(0);
  });
});
