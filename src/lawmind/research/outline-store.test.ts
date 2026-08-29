import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  approveResearchOutline,
  persistResearchOutline,
  readResearchOutline,
} from "./outline-store.js";
import type { ResearchOutline } from "./research-outline.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("outline-store", () => {
  it("persists, reads, and approves outline", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ol-store-"));
    dirs.push(ws);
    const outline: ResearchOutline = {
      title: "大纲",
      status: "pending",
      sections: [{ id: "1", heading: "章", purpose: "p", bullets: ["b"] }],
      notes: ["n"],
    };
    persistResearchOutline(ws, "task-1", outline);
    expect(readResearchOutline(ws, "task-1")?.status).toBe("pending");
    const approved = approveResearchOutline(ws, "task-1", {
      lawyerNotes: "ok",
      sections: [{ id: "1", heading: "修订章", purpose: "p", bullets: ["b2"] }],
    });
    expect(approved?.status).toBe("approved");
    expect(readResearchOutline(ws, "task-1")?.sections[0]?.heading).toBe("修订章");
    expect(readResearchOutline(ws, "task-1")?.notes.some((n) => n.includes("ok"))).toBe(true);
  });
});
