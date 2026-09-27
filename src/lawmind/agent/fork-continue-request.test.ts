import { describe, expect, it } from "vitest";
import { FORK_CONTINUE_WORK_MESSAGE, parseForkContinueRequest } from "./fork-continue-request.js";

describe("parseForkContinueRequest", () => {
  it("把「重开一个对话继续」认成承前分叉，并接着办", () => {
    expect(parseForkContinueRequest("重开一个对话继续")).toEqual({
      remainder: "",
      continueWork: true,
    });
  });

  it("认用量面板上的同一句，没有「继续」就只分叉", () => {
    expect(parseForkContinueRequest("另起新对话（带上文）")).toEqual({
      remainder: "",
      continueWork: false,
    });
    expect(parseForkContinueRequest("另起对话，带上上下文")).toEqual({
      remainder: "",
      continueWork: false,
    });
  });

  it("请另起并继续时，新会话要接着办", () => {
    expect(parseForkContinueRequest("请另起新对话（带上文）继续")).toEqual({
      remainder: "",
      continueWork: true,
    });
  });

  it("混合交办时去掉分叉句，留下还要办的事", () => {
    const parsed = parseForkContinueRequest(
      "先把清单落成 xlsx。然后请重开一个对话，带上上下文继续写首篇长文。",
    );
    expect(parsed?.continueWork).toBe(true);
    expect(parsed?.remainder).toContain("清单");
    expect(parsed?.remainder).toContain("首篇长文");
    expect(parsed?.remainder).not.toMatch(/重开|另起|新开/);
    expect(parseForkContinueRequest(parsed?.remainder ?? "")).toBeNull();
  });

  it("不把审核、另起一稿、或文稿里的功能名当成要分叉", () => {
    expect(parseForkContinueRequest("请重开审核")).toBeNull();
    expect(parseForkContinueRequest("不要另起一稿")).toBeNull();
    expect(parseForkContinueRequest("在方案里写上另起新对话（带上文）即可")).toBeNull();
    expect(parseForkContinueRequest("双方同意另起新对话解决争议")).toBeNull();
    expect(parseForkContinueRequest("用户可以另起新对话继续使用旧稿")).toBeNull();
  });

  it("自动续办那句不会再次触发分叉", () => {
    expect(parseForkContinueRequest(FORK_CONTINUE_WORK_MESSAGE)).toBeNull();
  });
});
