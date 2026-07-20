import { describe, expect, it } from "vitest";
import {
  buildMeetingAgenda,
  formatMeetingMaterialsSystemText,
} from "./lawmind-meeting-chat";
import type { FileChatContextItem } from "./lawmind-file-chat-context";

const pin = (relPath: string): FileChatContextItem => ({
  id: `workspace|file|${relPath}`,
  root: "workspace",
  relPath,
  kind: "file",
});

describe("lawmind-meeting-chat agenda helpers", () => {
  it("buildMeetingAgenda merges topic and file prefix", () => {
    const agenda = buildMeetingAgenda({
      topic: "和解空间",
      filePins: [pin("contracts/nda.md")],
    });
    expect(agenda).toContain("和解空间");
    expect(agenda).toContain("contracts/nda.md");
    expect(agenda).toContain("本回合重点");
  });

  it("buildMeetingAgenda returns undefined when empty", () => {
    expect(buildMeetingAgenda({})).toBeUndefined();
    expect(buildMeetingAgenda({ topic: "  " })).toBeUndefined();
  });

  it("formatMeetingMaterialsSystemText lists scoped paths", () => {
    expect(formatMeetingMaterialsSystemText([pin("a.md"), pin("b.md")])).toBe(
      "材料（本回合重点）：工作区:a.md；工作区:b.md",
    );
  });
});
