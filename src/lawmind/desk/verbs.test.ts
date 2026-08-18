import { describe, expect, it } from "vitest";
import { route } from "../router/keyword-route.js";
import { composeSidecarPrompt, DESK_VERBS, inferDeskVerb, taskKindForDeskVerb } from "./verbs.js";

describe("desk verbs", () => {
  it("exposes exactly three product verbs", () => {
    expect(DESK_VERBS.map((v) => v.label)).toEqual(["审这份", "写这封", "查这个问题"]);
  });

  it("recognizes the three verb prefixes", () => {
    expect(inferDeskVerb("审这份合同第3条")).toBe("review");
    expect(inferDeskVerb("写这封催款律师函")).toBe("draft");
    expect(inferDeskVerb("查这个问题：逾期违约金")).toBe("research");
    expect(inferDeskVerb("你好")).toBeUndefined();
  });

  it("maps verbs to engine kinds", () => {
    expect(taskKindForDeskVerb("review")).toBe("analyze.contract");
    expect(taskKindForDeskVerb("draft")).toBe("draft.word");
    expect(taskKindForDeskVerb("research")).toBe("research.legal");
  });

  it("routes the three verbs ahead of generic keywords", () => {
    expect(route({ instruction: "审这份租赁合同第三条" }).kind).toBe("analyze.contract");
    expect(route({ instruction: "写这封催款律师函" }).kind).toBe("draft.word");
    expect(route({ instruction: "查这个问题：逾期利息" }).kind).toBe("research.legal");
  });

  it("builds a sidecar prompt that keeps the verb", () => {
    const prompt = composeSidecarPrompt("review", "第三条 违约金");
    expect(prompt.startsWith("审这份")).toBe(true);
    expect(prompt).toContain("第三条 违约金");
  });
});
