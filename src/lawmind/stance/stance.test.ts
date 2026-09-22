import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureStanceFromRedline,
  ensureFirmStanceDefaults,
  formatStanceHint,
  readStanceItems,
  selectInjectableStances,
  stanceSelfCheck,
  upsertStanceFromKeyModification,
  upsertStanceFromRedline,
  writeStanceFromHabit,
  writeStanceItems,
} from "./index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-stance-"));
  dirs.push(ws);
  return ws;
}

const JURISDICTION_HUNK = {
  before: "由甲方所在地人民法院管辖",
  after: "提交北京仲裁委员会仲裁",
  heading: "争议解决",
  status: "accepted" as const,
};

describe("stance library", () => {
  it("stores an accepted 管辖 hunk", () => {
    const ws = tmpWs();
    const item = upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    expect(item?.clauseType).toBe("管辖");
    expect(item?.preferredLanguage).toContain("北京仲裁委员会");
    expect(item?.source).toBe("redline");
    expect(item?.occurrences).toBe(1);
    // 来源权重：单案件一次红线接受 = 0.25（低权重，低于注入门槛）
    expect(item?.confidence).toBeCloseTo(0.25);
    expect(item?.evidence).toHaveLength(1);
    expect(item?.evidence?.[0]?.source).toBe("redline");
    expect(item?.evidence?.[0]?.matterId).toBeUndefined();
    expect(item?.supersededBy).toBeUndefined();
    const stored = readStanceItems(ws);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(item?.id);
    expect(stored[0]?.evidence).toHaveLength(1);
    expect(fs.existsSync(path.join(ws, "lawmind", "stance", "items.json"))).toBe(true);
  });

  it("keeps latest wording and supersedes the old item on conflict", () => {
    const ws = tmpWs();
    const first = upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    const second = upsertStanceFromRedline({
      workspaceDir: ws,
      hunk: {
        ...JURISDICTION_HUNK,
        after: "提交上海仲裁委员会仲裁",
      },
    });
    expect(second?.preferredLanguage).toContain("上海仲裁委员会");
    expect(second?.occurrences).toBe(2);
    expect(second?.id).not.toBe(first?.id);
    const items = readStanceItems(ws);
    const old = items.find((it) => it.id === first?.id);
    expect(old?.supersededBy).toBe(second?.id);
    expect(old?.preferredLanguage).toContain("北京仲裁委员会");
    const active = items.filter((it) => !it.supersededBy);
    expect(active).toHaveLength(1);
    expect(active[0]?.preferredLanguage).toContain("上海");
  });

  it("omits low-confidence items from formatStanceHint", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    writeStanceItems(ws, [
      {
        id: "st_low",
        clauseType: "保密",
        position: "保密期限三年",
        preferredLanguage: "保密期限三年",
        source: "manual",
        confidence: 0.3,
        occurrences: 10,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "st_ok",
        clauseType: "管辖",
        position: "北京仲裁",
        preferredLanguage: "提交北京仲裁委员会仲裁",
        source: "redline",
        confidence: 0.4,
        occurrences: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const hint = formatStanceHint(ws);
    expect(hint).toContain("已按你确认的条款立场");
    expect(hint).toContain("【管辖】");
    expect(hint).toContain("北京仲裁委员会");
    expect(hint).not.toContain("保密");
    expect(hint).not.toContain("st_low");
  });

  it("ignores a rejected hunk", () => {
    const ws = tmpWs();
    const item = upsertStanceFromRedline({
      workspaceDir: ws,
      hunk: { ...JURISDICTION_HUNK, status: "rejected" },
    });
    expect(item).toBeUndefined();
    expect(readStanceItems(ws)).toEqual([]);
    expect(
      captureStanceFromRedline({
        workspaceDir: ws,
        hunk: { ...JURISDICTION_HUNK, status: "pending" },
      }),
    ).toBeUndefined();
  });

  it("seeds firm defaults only on an empty store", () => {
    const ws = tmpWs();
    expect(ensureFirmStanceDefaults(ws)).toBeGreaterThan(0);
    expect(ensureFirmStanceDefaults(ws)).toBe(0);
    expect(readStanceItems(ws).some((it) => it.id.startsWith("firm_default_"))).toBe(true);
  });

  it("parses an adopted habit payload into stance", () => {
    const ws = tmpWs();
    const item = writeStanceFromHabit(
      ws,
      "审查「管辖」条款时，默认采用：提交北京仲裁委员会仲裁（5 次，已取最新改法）",
    );
    expect(item?.clauseType).toBe("管辖");
    expect(item?.source).toBe("habit_adopt");
    expect(item?.occurrences).toBe(5);
    // 工作区无红线文件可解析来源案件 → 单条无 matterId 证据，habit 权重 0.5
    expect(item?.confidence).toBeCloseTo(0.5);
    expect(item?.evidence).toHaveLength(1);
    expect(item?.preferredLanguage).toBe("提交北京仲裁委员会仲裁");
  });

  it("upserts KEY_MODIFICATIONS bullets that name a clause type", () => {
    const ws = tmpWs();
    const item = upsertStanceFromKeyModification({
      workspaceDir: ws,
      bullet: "管辖改为提交北京仲裁委员会仲裁",
    });
    expect(item?.clauseType).toBe("管辖");
    expect(item?.source).toBe("revision_pack");
    expect(item?.preferredLanguage).toContain("北京仲裁委员会");
    expect(
      upsertStanceFromKeyModification({ workspaceDir: ws, bullet: "将付款周期改为月结" }),
    ).toBeUndefined();
  });

  it("reports unused high-confidence stance without rewriting text", () => {
    const ws = tmpWs();
    // 来源权重下两次接受才越过 self-check 的 0.4 门槛（0.25 → 0.4375）
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK });
    const text = "争议解决由甲方所在地人民法院管辖。其余条款按约定履行。";
    const hits = stanceSelfCheck(ws, text);
    expect(hits.some((f) => f.ruleId === "stance.unapplied")).toBe(true);
    expect(text).toContain("甲方所在地人民法院");
    expect(stanceSelfCheck(ws, "短")).toEqual([]);
  });
});

