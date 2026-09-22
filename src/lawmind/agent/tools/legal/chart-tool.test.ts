import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderChart } from "./chart-tool.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("render_chart", () => {
  it("writes spec json under artifacts/charts", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-chart-"));
    dirs.push(ws);
    const result = await renderChart.execute(
      {
        spec: {
          title: "试算",
          type: "bar",
          categories: ["a", "b"],
          series: [{ name: "s", values: [1, 2] }],
          notes: "来自费用表",
        },
      },
      { workspaceDir: ws, sessionId: "s", actorId: "t" },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { path: string; spec: { title: string }; hint: string };
    expect(data.path.startsWith("artifacts/charts/")).toBe(true);
    expect(fs.existsSync(path.join(ws, data.path))).toBe(true);
    expect(data.spec.title).toBe("试算");
    expect(data.hint).toContain("lm-chart");
  });
});
