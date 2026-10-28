import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteWorkspacePlaybook,
  listWorkspacePlaybooks,
  loadWorkspacePlaybook,
  playbookPath,
  playbooksDir,
  saveWorkspacePlaybook,
} from "./playbook-store.js";
import type { Playbook } from "./playbook-triage.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-playbook-store-"));
  dirs.push(dir);
  return dir;
}

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
      {
        id: "dispute_clause",
        kind: "green",
        title: "有争议解决条款",
        check: { kind: "clause_present" },
        clauseTypes: ["dispute"],
      },
      { id: "unlimited_liability", kind: "red", title: "不得约定无限责任" },
    ],
    ...patch,
  };
}

describe("workspace playbook store", () => {
  it("writes one JSON file per playbook and reads it back intact", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook({ deliverableTypes: ["contract.review"] }));

    expect(fs.existsSync(playbookPath(ws, "prc.contract.general"))).toBe(true);
    expect(loadWorkspacePlaybook(ws, "prc.contract.general")).toEqual(
      playbook({ deliverableTypes: ["contract.review"] }),
    );
    expect(listWorkspacePlaybooks(ws)).toEqual([
      {
        id: "prc.contract.general",
        name: "中国法合同审查（通用）",
        version: "1.0.0",
        jurisdiction: "PRC",
        criteriaCount: 2,
        deliverableTypes: ["contract.review"],
      },
    ]);
  });

  it("round-trips section, phrase and citation checks", () => {
    const ws = workspace();
    const book = playbook({
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
          id: "guarantee",
          kind: "red",
          title: "不得保证结果",
          check: { kind: "phrase_absent", phrases: ["保证胜诉"] },
        },
        {
          id: "authority",
          kind: "green",
          title: "有法律依据",
          check: { kind: "citation_present" },
        },
      ],
    });
    saveWorkspacePlaybook(ws, book);
    expect(loadWorkspacePlaybook(ws, book.id)).toEqual(book);
  });

  it("rejects an empty heading or phrase list", () => {
    const ws = workspace();
    expect(() =>
      saveWorkspacePlaybook(
        ws,
        playbook({
          criteria: [
            {
              id: "issue",
              kind: "green",
              title: "有争议焦点",
              check: { kind: "section_present", headings: [] },
            },
          ],
        }),
      ),
    ).toThrow();
    expect(() =>
      saveWorkspacePlaybook(
        ws,
        playbook({
          criteria: [
            {
              id: "guarantee",
              kind: "red",
              title: "不得保证结果",
              check: { kind: "phrase_absent", phrases: [] },
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("returns undefined / empty list when the workspace has no playbooks", () => {
    const ws = workspace();
    expect(loadWorkspacePlaybook(ws, "prc.contract.general")).toBeUndefined();
    expect(listWorkspacePlaybooks(ws)).toEqual([]);
    expect(fs.existsSync(playbooksDir(ws))).toBe(false);
  });

  it("rejects unsafe ids instead of writing outside the playbooks directory", () => {
    const ws = workspace();
    expect(() => saveWorkspacePlaybook(ws, playbook({ id: "../escape" }))).toThrow(
      /剧本 id|invalid/,
    );
    expect(() => playbookPath(ws, "../escape")).toThrow(/invalid_playbook_id/);
  });

  it("rejects duplicate criterion ids and empty criteria", () => {
    const ws = workspace();
    expect(() =>
      saveWorkspacePlaybook(
        ws,
        playbook({
          criteria: [
            { id: "cap", kind: "green", title: "甲" },
            { id: "cap", kind: "red", title: "乙" },
          ],
        }),
      ),
    ).toThrow(/条件 id 重复/);
    expect(() => saveWorkspacePlaybook(ws, playbook({ criteria: [] }))).toThrow();
  });

  it("skips a corrupt file but keeps listing the readable playbooks", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    fs.writeFileSync(path.join(playbooksDir(ws), "broken.json"), "{ not json", "utf8");
    fs.writeFileSync(path.join(playbooksDir(ws), "notes.txt"), "ignore me", "utf8");

    expect(loadWorkspacePlaybook(ws, "broken")).toBeUndefined();
    expect(listWorkspacePlaybooks(ws).map((item) => item.id)).toEqual(["prc.contract.general"]);
  });

  it("deletes only the named playbook", () => {
    const ws = workspace();
    saveWorkspacePlaybook(ws, playbook());
    saveWorkspacePlaybook(ws, playbook({ id: "prc.contract.nda", name: "NDA 初审" }));

    expect(deleteWorkspacePlaybook(ws, "prc.contract.general")).toBe(true);
    expect(deleteWorkspacePlaybook(ws, "prc.contract.general")).toBe(false);
    expect(listWorkspacePlaybooks(ws).map((item) => item.id)).toEqual(["prc.contract.nda"]);
  });
});
