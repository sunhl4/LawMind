import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HUMAN_BASELINE_MIN_CASES,
  buildBlindPacket,
  classifyBaselinePair,
  compareSides,
  guessTaskType,
  inspectHumanBaselineGate,
  lawmindIsSideA,
  loadHumanBaselineCase,
  readBlindLabel,
  scoreSide,
  runHumanBaseline,
  writeHumanBaselineRubricDrafts,
  type BaselineRubric,
} from "./human-baseline.js";

const tmpDirs: string[] = [];

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-hb-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function writeCase(
  root: string,
  caseId: string,
  input: {
    lawyer: string;
    lawmind: string;
    rubric?: BaselineRubric;
    instruction?: string;
    blindPreferred?: "A" | "B" | "tie";
  },
): void {
  const dir = path.join(root, alreadyDir(root), caseId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "lawyer.md"), `${input.lawyer}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "lawmind.md"), `${input.lawmind}\n`, "utf8");
  const rubric: BaselineRubric = input.rubric ?? {
    taskType: "structured_drafting",
    criteria: [
      { id: "c1", label: "违约责任", anyOf: ["违约责任"] },
      { id: "c2", label: "管辖", anyOf: ["管辖"] },
    ],
  };
  fs.writeFileSync(path.join(dir, "rubric.json"), `${JSON.stringify(rubric, null, 2)}\n`, "utf8");
  if (input.instruction) {
    fs.writeFileSync(path.join(dir, "instruction.md"), `${input.instruction}\n`, "utf8");
  }
  if (input.blindPreferred) {
    fs.writeFileSync(
      path.join(dir, "blind-labels.json"),
      `${JSON.stringify({ rater: "partner-a", preferred: input.blindPreferred }, null, 2)}\n`,
      "utf8",
    );
  }
}

/** Fixture root is the parent of the human-baseline dir. */
function alreadyDir(_root: string): string {
  return path.join("fixtures", "lawmind-human-baseline");
}

describe("inspectHumanBaselineGate", () => {
  it("skips honestly when the fixture dir is absent", () => {
    const root = makeRoot();
    const gate = inspectHumanBaselineGate(root);
    expect(gate.present).toBe(false);
    expect(gate.skipReason).toContain("未放入");
    expect(gate.cases).toHaveLength(0);
  });

  it("skips when the dir exists but has no case subdirectories", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, alreadyDir(root)), { recursive: true });
    const gate = inspectHumanBaselineGate(root);
    expect(gate.present).toBe(false);
    expect(gate.skipReason).toContain("没有子目录");
  });

  it("loads a complete case pair and records incomplete ones as skipped", () => {
    const root = makeRoot();
    writeCase(root, "case-1", {
      lawyer: "违约责任与管辖均已列明。",
      lawmind: "违约责任与管辖均已列明。",
    });
    const base = path.join(root, alreadyDir(root));
    fs.mkdirSync(path.join(base, "case-broken"), { recursive: true });
    fs.writeFileSync(path.join(base, "case-broken", "lawyer.md"), "只有律师稿", "utf8");

    const gate = inspectHumanBaselineGate(root);
    expect(gate.present).toBe(true);
    expect(gate.cases.map((c) => c.caseId)).toEqual(["case-1"]);
    expect(gate.skipped.map((s) => s.caseId)).toEqual(["case-broken"]);
    expect(gate.skipped[0]?.reason).toContain("LawMind");
  });
});

describe("classifyBaselinePair", () => {
  it("maps filenames to sides, including Chinese markers", () => {
    expect(classifyBaselinePair(["lawyer.docx", "lawmind.docx"])).toEqual({
      lawyerFile: "lawyer.docx",
      lawmindFile: "lawmind.docx",
    });
    expect(classifyBaselinePair(["律师稿.md", "本机稿.md"])).toEqual({
      lawyerFile: "律师稿.md",
      lawmindFile: "本机稿.md",
    });
  });

  it("reports missing sides rather than guessing order", () => {
    expect(classifyBaselinePair(["a.md", "b.md"])).toEqual({});
  });
});

describe("scoreSide", () => {
  const rubric: BaselineRubric = {
    taskType: "structured_drafting",
    criteria: [
      { id: "c1", label: "违约责任", anyOf: ["违约责任"] },
      { id: "c2", label: "管辖", anyOf: ["管辖", "法院"] },
      { id: "c3", label: "全部要素", allOf: ["甲方", "乙方"] },
      { id: "c4", label: "不得出现待补", mustNotAppear: ["待补"] },
    ],
  };

  it("counts anyOf, allOf coverage and mustNotAppear violations", () => {
    const full = scoreSide("甲方与乙方就违约责任及管辖达成一致。", rubric);
    expect(full.covered).toBe(4);
    expect(full.violations).toHaveLength(0);
    expect(full.coverage).toBe(1);

    const partial = scoreSide("甲方仅约定管辖法院。待补", rubric);
    expect(partial.criteria.find((c) => c.id === "c1")?.covered).toBe(false);
    expect(partial.criteria.find((c) => c.id === "c2")?.covered).toBe(true);
    expect(partial.criteria.find((c) => c.id === "c3")?.covered).toBe(false);
    expect(partial.violations).toContain("待补");
  });

  it("honours weights so heavier criteria move the score more", () => {
    const weighted: BaselineRubric = {
      taskType: "extraction",
      criteria: [
        { id: "heavy", label: "关键项", anyOf: ["关键"], weight: 5 },
        { id: "light", label: "次要项", anyOf: ["次要"], weight: 1 },
      ],
    };
    const onLight = scoreSide("次要项已写", weighted);
    const onHeavy = scoreSide("关键项已写", weighted);
    expect(onHeavy.weightedCoverage).toBeGreaterThan(onLight.weightedCoverage);
  });

  it("treats a criterion without requirements as covered", () => {
    const free: BaselineRubric = {
      taskType: "extraction",
      criteria: [{ id: "c", label: "有正文即可" }],
    };
    expect(scoreSide("任意正文", free).coverage).toBe(1);
  });
});

describe("compareSides", () => {
  const rubric: BaselineRubric = {
    taskType: "structured_drafting",
    criteria: [
      { id: "c1", label: "违约责任", anyOf: ["违约责任"] },
      { id: "c2", label: "管辖", anyOf: ["管辖"] },
    ],
  };

  it("ranks by coverage and ties on equal coverage", () => {
    const high = scoreSide("违约责任与管辖", rubric);
    const low = scoreSide("违约责任", rubric);
    expect(compareSides(low, high)).toBe("lawmind_above");
    expect(compareSides(high, low)).toBe("lawmind_below");
    expect(compareSides(high, scoreSide("违约责任与管辖", rubric))).toBe("tie");
  });

  it("lets violations outweigh coverage", () => {
    const clean = scoreSide("违约责任", rubric);
    const violating = scoreSide("违约责任与管辖。待补", {
      taskType: "structured_drafting",
      criteria: [
        { id: "c1", label: "违约责任", anyOf: ["违约责任"] },
        { id: "c2", label: "管辖", anyOf: ["管辖"] },
        { id: "c3", label: "不得待补", mustNotAppear: ["待补"] },
      ],
    });
    expect(compareSides(clean, violating)).toBe("lawmind_below");
  });
});

describe("blind packet", () => {
  it("assigns sides deterministically per caseId", () => {
    expect(lawmindIsSideA("case-1")).toBe(lawmindIsSideA("case-1"));
    const packet = buildBlindPacket({
      caseId: "case-x",
      taskType: "extraction",
      criteria: [{ id: "c1", label: "覆盖" }],
      texts: { lawyer: "律师稿正文", lawmind: "本机稿正文" },
    });
    const lawmindIsA = lawmindIsSideA("case-x");
    expect(packet.A).toBe(lawmindIsA ? "本机稿正文" : "律师稿正文");
    expect(packet.B).toBe(lawmindIsA ? "律师稿正文" : "本机稿正文");
    // The packet must not reveal which side is LawMind.
    expect(JSON.stringify(packet)).not.toContain("lawmind");
  });

  it("reads rater labels and ignores malformed ones", () => {
    const root = makeRoot();
    const dir = path.join(root, "case-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "blind-labels.json"),
      JSON.stringify({ rater: "partner-a", preferred: "A" }),
      "utf8",
    );
    expect(readBlindLabel(dir)?.preferred).toBe("A");

    fs.writeFileSync(
      path.join(dir, "blind-labels.json"),
      JSON.stringify({ preferred: "C" }),
      "utf8",
    );
    expect(readBlindLabel(dir)).toBeUndefined();
  });
});

describe("runHumanBaseline", () => {
  it("returns skip + exit 0 by default, and exit 1 when required", async () => {
    const root = makeRoot();
    const soft = await runHumanBaseline({ repoRoot: root });
    expect(soft.report.status).toBe("skip");
    expect(soft.exitCode).toBe(0);

    const hard = await runHumanBaseline({ repoRoot: root, require: true });
    expect(hard.exitCode).toBe(1);
  });

  it("reports insufficient below the minimum case count, and does not pass", async () => {
    const root = makeRoot();
    writeCase(root, "case-1", { lawyer: "违约责任", lawmind: "违约责任与管辖" });
    const res = await runHumanBaseline({ repoRoot: root });
    expect(res.report.status).toBe("insufficient");
    expect(res.report.cases).toBe(1);
    expect(res.report.reportZh).toContain("INSUFFICIENT");
  });

  it("passes at the minimum count when the lawyer draft is not ahead", async () => {
    const root = makeRoot();
    for (let i = 0; i < HUMAN_BASELINE_MIN_CASES; i += 1) {
      writeCase(root, `case-${i}`, {
        lawyer: "违约责任与管辖",
        lawmind: "违约责任与管辖",
      });
    }
    const res = await runHumanBaseline({ repoRoot: root });
    expect(res.report.status).toBe("pass");
    expect(res.report.cases).toBe(HUMAN_BASELINE_MIN_CASES);
    expect(res.report.deterministic.tie).toBe(HUMAN_BASELINE_MIN_CASES);
    expect(res.report.deterministic.notBelowRatio).toBe(1);
    expect(res.exitCode).toBe(0);
  });

  it("fails when the lawyer draft is consistently ahead", async () => {
    const root = makeRoot();
    for (let i = 0; i < HUMAN_BASELINE_MIN_CASES; i += 1) {
      writeCase(root, `case-${i}`, {
        lawyer: "违约责任与管辖均已列明，且附法条。",
        lawmind: "仅提及违约责任。",
      });
    }
    const res = await runHumanBaseline({ repoRoot: root });
    expect(res.report.status).toBe("fail");
    expect(res.report.deterministic.below).toBe(HUMAN_BASELINE_MIN_CASES);
    expect(res.exitCode).toBe(1);
  });

  it("decodes blind labels against the deterministic A/B side", async () => {
    const root = makeRoot();
    const caseId = "case-1";
    const lawmindSide = lawmindIsSideA(caseId) ? "A" : "B";
    writeCase(root, caseId, {
      lawyer: "违约责任",
      lawmind: "违约责任与管辖",
      blindPreferred: lawmindSide,
    });
    const res = await runHumanBaseline({ repoRoot: root });
    expect(res.report.blind.labeled).toBe(1);
    expect(res.report.blind.lawmindPreferred).toBe(1);
  });

  it("persists the trend report for the Doctor scorecard", async () => {
    const root = makeRoot();
    const workspace = makeRoot();
    writeCase(root, "case-1", { lawyer: "违约责任", lawmind: "违约责任" });
    await runHumanBaseline({ repoRoot: root, workspaceDir: workspace });
    const file = path.join(workspace, "lawmind", "metrics", "human-baseline-report.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).status).toBe("insufficient");
  });

  it("flags cases whose rubric is still an unconfirmed draft", async () => {
    const root = makeRoot();
    const caseDir = path.join(root, alreadyDir(root), "case-1");
    fs.mkdirSync(caseDir, { recursive: true });
    fs.writeFileSync(path.join(caseDir, "lawyer.md"), "违约责任", "utf8");
    fs.writeFileSync(path.join(caseDir, "lawmind.md"), "违约责任", "utf8");
    fs.writeFileSync(
      path.join(caseDir, "rubric.draft.json"),
      JSON.stringify({
        taskType: "structured_drafting",
        criteria: [{ id: "c1", label: "违约责任", anyOf: ["违约责任"] }],
      }),
      "utf8",
    );
    const res = await runHumanBaseline({ repoRoot: root });
    expect(res.report.rubricDrafts).toContain("case-1");
    expect(res.report.reportZh).toContain("rubric 草稿");
  });
});

describe("rubric drafts", () => {
  it("writes a draft for a case without a rubric and never overwrites a confirmed one", async () => {
    const root = makeRoot();
    const base = path.join(root, alreadyDir(root));
    const missing = path.join(base, "needs-rubric");
    fs.mkdirSync(missing, { recursive: true });
    fs.writeFileSync(path.join(missing, "lawyer.md"), "律师稿", "utf8");
    fs.writeFileSync(
      path.join(missing, "lawmind.md"),
      "第一条 违约责任与争议解决\n第二条 通知送达",
      "utf8",
    );
    const confirmed = path.join(base, "has-rubric");
    fs.mkdirSync(confirmed, { recursive: true });
    fs.writeFileSync(path.join(confirmed, "lawyer.md"), "律师稿", "utf8");
    fs.writeFileSync(path.join(confirmed, "lawmind.md"), "本机稿", "utf8");
    const confirmedRubric = JSON.stringify({
      taskType: "extraction",
      criteria: [{ id: "keep", label: "已确认", anyOf: ["本机"] }],
    });
    fs.writeFileSync(path.join(confirmed, "rubric.json"), confirmedRubric, "utf8");

    const written = await writeHumanBaselineRubricDrafts(base);
    expect(written).toEqual(["needs-rubric"]);
    expect(fs.readFileSync(path.join(confirmed, "rubric.json"), "utf8")).toBe(confirmedRubric);
    const draft = JSON.parse(
      fs.readFileSync(path.join(missing, "rubric.draft.json"), "utf8"),
    ) as BaselineRubric;
    expect(draft.criteria.length).toBeGreaterThan(0);
  });

  it("guesses extraction and analysis task types from the instruction", () => {
    expect(guessTaskType("请逐条列出并做成表格", "")).toBe("extraction");
    expect(guessTaskType("出一份意见书并论证", "")).toBe("unstructured_drafting");
    expect(guessTaskType("起草一份合同", "")).toBe("structured_drafting");
  });
});

describe("loadHumanBaselineCase", () => {
  it("reports a precise reason when the rubric is missing", () => {
    const root = makeRoot();
    const base = path.join(root, alreadyDir(root));
    const dir = path.join(base, "case-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "lawyer.md"), "律师稿", "utf8");
    fs.writeFileSync(path.join(dir, "lawmind.md"), "本机稿", "utf8");
    const loaded = loadHumanBaselineCase(base, "case-1");
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.reason).toContain("rubric");
    }
  });
});
