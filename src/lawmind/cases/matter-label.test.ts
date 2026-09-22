import { describe, expect, it } from "vitest";
import {
  displayNameFromImportBasename,
  formatTaskLineForNextActions,
  parseMatterDisplayNameFromCase,
  resolveMatterHeadline,
  resolveMatterSidebarLabel,
  suggestMatterIdForImport,
} from "./matter-label.js";

const caseStub = (extra: string) => `# x

## 1. 基本信息

- matterId: m1
${extra}
- 案由:

## 2. 当事人

-
`;

describe("matter-label", () => {
  it("ignores template placeholder for 案件名称（展示用）", () => {
    const raw = caseStub("- 案件名称（展示用）: _（侧栏显示；未填）_");
    expect(parseMatterDisplayNameFromCase(raw)).toBeUndefined();
    expect(resolveMatterSidebarLabel(raw, "m1")).toBe("m1");
  });

  it("returns lawyer-filled display name", () => {
    const raw = caseStub("- 案件名称（展示用）: 张三定金纠纷");
    expect(parseMatterDisplayNameFromCase(raw)).toBe("张三定金纠纷");
    expect(resolveMatterSidebarLabel(raw, "m1")).toBe("张三定金纠纷");
    expect(resolveMatterHeadline(raw, "m1", "核心 A")).toBe("张三定金纠纷");
  });

  it("falls back headline to core issue when no display name", () => {
    const raw = caseStub("");
    expect(resolveMatterHeadline(raw, "mid", "争点 X")).toBe("争点 X");
  });

  it("formats next-action line from 原始指令 snippet", () => {
    const line = formatTaskLineForNextActions({
      status: "created",
      summary: "任务 cbc9: 任务类型：x。原始指令：「起草一份房屋」其余",
    });
    expect(line).toBe("created：起草一份房屋");
  });

  it("suggestMatterIdForImport uses salt to avoid collisions in one batch", () => {
    const fp = "/tmp/same.docx";
    expect(suggestMatterIdForImport(fp, 0)).not.toBe(suggestMatterIdForImport(fp, 1));
  });

  it("displayNameFromImportBasename strips extension and normalizes", () => {
    expect(displayNameFromImportBasename("  ./A/B/租赁合同纠纷_v2.docx ")).toBe("租赁合同纠纷 v2");
  });

  it("displayNameFromImportBasename keeps dotted folder names when importing directory", () => {
    expect(
      displayNameFromImportBasename("/Volumes/x/客户材料/foo.bar", { treatAsDirectory: true }),
    ).toBe("foo.bar");
  });
});
