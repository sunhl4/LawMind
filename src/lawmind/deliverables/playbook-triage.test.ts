import { describe, expect, it } from "vitest";
import { extractClauses } from "../clause/extract.js";
import {
  describePlaybookTriage,
  isPlaybookOverrideValid,
  observationsFromClauseDoc,
  observationsFromDocument,
  triageAgainstPlaybook,
  type Playbook,
  type PlaybookEvidence,
  type PlaybookObservation,
  type PlaybookOverride,
} from "./playbook-triage.js";

const quote = (text: string, locator = "L3-L5"): PlaybookEvidence => ({ quote: text, locator });

function playbook(patch: Partial<Playbook> = {}): Playbook {
  return {
    id: "prc.contract.general",
    name: "中国法合同审查（通用）",
    jurisdiction: "PRC",
    version: "1.0.0",
    stance: "偏委托方；不接受无限责任与单方管辖。",
    acceptableRange: "责任上限不低于合同金额的 100%。",
    escalationTriggers: ["涉及行政处罚", "对方为国有企业"],
    criteria: [
      {
        id: "dispute_clause",
        kind: "green",
        title: "有争议解决条款",
        check: { kind: "clause_present" },
        clauseTypes: ["dispute"],
      },
      { id: "liability_cap", kind: "green", title: "责任有上限" },
      { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
    ],
    ...patch,
  };
}

function pass(id: string, evidence: PlaybookEvidence | undefined): PlaybookObservation {
  return { criterionId: id, result: "PASS", ...(evidence ? { evidence } : {}) };
}

describe("triageAgainstPlaybook", () => {
  it("says basis=default and stays YELLOW when no playbook is loaded", () => {
    const triage = triageAgainstPlaybook({
      playbook: null,
      observations: [pass("dispute_clause", quote("提交北京仲裁委员会仲裁。"))],
    });
    expect(triage.verdict).toBe("YELLOW");
    expect(triage.basis).toBe("default");
    expect(triage.items).toEqual([]);
  });

  it("turns GREEN only when every condition passes with a quote and a locator", () => {
    const triage = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        pass("dispute_clause", quote("提交北京仲裁委员会仲裁。", "L8-L9")),
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        // 禁止项也要「看过并确认没有」的原文依据，才算通过。
        pass("unlimited_liability", quote("赔偿总额不超过合同金额。", "L5")),
      ],
    });
    expect(triage.verdict).toBe("GREEN");
    expect(triage.counts).toEqual({ pass: 3, flag: 0, fail: 0 });
    expect(triage.basis).toBe("playbook");
  });

  it("never counts a PASS without a quote or locator", () => {
    const noQuote = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        { criterionId: "dispute_clause", result: "PASS", evidence: { quote: "  ", locator: "L8" } },
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        { criterionId: "unlimited_liability", result: "FLAG" },
      ],
    });
    expect(noQuote.verdict).toBe("YELLOW");
    const downgraded = noQuote.items.find((item) => item.criterionId === "dispute_clause");
    expect(downgraded?.result).toBe("FLAG");
    expect(downgraded?.downgraded).toBe("missing_quote");

    const noLocator = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        {
          criterionId: "dispute_clause",
          result: "PASS",
          evidence: { quote: "仲裁。", locator: "" },
        },
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        { criterionId: "unlimited_liability", result: "FLAG" },
      ],
    });
    expect(noLocator.items.find((item) => item.criterionId === "dispute_clause")?.downgraded).toBe(
      "missing_locator",
    );
  });

  it("treats a missing observation as 未核对, not as a pass", () => {
    const triage = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [pass("dispute_clause", quote("提交仲裁。", "L8"))],
    });
    const liability = triage.items.find((item) => item.criterionId === "liability_cap");
    expect(liability?.result).toBe("FLAG");
    expect(liability?.reasonZh).toContain("未核对");
    expect(triage.verdict).toBe("YELLOW");
  });

  it("makes a red criterion RED only when the FAIL is backed by a quote", () => {
    const backed = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        pass("dispute_clause", quote("提交仲裁。", "L8")),
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: quote("乙方承担无限责任。", "L12"),
          reasonZh: "出现无限责任表述。",
        },
      ],
    });
    expect(backed.verdict).toBe("RED");
    expect(backed.counts.fail).toBe(1);

    const unbacked = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        pass("dispute_clause", quote("提交仲裁。", "L8")),
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        { criterionId: "unlimited_liability", result: "FAIL", reasonZh: "感觉有问题。" },
      ],
    });
    expect(unbacked.verdict).toBe("YELLOW");
    expect(
      unbacked.items.find((item) => item.criterionId === "unlimited_liability")?.downgraded,
    ).toBe("missing_evidence");
  });

  it("lets a lawyer override RED only with a reason, and records it", () => {
    const red = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        pass("dispute_clause", quote("提交仲裁。", "L8")),
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: quote("乙方承担无限责任。", "L12"),
        },
      ],
    });
    expect(red.verdict).toBe("RED");

    const noReason: PlaybookOverride = {
      by: "陈律师",
      reason: "   ",
      at: "2026-10-27T10:00:00.000Z",
    };
    expect(isPlaybookOverrideValid(noReason)).toBe(false);
    const rejected = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [],
      override: noReason,
    });
    expect(rejected.verdict).toBe("YELLOW"); // 没有证据的 FAIL 本身就已降级
    const strict = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        {
          criterionId: "unlimited_liability",
          result: "FAIL",
          evidence: quote("乙方承担无限责任。", "L12"),
        },
        pass("dispute_clause", quote("提交仲裁。", "L8")),
        pass("liability_cap", quote("上限 100%。", "L5")),
      ],
      override: noReason,
    });
    expect(strict.verdict).toBe("RED");
    expect(strict.overrideRejected).toBe(true);

    const override: PlaybookOverride = {
      by: "陈律师",
      reason: "对方为长期客户，已单独出具风险提示。",
      at: "2026-10-27T10:00:00.000Z",
    };
    const accepted = triageAgainstPlaybook({
      playbook: playbook(),
      observations: strict.items.map((item) => ({
        criterionId: item.criterionId,
        result: item.result === "FLAG" ? "FLAG" : item.result,
        ...(item.evidence ? { evidence: item.evidence } : {}),
      })),
      override,
    });
    expect(accepted.verdict).toBe("YELLOW");
    expect(accepted.override).toEqual(override);
  });

  it("reports observations that do not exist in the playbook", () => {
    const triage = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        pass("not_in_playbook", quote("x", "L1")),
        pass("dispute_clause", quote("提交仲裁。", "L8")),
      ],
    });
    expect(triage.unknownCriterionIds).toEqual(["not_in_playbook"]);
  });
});

