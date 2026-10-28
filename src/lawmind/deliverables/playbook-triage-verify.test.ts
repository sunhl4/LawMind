import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  triageWithVerifiedEvidence,
  verifyPlaybookObservations,
} from "./playbook-triage-verify.js";
import {
  describePlaybookTriage,
  type Playbook,
  type PlaybookEvidence,
  type PlaybookObservation,
} from "./playbook-triage.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-playbook-verify-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "materials"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "materials", "合同.md"),
    [
      "第一条 定义",
      "本合同所称服务指法律咨询服务。",
      "第二条 争议解决",
      "因本合同引起的争议，提交北京仲裁委员会仲裁。",
      "第三条 赔偿",
      "赔偿总额不超过合同金额。",
    ].join("\n"),
    "utf8",
  );
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function playbook(): Playbook {
  return {
    id: "prc.contract.general",
    name: "中国法合同审查（通用）",
    jurisdiction: "PRC",
    version: "1.0.0",
    stance: "偏委托方",
    acceptableRange: "责任上限不低于合同金额。",
    escalationTriggers: ["行政处罚"],
    criteria: [
      { id: "dispute_clause", kind: "green", title: "有争议解决条款" },
      { id: "liability_cap", kind: "green", title: "责任有上限" },
      { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
    ],
  };
}

function evidence(
  quote: string,
  locator: string,
  filePath = "materials/合同.md",
): PlaybookEvidence {
  return { quote, locator, filePath };
}

function pass(criterionId: string, evidenceValue: PlaybookEvidence): PlaybookObservation {
  return { criterionId, result: "PASS", evidence: evidenceValue };
}

const DISPUTE_QUOTE = "因本合同引起的争议，提交北京仲裁委员会仲裁。";
const CAP_QUOTE = "赔偿总额不超过合同金额。";

describe("verifyPlaybookObservations", () => {
  it("keeps a quote that re-reads inside the cited lines", async () => {
    const ws = workspace();
    const out = await verifyPlaybookObservations({
      workspaceDir: ws,
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence(CAP_QUOTE, "L6")),
      ],
    });
    expect(out.summary).toEqual({
      checked: 2,
      verified: 2,
      failed: 0,
      unverifiable: 0,
      uncheckedEvidence: 0,
    });
    expect(out.observations.every((observation) => observation.result === "PASS")).toBe(true);
  });

  it("downgrades a quote that is not at the cited lines", async () => {
    const ws = workspace();
    const out = await verifyPlaybookObservations({
      workspaceDir: ws,
      observations: [
        // 句子的子串也算原文；这里只核「在不在这一行」。
        pass("dispute_clause", evidence("提交北京仲裁委员会仲裁。", "L4")),
        // 句子在文件里，但位置写错：按位置核对就该核不上。
        pass("liability_cap", evidence(CAP_QUOTE, "L2")),
      ],
    });
    expect(out.summary.verified).toBe(1);
    expect(out.summary.failed).toBe(1);
    expect(out.observations.map((observation) => observation.result)).toEqual(["PASS", "FLAG"]);
    expect(out.observations[1]?.reasonZh).toContain("引用回读未通过");
  });

  it("downgrades a missing file and a quote without a file path", async () => {
    const ws = workspace();
    const out = await verifyPlaybookObservations({
      workspaceDir: ws,
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4", "materials/不存在.md")),
        {
          criterionId: "liability_cap",
          result: "PASS",
          evidence: { quote: CAP_QUOTE, locator: "L6" },
        },
      ],
    });
    expect(out.summary.failed).toBe(1);
    expect(out.summary.uncheckedEvidence).toBe(1);
    expect(out.checks[0]?.status).toBe("failed");
    expect(out.checks[1]?.status).toBe("unverifiable");
    expect(out.observations.map((observation) => observation.result)).toEqual(["FLAG", "FLAG"]);
  });

  it("keeps a FAIL with a verified quote, and leaves FLAG untouched", async () => {
    const ws = workspace();
    const out = await verifyPlaybookObservations({
      workspaceDir: ws,
      observations: [
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: evidence("本合同所称服务指法律咨询服务。", "L2"),
          reasonZh: "出现不符合剧本的表述。",
        },
        { criterionId: "liability_cap", result: "FLAG", reasonZh: "未核对" },
      ],
    });
    expect(out.summary.checked).toBe(1);
    expect(out.summary.verified).toBe(1);
    expect(out.summary.uncheckedEvidence).toBe(0);
    expect(out.observations.map((observation) => observation.result)).toEqual(["FAIL", "FLAG"]);
    expect(out.checks).toHaveLength(1);
    expect(out.checks[0]?.status).toBe("verified");
  });

  it("reads the same file and quote once even when two criteria cite it", async () => {
    const ws = workspace();
    const out = await verifyPlaybookObservations({
      workspaceDir: ws,
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence(DISPUTE_QUOTE, "L4")),
      ],
    });
    expect(out.summary.checked).toBe(1);
    expect(out.summary.verified).toBe(1);
    expect(out.checks).toHaveLength(2);
  });
});

