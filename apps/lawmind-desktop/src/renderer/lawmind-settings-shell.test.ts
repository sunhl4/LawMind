import { describe, expect, it, vi } from "vitest";
import { clearProjectDirectory } from "./lawmind-settings-shell.js";

describe("lawmind-settings-shell", () => {
  it("clears the configured project directory", async () => {
    const setProjectDir = vi.fn().mockResolvedValue({
      ok: true,
      projectDir: null,
    });

    await expect(
      clearProjectDirectory({
        config: {
          apiBase: "http://127.0.0.1:4312",
          workspaceDir: "/tmp/workspace",
          projectDir: "/tmp/project",
          envFilePath: "/tmp/workspace/.env",
          retrievalMode: "single",
        },
        setProjectDir,
      }),
    ).resolves.toEqual({ projectDir: null });

    expect(setProjectDir).toHaveBeenCalledWith(null);
  });

  it("returns a fallback error when clearing fails", async () => {
    await expect(
      clearProjectDirectory({
        config: {
          apiBase: "http://127.0.0.1:4312",
          workspaceDir: "/tmp/workspace",
          projectDir: "/tmp/project",
          envFilePath: "/tmp/workspace/.env",
          retrievalMode: "single",
        },
        setProjectDir: vi.fn().mockResolvedValue({ ok: false }),
      }),
    ).resolves.toEqual({ error: "关闭项目失败" });
  });
});
