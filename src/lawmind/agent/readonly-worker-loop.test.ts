import { describe, expect, it } from "vitest";
import { formatSidecarProgressLabel, sidecarWaitLabel } from "./readonly-worker-loop.js";

describe("sidecarWaitLabel", () => {
  it("names the hidden model wait for draft and folder workers", () => {
    expect(sidecarWaitLabel("写稿工")).toBe("正在写稿");
    expect(sidecarWaitLabel("审查工")).toBe("正在审查");
    expect(sidecarWaitLabel("探查工")).toBe("正在探查目录");
    expect(sidecarWaitLabel("助手")).toBe("正在办理");
  });
});

describe("formatSidecarProgressLabel", () => {
  it("uses lawyer-facing titles without snake_case tool ids", () => {
    const start = formatSidecarProgressLabel("list_dir", { path: "材料卷" }, "start");
    expect(start).toContain("正在");
    expect(start).toContain("材料卷");
    expect(start).not.toContain("list_dir");
    const done = formatSidecarProgressLabel("explore_folder", { path: "材料卷" }, "ok");
    expect(done.startsWith("已完成")).toBe(true);
    expect(done).not.toContain("explore_folder");
    const fail = formatSidecarProgressLabel("read_project_file", { path: "函.txt" }, "fail");
    expect(fail.startsWith("未读到")).toBe(true);
    expect(fail).not.toContain("read_project_file");
  });
});