describe("triageWithVerifiedEvidence", () => {
  it("turns an evidence-backed GREEN only after the quotes re-read", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: playbook(),
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence(CAP_QUOTE, "L6")),
        pass("unlimited_liability", evidence(CAP_QUOTE, "L6")),
      ],
    });
    expect(triage.verdict).toBe("GREEN");
    // 同一个文件 + 同一位置 + 同一句只回读一次。
    expect(triage.evidenceVerification?.checked).toBe(2);
    expect(triage.evidenceVerification?.verified).toBe(2);
  });

  it("refuses GREEN when one quote cannot be re-read", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: playbook(),
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence("赔偿总额不超过合同金额（改过的句子）。", "L6")),
        pass("unlimited_liability", evidence(CAP_QUOTE, "L6")),
      ],
    });
    expect(triage.verdict).toBe("YELLOW");
    expect(triage.evidenceVerification?.failed).toBe(1);
    const downgraded = triage.items.find((item) => item.criterionId === "liability_cap");
    expect(downgraded?.result).toBe("FLAG");
    expect(downgraded?.reasonZh).toContain("引用回读未通过");
  });

  it("keeps a verified FAIL on a red criterion as RED", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: playbook(),
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence(CAP_QUOTE, "L6")),
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: evidence("本合同所称服务指法律咨询服务。", "L2"),
        },
      ],
    });
    expect(triage.verdict).toBe("RED");
    expect(triage.evidenceVerification?.verified).toBe(3);
  });

  it("does not verify observations for criteria the playbook does not have", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: playbook(),
      observations: [pass("not_in_playbook", evidence(DISPUTE_QUOTE, "L4"))],
    });
    expect(triage.evidenceVerification?.checked).toBe(0);
    expect(triage.unknownCriterionIds).toEqual(["not_in_playbook"]);
  });

  it("returns the default basis and no verification when there is no playbook", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: null,
      observations: [pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4"))],
    });
    expect(triage.basis).toBe("default");
    expect(triage.verdict).toBe("YELLOW");
    expect(triage.evidenceVerification).toEqual({
      checked: 0,
      verified: 0,
      failed: 0,
      unverifiable: 0,
      uncheckedEvidence: 0,
    });
  });

  it("mentions the re-read counts in the lawyer-facing line", async () => {
    const ws = workspace();
    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ws,
      playbook: playbook(),
      observations: [
        pass("dispute_clause", evidence(DISPUTE_QUOTE, "L4")),
        pass("liability_cap", evidence("不存在的句子。", "L6")),
      ],
    });
    const line = describePlaybookTriage(triage);
    expect(line).toContain("引用核对：1 条已核、1 条对不上原文");
  });
});