describe("observationsFromClauseDoc", () => {
  const contract = [
    "第一条 定义",
    "本合同所称服务指法律咨询服务。",
    "第二条 争议解决",
    "因本合同引起的争议，提交北京仲裁委员会仲裁。",
  ].join("\n");

  it("quotes the exact clause text with a line locator when the clause is present", () => {
    const doc = extractClauses(contract);
    const observations = observationsFromClauseDoc({
      playbook: playbook(),
      doc,
      filePath: "materials/服务合同.md",
    });
    // 只有 clause_present 条件会被机械核对；其余条件仍要人给结论。
    expect(observations).toHaveLength(1);
    const [observation] = observations;
    expect(observation?.criterionId).toBe("dispute_clause");
    expect(observation?.result).toBe("PASS");
    expect(observation?.evidence?.locator).toMatch(/^L\d+(-L\d+)?$/);
    expect(observation?.evidence?.filePath).toBe("materials/服务合同.md");
    const quoted = observation?.evidence?.quote ?? "";
    expect(quoted.length).toBeGreaterThan(0);
    expect(doc.text).toContain(quoted);
  });

  it("stays FLAG when the clause is missing, because extraction may have failed", () => {
    const doc = extractClauses("第一条 定义\n本合同所称服务指法律咨询服务。");
    const observations = observationsFromClauseDoc({ playbook: playbook(), doc });
    const [observation] = observations;
    expect(observation?.result).toBe("FLAG");
    expect(observation?.evidence).toBeUndefined();
    expect(observation?.reasonZh).toContain("抽取失败");
  });

  it("feeds the triage end to end: present clause + manual approvals reach GREEN", () => {
    const doc = extractClauses(contract);
    const triage = triageAgainstPlaybook({
      playbook: playbook(),
      observations: [
        ...observationsFromClauseDoc({ playbook: playbook(), doc }),
        pass("liability_cap", quote("赔偿总额不超过合同金额。", "L5")),
        pass("unlimited_liability", quote("赔偿总额不超过合同金额。", "L5")),
      ],
    });
    expect(triage.verdict).toBe("GREEN");
  });
});

