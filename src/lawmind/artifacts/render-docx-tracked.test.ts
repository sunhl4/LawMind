import { describe, expect, it, vi } from "vitest";
import { renderDocxWithTrackedChanges } from "./render-docx-tracked.js";

vi.mock("./render-docx.js", () => ({
  renderDocxWithOptions: vi.fn(async () => ({ outputPath: "/tmp/out.docx" })),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    return {
      stderr: { on: (ev: string, fn: (arg?: unknown) => void) => handlers[ev]?.push(fn) },
      on: (ev: string, fn: (arg?: unknown) => void) => {
        handlers[ev] = handlers[ev] ?? [];
        handlers[ev].push(fn);
        if (ev === "close") {
          queueMicrotask(() => fn(1));
        }
      },
      kill: vi.fn(),
    };
  }),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async () => undefined),
    access: vi.fn(async () => {
      throw new Error("ENOENT");
    }),
  };
});

describe("renderDocxWithTrackedChanges", () => {
  it("falls back to plain docx when officecli fails", async () => {
    const result = await renderDocxWithTrackedChanges({
      draft: {
        taskId: "task-1",
        title: "Test",
        summary: "",
        templateId: "general",
        output: "docx",
      } as import("../types.js").ArtifactDraft,
      outputDir: "/tmp",
      proposals: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("plain_fallback");
      expect(result.outputPath).toContain("out.docx");
    }
  });
});
