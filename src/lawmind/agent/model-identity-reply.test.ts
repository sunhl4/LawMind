import { describe, expect, it } from "vitest";
import {
  buildModelIdentityReply,
  isModelIdentityQuestion,
  tryBuildModelIdentityReply,
} from "./model-identity-reply.js";

const SAMPLE_IDENTITY = {
  catalogLabel: "通义千问 Max",
  providerLabel: "阿里云 DashScope / 通义",
  upstreamModel: "qwen-max",
  catalogId: "builtin:qwen-max",
};

describe("model-identity-reply", () => {
  it("detects common Chinese model questions", () => {
    expect(isModelIdentityQuestion("你是什么模型")).toBe(true);
    expect(isModelIdentityQuestion("您现在用的是什么大模型？")).toBe(true);
    expect(isModelIdentityQuestion("底层是哪个模型")).toBe(true);
  });

  it("ignores long legal task instructions", () => {
    expect(
      isModelIdentityQuestion(
        "请审查这份房屋租赁合同并说明违约责任条款是否对承租人不公平，另外你是什么模型",
      ),
    ).toBe(false);
  });

  it("builds a reply with configured identity", () => {
    const reply = tryBuildModelIdentityReply("你是什么模型", SAMPLE_IDENTITY);
    expect(reply).toContain("通义千问 Max");
    expect(reply).toContain("`qwen-max`");
    expect(reply).not.toContain("看不到配置");
    expect(reply).not.toMatch(/sk-/);
  });

  it("returns null without runtime identity", () => {
    expect(tryBuildModelIdentityReply("你是什么模型", undefined)).toBeNull();
  });

  it("reply template mentions LawMind", () => {
    expect(buildModelIdentityReply(SAMPLE_IDENTITY)).toContain("LawMind");
  });
});
