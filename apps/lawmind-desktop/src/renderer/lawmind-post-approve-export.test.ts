import { describe, expect, it } from "vitest";
import {
  applyPostApproveRenderResult,
  createPostApproveExport,
  markPostApproveError,
  markPostApproveExporting,
  markPostApproveOk,
  postApproveExportStorageKey,
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

  it("treats ok without outputPath as export error", () => {
    const base = createPostApproveExport({ taskId: "t1" });
    const empty = applyPostApproveRenderResult(base, true, "  ");
    expect(empty.status).toBe("error");
    expect(empty.errorMessage).toMatch(/未返回文件路径/);
    const ok = applyPostApproveRenderResult(base, true, " /tmp/out.docx ");
    expect(ok.status).toBe("ok");
    expect(ok.outputPath).toBe("/tmp/out.docx");
    const fail = applyPostApproveRenderResult(base, false, "", "磁盘满");
    expect(fail.status).toBe("error");
    expect(fail.errorMessage).toBe("磁盘满");
  });

  it("keys sessionStorage by taskId", () => {
    expect(postApproveExportStorageKey(" t9 ")).toBe("lawmind.postApproveExport.v1.t9");
  });
});
