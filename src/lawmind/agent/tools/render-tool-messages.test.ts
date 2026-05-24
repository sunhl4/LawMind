import { describe, expect, it } from "vitest";
import {
  classifyRenderFailure,
  formatRenderToolError,
  formatWorkflowRenderFailure,
} from "./render-tool-messages.js";

describe("render-tool-messages", () => {
  it("classifies approval vs acceptance vs engine errors", () => {
    expect(classifyRenderFailure("草稿尚未通过审核（pending）")).toBe("approval_required");
    expect(classifyRenderFailure("草稿未通过验收门禁（blockers=2）")).toBe("acceptance_gate");
    expect(classifyRenderFailure("上传的 Word 模板文件不存在")).toBe("render_engine");
  });

  it("states Word render is local, not model API", () => {
    const msg = formatRenderToolError("草稿尚未通过审核");
    expect(msg).toContain("不消耗、也不依赖");
    expect(msg).toContain("模型 API");
    expect(msg).toContain("approve=true");
  });

  it("formats workflow render failures", () => {
    const msg = formatWorkflowRenderFailure("ENOENT: artifacts");
    expect(msg).toContain("execute_workflow");
  });
});
