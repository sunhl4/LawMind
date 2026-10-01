import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ASSISTANT_ID } from "./constants.js";
import {
  ASSISTANT_ROSTER_LIMIT,
  assertCanCreateAssistant,
  assistantsForDailySwitcher,
  SOLO_ROSTER_FULL_MESSAGE,
  sortAssistantsForRoster,
} from "./roster.js";
import { duplicateAssistant, loadAssistantProfiles, upsertAssistant } from "./store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-roster-"));
  dirs.push(root);
  return root;
}

describe("assistant roster pin and hide", () => {
  it("pins and hides without dropping the job brief", () => {
    const root = tmpRoot();
    const created = upsertAssistant(root, {
      displayName: "续签助手",
      introduction: "盯到期",
      jobBrief: { prohibitions: "外发前必须问我" },
    });
    upsertAssistant(root, { assistantId: created.assistantId, pinned: true, hidden: true });
    const saved = loadAssistantProfiles(root).find(
      (row) => row.assistantId === created.assistantId,
    );
    expect(saved?.pinned).toBe(true);
    expect(saved?.hidden).toBe(true);
    expect(saved?.jobBrief?.prohibitions).toBe("外发前必须问我");
  });

  it("refuses to hide the default assistant", () => {
    const root = tmpRoot();
    loadAssistantProfiles(root);
    expect(() =>
      upsertAssistant(root, { assistantId: DEFAULT_ASSISTANT_ID, hidden: true }),
    ).toThrow(/不能隐藏/);
  });

  it("does not copy pin or hide onto a duplicate", () => {
    const root = tmpRoot();
    const created = upsertAssistant(root, {
      displayName: "续签助手",
      introduction: "盯到期",
      pinned: true,
      hidden: true,
    });
    const copy = duplicateAssistant(root, created.assistantId);
    expect(copy.pinned).toBeUndefined();
    expect(copy.hidden).toBeUndefined();
    expect(copy.displayName).toBe("续签助手 副本");
  });

  it("stops creating once the roster is full", () => {
    const root = tmpRoot();
    loadAssistantProfiles(root);
    for (let i = loadAssistantProfiles(root).length; i < ASSISTANT_ROSTER_LIMIT; i += 1) {
      upsertAssistant(root, { displayName: `助手 ${i}`, introduction: "" });
    }
    expect(loadAssistantProfiles(root)).toHaveLength(ASSISTANT_ROSTER_LIMIT);
    expect(() => upsertAssistant(root, { displayName: "再一位", introduction: "" })).toThrow(
      /名册已满/,
    );
  });

  it("solo gate blocks a second assistant while firm allows create", () => {
    expect(() => assertCanCreateAssistant(1, false)).toThrow(SOLO_ROSTER_FULL_MESSAGE);
    expect(() => assertCanCreateAssistant(1, true)).not.toThrow();
    expect(() => assertCanCreateAssistant(0, false)).not.toThrow();
  });

  it("keeps hidden assistants out of the daily switcher except the one in use", () => {
    const rows = [
      { assistantId: "b", displayName: "乙", pinned: true, hidden: true },
      { assistantId: "a", displayName: "甲", pinned: true },
      { assistantId: "c", displayName: "丙" },
    ];
    expect(assistantsForDailySwitcher(rows, "c").map((row) => row.assistantId)).toEqual(["a", "c"]);
    expect(assistantsForDailySwitcher(rows, "b").map((row) => row.assistantId)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortAssistantsForRoster(rows).map((row) => row.assistantId)).toEqual(["a", "c", "b"]);
  });
});