/** CASE.md §1 基本信息，供 parseMatterCaseProfileFields 解析客户/对方。 */
function writeCaseParties(
  ws: string,
  matterId: string,
  clientId: string,
  counterparty: string,
): void {
  const dir = path.join(ws, "cases", matterId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "CASE.md"),
    [
      "# 案件档案",
      "",
      "## 1. 基本信息",
      "",
      `- matterId: ${matterId}`,
      `- 客户 / clientId: ${clientId}`,
      `- 对方当事人: ${counterparty}`,
      "",
      "## 2. 当事人",
      "",
      "- 甲方:",
      "",
    ].join("\n"),
    "utf8",
  );
}

/** 落一份 draft +  accepted 管辖红线，供 habit 证据解析来源案件。 */
function writeDraftWithAcceptedRedlines(
  ws: string,
  taskId: string,
  matterId: string,
  acceptedHunks: number,
): void {
  const dir = path.join(ws, "drafts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${taskId}.json`), JSON.stringify({ matterId }), "utf8");
  const hunks = Array.from({ length: acceptedHunks }, (_, i) => ({
    before: `由甲方所在地人民法院管辖（${taskId}-${i}）`,
    after: "提交北京仲裁委员会仲裁",
    heading: "争议解决",
    status: "accepted",
  }));
  fs.writeFileSync(path.join(dir, `${taskId}.redline.json`), JSON.stringify({ hunks }), "utf8");
}

describe("stance evidence ledger（证据账本）", () => {
  it("单案件 2 次接受不得注入全局系统提示词", () => {
    const ws = tmpWs();
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-a" });
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-a" });
    const item = readStanceItems(ws).find((it) => !it.supersededBy);
    expect(item?.occurrences).toBe(2);
    // 置信度本身已过旧门槛（0.4375 ≥ 0.4），拦截来自证据门槛而非置信度
    expect(item?.confidence).toBeGreaterThanOrEqual(0.4);
    expect(item?.evidence).toHaveLength(2);
    expect(formatStanceHint(ws)).toBe("");
    expect(formatStanceHint(ws, { matterId: "m-other" })).toBe("");
    const { items, skipped } = selectInjectableStances(ws);
    expect(items).toHaveLength(0);
    expect(skipped.some((s) => s.reason.startsWith("single_matter_evidence"))).toBe(true);
    // 同案召回豁免：证据来源案件自身的上下文仍可注入
    expect(formatStanceHint(ws, { matterId: "m-a" })).toContain("北京仲裁委员会");
  });

  it("≥2 个不同 matterId 的证据才允许注入", () => {
    const ws = tmpWs();
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-a" });
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-b" });
    const item = readStanceItems(ws).find((it) => !it.supersededBy);
    expect(item?.evidence?.map((e) => e.matterId)).toEqual(["m-a", "m-b"]);
    expect(formatStanceHint(ws)).toContain("北京仲裁委员会");
    expect(formatStanceHint(ws, { matterId: "m-c" })).toContain("北京仲裁委员会");
  });

  it("当前对方当事人曾是证据案件客户时不注入并记录原因", () => {
    const ws = tmpWs();
    writeCaseParties(ws, "m-a", "甲公司", "乙公司");
    writeCaseParties(ws, "m-b", "甲公司", "丙公司");
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-a" });
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-b" });
    // 当前案件：代理丁公司，对手是甲公司（证据全部来自甲公司的案件）
    writeCaseParties(ws, "m-c", "丁公司", "甲公司");
    expect(formatStanceHint(ws, { matterId: "m-c" })).toBe("");
    const { skipped } = selectInjectableStances(ws, { matterId: "m-c" });
    expect(skipped.some((s) => s.reason.startsWith("client_conflict"))).toBe(true);
  });

  it("证据集中于单一客户时降级：他案与全局不注入，同客户案件注入", () => {
    const ws = tmpWs();
    writeCaseParties(ws, "m-a", "甲公司", "乙公司");
    writeCaseParties(ws, "m-b", "甲公司", "丙公司");
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-a" });
    upsertStanceFromRedline({ workspaceDir: ws, hunk: JURISDICTION_HUNK, matterId: "m-b" });
    // 全局（无案件上下文）：单一客户证据不进全局提示词
    expect(formatStanceHint(ws)).toBe("");
    // 其他客户的案件：不注入
    writeCaseParties(ws, "m-d", "丁公司", "戊公司");
    expect(formatStanceHint(ws, { matterId: "m-d" })).toBe("");
    const { skipped } = selectInjectableStances(ws, { matterId: "m-d" });
    expect(skipped.some((s) => s.reason.startsWith("client_specific"))).toBe(true);
    // 同客户的新案件：注入
    writeCaseParties(ws, "m-e", "甲公司", "戊公司");
    expect(formatStanceHint(ws, { matterId: "m-e" })).toContain("北京仲裁委员会");
  });

  it("habit 证据按不同案件计数：单案件 5 次 hunk 不注入，跨案件才注入", () => {
    const ws = tmpWs();
    writeDraftWithAcceptedRedlines(ws, "t-1", "m-a", 5);
    const payload = "审查「管辖」条款时，默认采用：提交北京仲裁委员会仲裁（5 次，已取最新改法）";
    const first = writeStanceFromHabit(ws, payload);
    // 5 个 hunk 全部来自 m-a：证据仅 1 个案件
    expect(first?.evidence?.map((e) => e.matterId)).toEqual(["m-a"]);
    expect(first?.confidence).toBeCloseTo(0.5);
    expect(formatStanceHint(ws)).toBe("");
    // 第二个案件出现同类接受后再次采纳：证据覆盖 2 案 → 注入
    writeDraftWithAcceptedRedlines(ws, "t-2", "m-b", 1);
    const second = writeStanceFromHabit(ws, payload);
    expect(new Set(second?.evidence?.map((e) => e.matterId))).toEqual(new Set(["m-a", "m-b"]));
    expect(formatStanceHint(ws)).toContain("北京仲裁委员会");
  });

  it("无账本存量条目保持旧行为（仅按置信度门槛注入）", () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    writeStanceItems(ws, [
      {
        id: "st_legacy",
        clauseType: "管辖",
        position: "北京仲裁",
        preferredLanguage: "提交北京仲裁委员会仲裁",
        source: "redline",
        confidence: 0.4,
        occurrences: 1,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(formatStanceHint(ws)).toContain("北京仲裁委员会");
    expect(formatStanceHint(ws, { matterId: "m-x" })).toContain("北京仲裁委员会");
  });
});
