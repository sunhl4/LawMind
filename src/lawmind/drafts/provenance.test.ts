import { describe, expect, it } from "vitest";
import {
  appendProvenanceEvent,
  createProvenanceEvent,
  diffSummary,
  findLatestProvenanceEvent,
  findProvenanceBySource,
  isAiGeneratedProvenance,
  isUserModifiedProvenance,
  renderProvenanceAsFootnote,
  type ProvenanceChain,
} from "./provenance.js";

const fixedTs = "2026-09-03T09:30:00.000Z";

describe("provenance model", () => {
  it("creates an event with a default ISO timestamp", () => {
    const ev = createProvenanceEvent("ai_suggest", "model");
    expect(ev.type).toBe("ai_suggest");
    expect(ev.actor).toBe("model");
    expect(ev.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("accepts an explicit timestamp and optional fields", () => {
    const ev = createProvenanceEvent("lawyer_edit", "user", {
      timestamp: fixedTs,
      sourceId: "tool-call-1",
      userId: "lawyer-1",
      reason: "clarity",
      comment: "澄清措辞",
      diffSummary: "将「甲」改为「乙」",
    });
    expect(ev.timestamp).toBe(fixedTs);
    expect(ev.sourceId).toBe("tool-call-1");
    expect(ev.userId).toBe("lawyer-1");
    expect(ev.reason).toBe("clarity");
    expect(ev.comment).toBe("澄清措辞");
    expect(ev.diffSummary).toBe("将「甲」改为「乙」");
  });

  it("appends events to an empty or existing chain", () => {
    const ev1 = createProvenanceEvent("upload", "system", {
      timestamp: fixedTs,
      sourceId: "src-1",
    });
    const chain = appendProvenanceEvent(undefined, ev1);
    expect(chain.events).toHaveLength(1);
    const ev2 = createProvenanceEvent("ai_suggest", "model", { timestamp: fixedTs });
    const next = appendProvenanceEvent(chain, ev2);
    expect(next.events).toHaveLength(2);
    expect(chain.events).toHaveLength(1); // immutable
  });

  it("finds the latest event and the latest by type", () => {
    const chain: ProvenanceChain = {
      events: [
        createProvenanceEvent("upload", "system", { timestamp: fixedTs, sourceId: "src-1" }),
        createProvenanceEvent("ai_suggest", "model", { timestamp: fixedTs }),
        createProvenanceEvent("lawyer_edit", "user", { timestamp: fixedTs, diffSummary: "x" }),
      ],
    };
    expect(findLatestProvenanceEvent(chain)?.type).toBe("lawyer_edit");
    expect(findLatestProvenanceEvent(chain, "ai_suggest")?.type).toBe("ai_suggest");
    expect(findLatestProvenanceEvent(chain, "export")).toBeUndefined();
  });

  it("finds events by source id", () => {
    const chain: ProvenanceChain = {
      events: [
        createProvenanceEvent("upload", "system", { sourceId: "src-1" }),
        createProvenanceEvent("ai_suggest", "model", { sourceId: "src-1" }),
        createProvenanceEvent("ai_suggest", "model", { sourceId: "src-2" }),
      ],
    };
    const hits = findProvenanceBySource(chain, "src-1");
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.sourceId === "src-1")).toBe(true);
  });

  it("detects user modification and AI generation", () => {
    const aiOnly: ProvenanceChain = {
      events: [createProvenanceEvent("ai_suggest", "model")],
    };
    expect(isAiGeneratedProvenance(aiOnly)).toBe(true);
    expect(isUserModifiedProvenance(aiOnly)).toBe(false);

    const userImported: ProvenanceChain = {
      events: [createProvenanceEvent("import", "user")],
    };
    expect(isAiGeneratedProvenance(userImported)).toBe(false);
    expect(isUserModifiedProvenance(userImported)).toBe(true);

    const mixed: ProvenanceChain = {
      events: [
        createProvenanceEvent("ai_suggest", "model"),
        createProvenanceEvent("lawyer_edit", "user"),
      ],
    };
    expect(isAiGeneratedProvenance(mixed)).toBe(true);
    expect(isUserModifiedProvenance(mixed)).toBe(true);
  });

  it("renders an AI-only chain as a lawyer-friendly sentence", () => {
    const chain: ProvenanceChain = {
      events: [createProvenanceEvent("ai_suggest", "model", { timestamp: fixedTs })],
    };
    const text = renderProvenanceAsFootnote(chain);
    expect(text).toContain("AI 建议");
    expect(text).toContain("未再改动");
  });

  it("renders a template-import chain with source name and lawyer edit", () => {
    const chain: ProvenanceChain = {
      events: [
        createProvenanceEvent("import", "user", {
          timestamp: fixedTs,
          sourceId: "uploads/contract.docx",
          comment: "房屋租赁合同模板",
        }),
        createProvenanceEvent("lawyer_edit", "user", {
          timestamp: fixedTs,
          diffSummary: "调整租金金额",
        }),
      ],
    };
    const text = renderProvenanceAsFootnote(chain);
    expect(text).toContain("来自模板：房屋租赁合同模板");
    expect(text).toContain("律师于");
    expect(text).not.toContain("uploads/contract.docx");
    expect(text).not.toContain("lawyer-");
  });

  it("renders an uploaded-material chain with a lawyer accept", () => {
    const chain: ProvenanceChain = {
      events: [
        createProvenanceEvent("upload", "system", {
          timestamp: fixedTs,
          sourceId: "src-1",
          comment: "客户说明",
        }),
        createProvenanceEvent("ai_suggest", "model", { timestamp: fixedTs }),
        createProvenanceEvent("lawyer_accept", "user", { timestamp: fixedTs }),
      ],
    };
    const text = renderProvenanceAsFootnote(chain);
    expect(text).toContain("材料来源：客户说明");
    expect(text).toContain("AI 建议");
    expect(text).toContain("接受红线/批注");
    expect(text).not.toContain("src-1");
  });

  it("serializes and deserializes a chain via JSON", () => {
    const chain: ProvenanceChain = {
      events: [
        createProvenanceEvent("upload", "system", { timestamp: fixedTs, sourceId: "src-1" }),
        createProvenanceEvent("ai_suggest", "model", { timestamp: fixedTs }),
      ],
    };
    const parsed = JSON.parse(JSON.stringify(chain)) as ProvenanceChain;
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0].type).toBe("upload");
    expect(parsed.events[1].actor).toBe("model");
  });

  it("produces a bounded diff summary", () => {
    expect(diffSummary("a", "a")).toBe("无变化");
    expect(diffSummary("甲方", "乙方")).toBe("由「甲方」改为「乙方」");
    const longBefore = "a" + "x".repeat(50);
    const longAfter = "b" + "y".repeat(50);
    const out = diffSummary(longBefore, longAfter);
    expect(out.length).toBeLessThanOrEqual(83); // 80 + ellipsis
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("由「a");
    expect(out).toContain("改为「b");
  });
});
