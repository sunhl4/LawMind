import { describe, expect, it } from "vitest";
import {
  mayImplicitlyReuseLinkedDraft,
  PDF_NOT_REVISABLE_MESSAGE,
  trackedBaselineRefusal,
} from "./deliverable-judgment.js";

describe("tracked baseline", () => {
  it("refuses a pdf or image path as a tracked baseline", () => {
    expect(trackedBaselineRefusal("隔断采购合同.pdf")?.code).toBe("pdf_not_revisable");
    expect(trackedBaselineRefusal("隔断采购合同.pdf")?.message).toBe(PDF_NOT_REVISABLE_MESSAGE);
    expect(trackedBaselineRefusal("扫描件.png")?.code).toBe("pdf_not_revisable");
    expect(trackedBaselineRefusal("移动隔断项目_20261008_01.docx")).toBeUndefined();
    expect(trackedBaselineRefusal(undefined)).toBeUndefined();
  });

  it("does not keep the open draft just because this turn brought no new file", () => {
    expect(mayImplicitlyReuseLinkedDraft({ baselineRel: "移动隔断项目_20261008_01.docx" })).toBe(
      false,
    );
    expect(mayImplicitlyReuseLinkedDraft({})).toBe(false);
  });

  it("keeps the open draft when this turn is already an edit", () => {
    expect(
      mayImplicitlyReuseLinkedDraft({
        baselineRel: "移动隔断项目_20261008_01.docx",
        wordRevisionTurn: true,
      }),
    ).toBe(true);
    expect(
      mayImplicitlyReuseLinkedDraft({
        mailContractTurn: true,
      }),
    ).toBe(true);
  });
});
