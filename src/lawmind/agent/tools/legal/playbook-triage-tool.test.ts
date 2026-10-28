import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveWorkspacePlaybook } from "../../../deliverables/playbook-store.js";
import type { Playbook } from "../../../deliverables/playbook-triage.js";
import { triageAgainstPlaybookTool } from "./playbook-triage-tool.js";

const dirs: string[] = [];
const QUOTE = "赔偿总额不超过合同金额。";

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function playbook(patch: Partial<Playbook> = {}): Playbook {
  return {
    id: "prc.contract.general",
    name: "中国法合同审查（通用）",
    jurisdiction: "PRC",
    version: "1.0.0",
    stance: "偏委托方",
    acceptableRange: "责任上限不低于合同金额。",
    escalationTriggers: ["行政处罚"],
    criteria: [
      { id: "liability_cap", kind: "green", title: "责任有上限" },
      { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
    ],
    ...patch,
  };
}

function workspace(withPlaybook = true, playbooks: Playbook[] = [playbook()]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-playbook-tool-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "materials"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "materials", "合同.md"),
    ["第一条 赔偿", QUOTE].join("\n"),
    "utf8",
  );
  if (withPlaybook) {
    for (const item of playbooks) {
      saveWorkspacePlaybook(dir, item);
    }
  }
  return dir;
}

function ctx(workspaceDir: string) {
  return { workspaceDir, sessionId: "s1", actorId: "test" };
}

function observations(quote: string) {
  return [
    {
      criterion_id: "liability_cap",
      result: "PASS",
      quote,
      locator: "L2",
      file_path: "materials/合同.md",
    },
    {
      criterion_id: "unlimited_liability",
      result: "PASS",
      quote,
      locator: "L2",
      file_path: "materials/合同.md",
    },
  ];
}

type ToolData = {
  verdict: string;
  basis: string;
  counts: { pass: number; flag: number; fail: number };
  evidenceVerification?: { checked: number; verified: number; failed: number };
  items: Array<{ criterionId: string; result: string; locator?: string }>;
  summary?: string;
  note?: string;
};

describe("triage_against_playbook tool", () => {
  it("returns GREEN only after the engine re-reads the quotes", async () => {
    const ws = workspace();
    const result = await triageAgainstPlaybookTool.execute(
      { observations: observations(QUOTE) },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    expect(data.verdict).toBe("GREEN");
    expect(data.basis).toBe("playbook");
    expect(data.counts).toEqual({ pass: 2, flag: 0, fail: 0 });
    expect(data.evidenceVerification).toMatchObject({ verified: 1 });
    expect(data.items).toEqual([]);
  });

  it("downgrades when a quote cannot be re-read and says so", async () => {
    const ws = workspace();
    const result = await triageAgainstPlaybookTool.execute(
      { observations: observations("赔偿总额不超过合同金额（改过）。") },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    expect(data.verdict).toBe("YELLOW");
    expect(data.items.filter((item) => item.result === "FLAG")).toHaveLength(2);
    expect(data.summary).toContain("引用核对");
  });

  it("returns RED with a note that only the lawyer can override", async () => {
    const ws = workspace();
    const result = await triageAgainstPlaybookTool.execute(
      {
        observations: [
          observations(QUOTE)[0],
          {
            criterion_id: "unlimited_liability",
            result: "FAIL",
            quote: QUOTE,
            locator: "L2",
            file_path: "materials/合同.md",
            reason: "出现无限责任表述。",
          },
        ],
      },
      ctx(ws),
    );
    const data = result.data as ToolData;
    expect(data.verdict).toBe("RED");
    expect(data.note).toContain("只能由律师");
  });

  it("falls back to basis=default when the workspace has no playbook", async () => {
    const ws = workspace(false);
    const result = await triageAgainstPlaybookTool.execute(
      { observations: observations(QUOTE) },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const data = result.data as ToolData;
    expect(data.verdict).toBe("YELLOW");
    expect(data.basis).toBe("default");
    expect(data.note).toContain("通用标准");
  });

  it("requires an explicit id when several playbooks exist", async () => {
    const ws = workspace(true, [
      playbook(),
      playbook({ id: "prc.contract.nda", name: "NDA 初审" }),
    ]);
    const ambiguous = await triageAgainstPlaybookTool.execute(
      { observations: observations(QUOTE) },
      ctx(ws),
    );
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toContain("prc.contract.general");
    expect(ambiguous.error).toContain("prc.contract.nda");

    const picked = await triageAgainstPlaybookTool.execute(
      { playbook_id: "prc.contract.nda", observations: observations(QUOTE) },
      ctx(ws),
    );
    expect(picked.ok).toBe(true);
    expect((picked.data as ToolData).basis).toBe("playbook");
  });

  it("rejects unknown ids and malformed observations", async () => {
    const ws = workspace();
    const unknown = await triageAgainstPlaybookTool.execute(
      { playbook_id: "prc.missing", observations: [] },
      ctx(ws),
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("没有找到剧本");

    const bad = await triageAgainstPlaybookTool.execute(
      { observations: [{ criterion_id: "liability_cap", result: "MAYBE" }] },
      ctx(ws),
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("参数不对");
  });
});
