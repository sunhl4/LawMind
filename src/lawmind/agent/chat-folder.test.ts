import { describe, expect, it } from "vitest";
import { chatFolderGroupKey, normalizeChatFolderRel, normalizeChatWorkDir } from "./chat-folder.js";

describe("normalizeChatFolderRel", () => {
  it("keeps a relative case folder", () => {
    expect(normalizeChatFolderRel(" 甲案/证据 ")).toBe("甲案/证据");
    expect(normalizeChatFolderRel("甲案\\函件")).toBe("甲案/函件");
  });

  it("drops empty, absolute, and parent segments", () => {
    expect(normalizeChatFolderRel("")).toBeUndefined();
    expect(normalizeChatFolderRel(null)).toBeUndefined();
    expect(normalizeChatFolderRel("/tmp/甲案")).toBeUndefined();
    expect(normalizeChatFolderRel("C:/甲案")).toBeUndefined();
    expect(normalizeChatFolderRel("../甲案")).toBeUndefined();
    expect(normalizeChatFolderRel("甲案/../乙案")).toBeUndefined();
  });
});

describe("normalizeChatWorkDir", () => {
  it("keeps an absolute directory and drops relative paths", () => {
    expect(normalizeChatWorkDir("/Users/shl/nvidia/YX")).toBe("/Users/shl/nvidia/YX");
    expect(normalizeChatWorkDir("/Users/shl/nvidia/YX/")).toBe("/Users/shl/nvidia/YX");
    expect(normalizeChatWorkDir("非技术相关")).toBeUndefined();
    expect(normalizeChatWorkDir("/tmp/../YX")).toBeUndefined();
  });
});

describe("chatFolderGroupKey", () => {
  it("groups nested folders under the case folder", () => {
    expect(chatFolderGroupKey("甲案/证据")).toBe("甲案");
    expect(chatFolderGroupKey(undefined)).toBeNull();
  });
});
