import { describe, expect, it } from "vitest";
import { matterIdOwnedByOpenedFile } from "./lawmind-workspace-file-open";

describe("matterIdOwnedByOpenedFile", () => {
  it("uses the case folder and ignores other files", () => {
    expect(matterIdOwnedByOpenedFile("cases/普华-小华/合同.docx")).toBe("普华-小华");
    expect(matterIdOwnedByOpenedFile("非技术相关/采购合同模板/保洁类合同模板.docx", "project")).toBeNull();
    expect(matterIdOwnedByOpenedFile("canvas/核对-task.canvas.tsx")).toBeNull();
  });
});
