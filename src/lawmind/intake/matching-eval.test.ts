import { describe, expect, it } from "vitest";
import { evaluateIntakeMatching, type MatchingEvalCase } from "./matching-eval.js";
import type { IntakeMatterIndex } from "./resolve.js";
import { IntakeItemSchema, type IntakeItem } from "./types.js";

const INDEX: IntakeMatterIndex = {
  matters: [
    {
      matterId: "m1",
      title: "甲案",
      caseNos: ["(2026)沪01民初123号"],
      parties: [],
      contacts: [
        {
          partyId: "p-client",
          kind: "email",
          value: "client@example.com",
          verified: true,
        },
      ],
    },
    { matterId: "m2", title: "乙案", caseNos: [], parties: [], contacts: [] },
  ],
  threadRefs: { "m-1": "m1" },
};

function item(id: string, patch: Partial<IntakeItem> = {}): IntakeItem {
  return IntakeItemSchema.parse({
    schemaVersion: 1,
    id,
    channel: "email",
    externalKey: `email:${id}`,
    trust: "untrusted",
    receivedAt: "2026-10-27T00:00:00.000Z",
    recordedAt: "2026-10-27T00:00:00.000Z",
    text: "",
    attachments: [],
    status: "pending",
    ...patch,
  });
}

const CASES: MatchingEvalCase[] = [
  {
    item: item("it-thread01", { thread: { messageId: "<m-2>", inReplyTo: ["<m-1>"] } }),
    expectedMatterId: "m1",
  },
  {
    item: item("it-contct01", { from: { display: "Client", address: "client@example.com" } }),
    expectedMatterId: "m1",
  },
  {
    item: item("it-dmarc001", {
      from: { display: "Client", address: "client@example.com" },
      dmarc: "fail",
    }),
    expectedMatterId: "m1",
  },
  {
    item: item("it-caseno01", { subject: "（2026）沪01民初123号 开庭通知" }),
    expectedMatterId: "m1",
  },
  { item: item("it-unknown1", { text: "没有任何线索" }), expectedMatterId: null },
];

describe("intake matching evaluation", () => {
  it("keeps false attach at zero and records recall@1", () => {
    const report = evaluateIntakeMatching(INDEX, CASES);
    expect(report.total).toBe(5);
    expect(report.autoAttach).toBe(3);
    expect(report.falseAttach).toBe(0);
    expect(report.autoAttachPrecision).toBe(1);
    expect(report.recallAt1).toBe(1);
    expect(report.proposalRecall).toBe(1);
    expect(report.rows.find((row) => row.itemId === "it-dmarc001")?.decision).toBe("propose");
    expect(report.rows.find((row) => row.itemId === "it-unknown1")?.decision).toBe("unmatched");
  });

  it("surfaces a wrong auto attach instead of hiding it in the average", () => {
    const wrong: MatchingEvalCase[] = CASES.map((entry) =>
      entry.item.id === "it-thread01" ? { ...entry, expectedMatterId: "m2" } : entry,
    );
    const report = evaluateIntakeMatching(INDEX, wrong);
    expect(report.falseAttach).toBe(1);
    expect(report.autoAttachPrecision).toBeCloseTo(2 / 3);
    expect(report.falseAttachRows.map((row) => row.itemId)).toEqual(["it-thread01"]);
    expect(report.recallAt1).toBeCloseTo(3 / 4);
  });

  it("returns null rates when there is nothing to measure", () => {
    const empty = evaluateIntakeMatching(INDEX, []);
    expect(empty).toMatchObject({
      total: 0,
      autoAttach: 0,
      falseAttach: 0,
      autoAttachPrecision: null,
      recallAt1: null,
      proposalRecall: null,
    });
    const unlabeled = evaluateIntakeMatching(INDEX, [
      { item: item("it-unlbl001", { text: "x" }), expectedMatterId: null },
    ]);
    expect(unlabeled.recallAt1).toBeNull();
    expect(unlabeled.proposalRecall).toBeNull();
  });
});
