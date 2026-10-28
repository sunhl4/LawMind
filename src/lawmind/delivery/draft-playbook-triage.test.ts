import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveWorkspacePlaybook } from "../deliverables/playbook-store.js";
import type { Playbook } from "../deliverables/playbook-triage.js";
import {
  isPlaybookTriageDeliverableType,
  resolveDraftPlaybook,
  triageDraftAgainstPlaybook,
} from "./draft-playbook-triage.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-draft-playbook-"));
  dirs.push(dir);
  return dir;
}

function playbook(patch: Partial<Playbook> = {}): Playbook {
  return {
    id: "prc.contract.general",
    name: "中国法合同审查（通用）",
    jurisdiction: "PRC",
    version: "1.0.0",
    stance: "偏委托方",
    acceptableRange: "",
    escalationTriggers: [],
    criteria: [
      {
        id: "dispute_clause",
        kind: "green",
        title: "有争议解决条款",
        check: { kind: "clause_present" },
        clauseTypes: ["dispute"],
      },
    ],
    ...patch,
  };
}

const CONTRACT = "第一条 争议解决\n因本合同引起的争议，提交北京仲裁委员会仲裁。";

describe("draft playbook triage", () => {
  it("applies to contract, memo and litigation deliverables", () => {
    expect(isPlaybookTriageDeliverableType("contract.general")).toBe(true);
    expect(isPlaybookTriageDeliverableType("contract.review")).toBe(true);
    expect(isPlaybookTriageDeliverableType("memo.opinion")).toBe(true);
    expect(isPlaybookTriageDeliverableType("memo.internal")).toBe(true);
    expect(isPlaybookTriageDeliverableType("litigation.complaint")).toBe(true);
    expect(isPlaybookTriageDeliverableType("letter.demand")).toBe(false);
    expect(isPlaybookTriageDeliverableType(undefined)).toBe(false);
  });

  it("uses the only workspace playbook for a contract draft", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    const triage = triageDraftAgainstPlaybook({
      workspaceDir: ws,
      deliverableType: "contract.general",
      text: CONTRACT,
    });
    expect(triage?.verdict).toBe("GREEN");
    expect(triage?.basis).toBe("playbook");
    expect(triage?.items[0]).toMatchObject({ criterionId: "dispute_clause", result: "PASS" });
  });

  it("does not guess when there is no playbook or more than one", () => {
    const empty = workspace();
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: empty,
        deliverableType: "contract.general",
        text: CONTRACT,
      }),
    ).toBeUndefined();

    const two = workspace();
    saveWorkspacePlaybook(two, playbook());
    saveWorkspacePlaybook(two, playbook({ id: "prc.contract.nda", name: "NDA 初审" }));
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: two,
        deliverableType: "contract.general",
        text: CONTRACT,
      }),
    ).toBeUndefined();
    expect(
      resolveDraftPlaybook({ workspaceDir: two, deliverableType: "contract.general" }),
    ).toBeUndefined();
  });

  it("picks by deliverable-type scope when several playbooks exist", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook({ deliverableTypes: ["contract.general"] }));
    saveWorkspacePlaybook(
      ws,
      playbook({
        id: "prc.contract.review",
        name: "合同审查",
        deliverableTypes: ["contract.review"],
      }),
    );

    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: ws,
        deliverableType: "contract.general",
        text: CONTRACT,
      })?.playbookId,
    ).toBe("prc.contract.general");
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: ws,
        deliverableType: "contract.review",
        text: CONTRACT,
      })?.playbookId,
    ).toBe("prc.contract.review");
    // 两个范围都不覆盖的类型 → 仍然不猜。
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: ws,
        deliverableType: "contract.lease",
        text: CONTRACT,
      }),
    ).toBeUndefined();
  });

  it("treats an empty scope as covering every contract type", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    saveWorkspacePlaybook(
      ws,
      playbook({
        id: "prc.contract.review",
        name: "合同审查",
        deliverableTypes: ["contract.review"],
      }),
    );
    // 未写范围的那份覆盖全部合同类，与审查剧本重叠 → 分不清，不出结论。
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: ws,
        deliverableType: "contract.review",
        text: CONTRACT,
      }),
    ).toBeUndefined();
  });

  it("leaves the triage empty when the clause is missing", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    const triage = triageDraftAgainstPlaybook({
      workspaceDir: ws,
      deliverableType: "contract.general",
      text: "本合同双方盖章签署。",
    });
    expect(triage?.verdict).toBe("YELLOW");
    expect(triage?.items[0]).toMatchObject({ criterionId: "dispute_clause", result: "FLAG" });
  });

  it("does not apply a contract playbook to a letter", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    expect(
      triageDraftAgainstPlaybook({
        workspaceDir: ws,
        deliverableType: "letter.demand",
        text: CONTRACT,
      }),
    ).toBeUndefined();
  });

  it("applies a memo playbook with text-level checks", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, {
      id: "prc.memo.opinion",
      name: "意见书结构",
      jurisdiction: "PRC",
      version: "1.0.0",
      stance: "",
      acceptableRange: "",
      escalationTriggers: [],
      deliverableTypes: ["memo.opinion"],
      criteria: [
        {
          id: "issue",
          kind: "green",
          title: "有争议焦点",
          check: { kind: "section_present", headings: ["争议焦点"] },
        },
        {
          id: "advice",
          kind: "green",
          title: "有建议",
          check: { kind: "phrase_present", phrases: ["建议"] },
        },
        {
          id: "authority",
          kind: "green",
          title: "有法律依据",
          check: { kind: "citation_present" },
        },
        {
          id: "guarantee",
          kind: "red",
          title: "不得保证结果",
          check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
        },
      ],
    });
    const triage = triageDraftAgainstPlaybook({
      workspaceDir: ws,
      deliverableType: "memo.opinion",
      text: [
        "争议焦点",
        "是否构成违约。",
        "建议：按民法典第五百七十七条主张。",
        "不得保证胜诉。",
      ].join("\n"),
    });
    expect(triage?.playbookId).toBe("prc.memo.opinion");
    expect(triage?.items.find((item) => item.criterionId === "issue")?.result).toBe("PASS");
    expect(triage?.items.find((item) => item.criterionId === "advice")?.result).toBe("PASS");
    expect(triage?.items.find((item) => item.criterionId === "authority")?.result).toBe("PASS");
    expect(triage?.items.find((item) => item.criterionId === "guarantee")?.result).toBe("FAIL");
    expect(triage?.verdict).toBe("RED");
  });
});
