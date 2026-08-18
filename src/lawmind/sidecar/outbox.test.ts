import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClauseGraphFromDraft } from "../reasoning/clause-graph.js";
import type { ArtifactDraft } from "../types.js";
import { bindSidecarIngestToTask } from "./bindings.js";
import { ingestSidecarSelection } from "./ingest.js";
import {
  acknowledgeSidecarOutbox,
  buildSidecarPasteText,
  persistSidecarOutboxFromDraft,
  readSidecarOutbox,
} from "./outbox.js";

function draft(): ArtifactDraft {
  return {
    taskId: "t-outbox-1",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections: [{ heading: "租金", body: "乙方应当按月支付租金。【出租人】【承租人】【房屋地址】" }],
    reviewNotes: ["复核：全文未见争议解决或管辖约定，外发前请补上。"],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("sidecar outbox", () => {
  it("builds paste-ready critic text without the full body", () => {
    const d = draft();
    const graph = buildClauseGraphFromDraft(d);
    const text = buildSidecarPasteText(d, graph);
    expect(text).toContain("【LawMind 复核】房屋租赁合同");
    expect(text).toContain("骨架稿");
    expect(text).toContain("争议解决");
    expect(text).not.toContain("乙方应当按月支付租金。【出租人】");
  });

  it("persists and acks the latest outbox item", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-outbox-"));
    const d = draft();
    persistSidecarOutboxFromDraft(dir, d, buildClauseGraphFromDraft(d));
    const read = readSidecarOutbox(dir);
    expect(read?.taskId).toBe("t-outbox-1");
    expect(read?.ackedAt).toBeUndefined();
    const acked = acknowledgeSidecarOutbox(dir);
    expect(acked?.ackedAt).toBeTruthy();
    expect(readSidecarOutbox(dir)?.ackedAt).toBeTruthy();
  });

  it("writes the bound ingest path onto the outbox item", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-outbox-bind-"));
    const ingested = ingestSidecarSelection(dir, {
      source: "word",
      text: "请于七日内付款。",
      verb: "draft",
    });
    bindSidecarIngestToTask(dir, ingested.relativePath, "t-outbox-1");
    persistSidecarOutboxFromDraft(dir, draft(), buildClauseGraphFromDraft(draft()));
    expect(readSidecarOutbox(dir)?.ingestRelativePath).toBe(ingested.relativePath);
  });
});
