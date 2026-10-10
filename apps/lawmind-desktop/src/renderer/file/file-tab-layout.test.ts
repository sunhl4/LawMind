import { describe, expect, it } from "vitest";
import { WPS_TAB_NAME_UNITS, fileTabAddress, wpsTabLabel } from "./file-tab-layout";

describe("wpsTabLabel", () => {
  it("leaves a short name intact", () => {
    expect(wpsTabLabel("SQD.pdf")).toBe("SQD.pdf");
  });

  it("keeps the front of the name and folds the tail", () => {
    const full = "吉利项目价格拆解（国浩）20260228v1.xlsx";
    const label = wpsTabLabel(full);
    expect(label.startsWith("吉利项目价格")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.includes(".xlsx")).toBe(false);
    expect(full.startsWith(label.slice(0, -1))).toBe(true);
  });

  it("stays within the WPS character budget", () => {
    const label = wpsTabLabel("股权转让协议-修订稿-律师修改版-20261010.docx");
    let units = 0;
    for (const char of label) {
      units += (char.codePointAt(0) ?? 0) > 0xff ? 1 : 0.5;
    }
    expect(units).toBeLessThanOrEqual(WPS_TAB_NAME_UNITS);
  });
});

describe("fileTabAddress", () => {
  it("shows the machine path as segments, including the file", () => {
    expect(
      fileTabAddress(
        "workspace",
        "paper/JCP-revision/response.docx",
        "/Users/shl/Paper",
        null,
      ),
    ).toBe("Users › shl › Paper › paper › JCP-revision › response.docx");
  });

  it("uses the matter folder when the file lives in the project root", () => {
    expect(fileTabAddress("project", "合同.docx", "/Users/shl/Paper", "/Users/shl/Matters/国浩")).toBe(
      "Users › shl › Matters › 国浩 › 合同.docx",
    );
  });
});
