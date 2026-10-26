import { describe, expect, it } from "vitest";
import {
  litigationPrimary,
  litigationRevisionSkillIds,
  pleadingScope,
} from "./litigation-primary.js";

describe("litigation skill routing", () => {
  it("reads the target after the drafting verb, not a mentioned source pleading", () => {
    expect(pleadingScope("根据起诉状写答辩状")).toBe("写答辩状");
    expect(pleadingScope("针对被告的答辩状写一份起诉状")).toBe("写一份起诉状");
    expect(pleadingScope("写起诉状")).toBe("写起诉状");
  });

  it("picks the complaint template only when the target is a complaint", () => {
    expect(litigationPrimary("写起诉状")).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
    expect(litigationPrimary("根据起诉状写答辩状")).toEqual([
      "litigation-stage-route",
      "evidence-argument-chain",
    ]);
  });

  it("keeps specialist routes ahead of the generic stage route", () => {
    expect(litigationPrimary("离婚诉讼起诉状")[0]).toBe("family-matter-route");
    expect(litigationPrimary("写离婚起诉状")[0]).toBe("family-matter-route");
    expect(litigationPrimary("写离婚答辩状")[0]).toBe("family-matter-route");
    expect(litigationPrimary("写刑事辩护词")[0]).toBe("criminal-stage-route");
    expect(litigationPrimary("债权申报材料")[0]).toBe("bankruptcy-stage-route");
    expect(litigationPrimary("专利侵权比对意见")[0]).toBe("ip-dispute-route");
  });

  it("picks the redraft template from the sentence after the revision verb", () => {
    // P2 regression: 「根据起诉状改答辩状」 used to pass the whole sentence into
    // `pleadingScope`, so the complaint (the *source*) won and the complaint
    // template was injected into a defence redraft.
    expect(litigationRevisionSkillIds("修改这份起诉状", ["民事起诉状.docx"])).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
    expect(
      litigationRevisionSkillIds("根据起诉状改答辩状", ["民事起诉状.docx", "民事答辩状.docx"]),
    ).toEqual(["litigation-stage-route", "evidence-argument-chain"]);
    expect(litigationRevisionSkillIds("把起诉状改成答辩状", ["民事起诉状.docx"])).toEqual([
      "litigation-stage-route",
      "evidence-argument-chain",
    ]);
    expect(litigationRevisionSkillIds("修改这份上诉状", ["民事上诉状.docx"])[0]).toBe(
      "litigation-stage-route",
    );
    expect(litigationRevisionSkillIds("修改这份辩护词", ["辩护词.docx"])[0]).toBe(
      "criminal-stage-route",
    );
    expect(litigationRevisionSkillIds("修改这份离婚起诉状", ["离婚起诉状.docx"])[0]).toBe(
      "family-matter-route",
    );
  });

  it("follows the Word filename when the instruction only says 改一下", () => {
    expect(litigationRevisionSkillIds("帮我改一下", ["民事起诉状.docx"])).toEqual([
      "complaint-elements-fill",
      "evidence-argument-chain",
    ]);
    expect(litigationRevisionSkillIds("帮我改一下", ["民事答辩状.docx"])).toEqual([
      "litigation-stage-route",
      "evidence-argument-chain",
    ]);
    // Non-Word pins must not pick the template when no pleading is named.
    expect(litigationRevisionSkillIds("帮我改一下", ["开庭传票.pdf"])).toEqual([
      "litigation-stage-route",
      "evidence-argument-chain",
    ]);
  });
});
