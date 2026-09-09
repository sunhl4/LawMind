/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LawmindProvenanceIndicator } from "./LawmindProvenanceIndicator";

const fixedTs = "2026-09-03T09:30:00.000Z";

type ProvenanceEvent = {
  type: string;
  actor: string;
  timestamp: string;
  sourceId?: string;
  userId?: string;
  reason?: string;
  comment?: string;
  diffSummary?: string;
};

type ProvenanceChain = {
  events: ProvenanceEvent[];
};

function uploadEvent(sourceId: string, comment: string): ProvenanceChain["events"][number] {
  return { type: "upload", actor: "system", timestamp: fixedTs, sourceId, comment };
}

function aiSuggestEvent(): ProvenanceChain["events"][number] {
  return { type: "ai_suggest", actor: "model", timestamp: fixedTs };
}

function lawyerEditEvent(diffSummary?: string): ProvenanceChain["events"][number] {
  return { type: "lawyer_edit", actor: "user", timestamp: fixedTs, diffSummary };
}

function importEvent(sourceId: string, comment: string): ProvenanceChain["events"][number] {
  return { type: "import", actor: "user", timestamp: fixedTs, sourceId, comment };
}

describe("LawmindProvenanceIndicator", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders nothing when provenance is missing", () => {
    act(() => {
      root.render(<LawmindProvenanceIndicator provenance={undefined} />);
    });
    expect(host.innerHTML).toBe("");
  });

  it("shows a lawyer-friendly source summary on click", async () => {
    const chain: ProvenanceChain = {
      events: [uploadEvent("src-1", "客户说明"), aiSuggestEvent()],
    };
    await act(async () => {
      root.render(<LawmindProvenanceIndicator provenance={chain} headingLabel="一、事实" />);
    });
    const trigger = host.querySelector("button");
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toBe("来源");
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const card = host.querySelector("[role='tooltip']");
    expect(card).not.toBeNull();
    const text = card?.textContent ?? "";
    expect(text).toContain("材料来源");
    expect(text).toContain("AI 建议");
    expect(text).toContain("未再改动");
    expect(text).not.toContain("src-1");
  });

  it("shows a template-import chain without exposing engineer ids", async () => {
    const chain: ProvenanceChain = {
      events: [importEvent("uploads/contract.docx", "房屋租赁合同模板"), lawyerEditEvent("调整租金金额")],
    };
    await act(async () => {
      root.render(<LawmindProvenanceIndicator provenance={chain} />);
    });
    const trigger = host.querySelector("button");
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const text = host.textContent ?? "";
    expect(text).toContain("来自模板：房屋租赁合同模板");
    expect(text).toContain("律师于");
    expect(text).toContain("调整租金金额");
    expect(text).not.toContain("uploads/contract.docx");
  });
});
