import { describe, expect, it } from "vitest";
import { resolveChatHomeDir } from "./lawmind-chat-home-dir";

describe("resolveChatHomeDir", () => {
  it("uses the open workspace root, not the case-data directory", () => {
    expect(
      resolveChatHomeDir({
        workspaceDir: "/Users/shl/nvidia/LawMind",
        projectDir: "/Users/shl/nvidia/YX",
        configured: null,
      }),
    ).toEqual({
      label: "YX",
      path: "/Users/shl/nvidia/YX",
    });
  });

  it("falls back to the case-data directory when no workspace folder is open", () => {
    expect(
      resolveChatHomeDir({
        workspaceDir: "/Users/shl/nvidia/LawMind",
        projectDir: null,
        configured: null,
      }),
    ).toEqual({
      label: "LawMind",
      path: "/Users/shl/nvidia/LawMind",
    });
  });

  it("uses a directory chosen in settings, and a subfolder of the open folder stays relative", () => {
    expect(
      resolveChatHomeDir({
        workspaceDir: "/Users/shl/nvidia/LawMind",
        projectDir: "/Users/shl/nvidia/YX",
        configured: "/Users/shl/nvidia/YX/非技术相关",
      }),
    ).toEqual({
      label: "非技术相关",
      path: "/Users/shl/nvidia/YX/非技术相关",
      folderRel: "非技术相关",
    });
  });
});
