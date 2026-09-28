import { describe, expect, it } from "vitest";
import { canvasPathsFromMessages, canvasPathsInText } from "./canvas-paths";

describe("canvasPathsInText", () => {
  it("keeps workspace-relative canvas files and drops parent paths", () => {
    expect(canvasPathsInText("写好了 notes/brief.canvas.tsx 和 ../x.canvas.tsx")).toEqual([
      "notes/brief.canvas.tsx",
    ]);
  });

  it("reads a canvas path from the latest assistant tool detail", () => {
    expect(
      canvasPathsFromMessages([
        { role: "assistant", text: "旧的 old.canvas.tsx" },
        {
          role: "assistant",
          text: "完成",
          activity: [
            {
              id: "t",
              kind: "tool",
              toolCallId: "t",
              toolName: "write",
              label: "写入",
              status: "done",
              detail: "cases/m/fee.canvas.tsx",
              progress: [],
            },
          ],
        },
      ]),
    ).toEqual(["cases/m/fee.canvas.tsx"]);
  });
});
