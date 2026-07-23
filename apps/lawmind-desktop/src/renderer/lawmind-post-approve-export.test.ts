import { describe, expect, it } from "vitest";
import {
  createPostApproveExport,
  markPostApproveError,
  markPostApproveExporting,
  markPostApproveOk,
} from "./lawmind-post-approve-export";

describe("lawmind-post-approve-export", () => {
  it("creates idle state", () => {
    const s = createPostApproveExport({ taskId: " t1 ", matterId: "m1", title: "待审定：合同" });
    expect(s.taskId).toBe("t1");
    expect(s.matterId).toBe("m1");
    expect(s.title).toBe("合同");
    expect(s.status).toBe("idle");
  });

  it("transitions exporting → ok / error", () => {
    const base = createPostApproveExport({ taskId: "t1" });
    const mid = markPostApproveExporting(base);
    expect(mid.status).toBe("exporting");
    expect(markPostApproveOk(mid, " /tmp/a.docx ").status).toBe("ok");
    expect(markPostApproveOk(mid, " /tmp/a.docx ").outputPath).toBe("/tmp/a.docx");
    expect(markPostApproveError(mid, "blocked").errorMessage).toBe("blocked");
  });
});