describe("observationsFromDocument", () => {
  const opinionText = [
    "争议焦点",
    "是否构成违约。",
    "建议：按民法典第五百七十七条主张。",
    "本意见不保证胜诉。",
  ].join("\n");

  function single(
    criterion: Playbook["criteria"][number],
    text = opinionText,
  ): PlaybookObservation {
    const [observation] = observationsFromDocument({
      playbook: playbook({ criteria: [criterion] }),
      text,
      filePath: "drafts/意见书.md",
    });
    return observation;
  }

  it("quotes the heading line when a required section exists", () => {
    const observation = single({
      id: "issue",
      kind: "green",
      title: "有争议焦点",
      check: { kind: "section_present", headings: ["争议焦点"] },
    });
    expect(observation.result).toBe("PASS");
    expect(observation.evidence?.quote).toBe("争议焦点");
    expect(observation.evidence?.locator).toBe("L1");
    expect(observation.evidence?.filePath).toBe("drafts/意见书.md");
  });

  it("keeps a missing section as FLAG instead of calling it a failure", () => {
    const observation = single({
      id: "facts",
      kind: "green",
      title: "有事实与理由",
      check: { kind: "section_present", headings: ["事实与理由"] },
    });
    expect(observation.result).toBe("FLAG");
    expect(observation.evidence).toBeUndefined();
    expect(observation.reasonZh).toContain("没有找到章节");
  });

  it("quotes a required phrase and fails a forbidden phrase with evidence", () => {
    const required = single({
      id: "advice",
      kind: "green",
      title: "有建议",
      check: { kind: "phrase_present", phrases: ["建议"] },
    });
    expect(required.result).toBe("PASS");
    expect(required.evidence?.quote).toContain("建议");

    const forbidden = single({
      id: "guarantee",
      kind: "red",
      title: "不得保证结果",
      check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
    });
    expect(forbidden.result).toBe("FAIL");
    expect(forbidden.evidence?.quote).toContain("保证胜诉");
    expect(forbidden.evidence?.locator).toMatch(/^L\d+$/);
  });

  it("never turns an absent phrase into an automatic PASS", () => {
    const observation = single(
      {
        id: "guarantee",
        kind: "red",
        title: "不得保证结果",
        check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
      },
      "争议焦点\n是否构成违约。",
    );
    expect(observation.result).toBe("FLAG");
    expect(observation.evidence).toBeUndefined();
    expect(observation.reasonZh).toContain("否定性结论");
  });

  it("finds a statute citation and keeps a bare assertion as FLAG", () => {
    const found = single({
      id: "authority",
      kind: "green",
      title: "有法律依据",
      check: { kind: "citation_present" },
    });
    expect(found.result).toBe("PASS");
    expect(found.evidence?.quote).toContain("民法典第五百七十七条");

    const missing = single(
      {
        id: "authority",
        kind: "green",
        title: "有法律依据",
        check: { kind: "citation_present" },
      },
      "争议焦点\n是否构成违约。",
    );
    expect(missing.result).toBe("FLAG");
    expect(missing.reasonZh).toContain("没有找到");
  });

  it("does not guess clause presence on non-contract text", () => {
    const observation = single({
      id: "dispute_clause",
      kind: "green",
      title: "有争议解决条款",
      check: { kind: "clause_present" },
      clauseTypes: ["dispute"],
    });
    expect(observation.result).toBe("FLAG");
    expect(observation.reasonZh).toContain("不是合同文本");
  });

  it("keeps a phrase_absent-only playbook YELLOW, never GREEN", () => {
    const triage = triageAgainstPlaybook({
      playbook: playbook({
        criteria: [
          {
            id: "guarantee",
            kind: "red",
            title: "不得保证结果",
            check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
          },
        ],
      }),
      observations: [
        {
          criterionId: "guarantee",
          result: "FLAG",
          reasonZh: "全文没有命中禁止表述；否定性结论没有原文可引用。",
        },
      ],
    });
    expect(triage.verdict).toBe("YELLOW");
    expect(triage.counts).toEqual({ pass: 0, flag: 1, fail: 0 });
  });
});

describe("describePlaybookTriage", () => {
  it("states the basis and counts without inventing a correctness rate", () => {
    const triage = triageAgainstPlaybook({ playbook: null });
    const line = describePlaybookTriage(triage);
    expect(line).toContain("通用标准");
    expect(line).toContain("YELLOW");
    expect(line).not.toContain("正确率");

    const withBook = describePlaybookTriage(
      triageAgainstPlaybook({
        playbook: playbook(),
        observations: [
          pass("dispute_clause", quote("提交仲裁。", "L8")),
          pass("liability_cap", quote("上限 100%。", "L5")),
          pass("unlimited_liability", quote("上限 100%。", "L5")),
        ],
      }),
    );
    expect(withBook).toContain("中国法合同审查（通用）");
    expect(withBook).toContain("GREEN");
    expect(withBook).toContain("仍需一键签发");
  });
});
