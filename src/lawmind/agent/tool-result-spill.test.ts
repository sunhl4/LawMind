import { describe, expect, it } from "vitest";
import { shouldSpillToolResult } from "./tool-result-spill.js";

describe("tool-result-spill", () => {
  it("spills research/mail/read and skips write/render/send", () => {
    expect(shouldSpillToolResult("research_task")).toBe(true);
    expect(shouldSpillToolResult("list_mail_inbox")).toBe(true);
    expect(shouldSpillToolResult("read_project_file")).toBe(true);
    expect(shouldSpillToolResult("analyze_document")).toBe(true);
    expect(shouldSpillToolResult("compare_documents")).toBe(true);
    expect(shouldSpillToolResult("write_document")).toBe(false);
    expect(shouldSpillToolResult("apply_surgical_edits")).toBe(false);
    expect(shouldSpillToolResult("render_document")).toBe(false);
    expect(shouldSpillToolResult("send_email")).toBe(false);
  });
});
