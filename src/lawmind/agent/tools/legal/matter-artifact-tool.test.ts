import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { matterArtifactUpdate } from "./matter-artifact-tool.js";

const dirs: string[] = [];

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-artifact-tool-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, matterId?: string): AgentContext {
  return {
    workspaceDir,
    sessionId: "s1",
    actorId: "lawyer",
    ...(matterId ? { matterId } : {}),
  } as AgentContext;
}

function readJson(ws: string, matterId: string, file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ws, "cases", matterId, file), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("matter_artifact_update", () => {
  it("writes a timeline to the case root with evidence and summary", async () => {
    const ws = tmpWs();
    const result = await matterArtifactUpdate.execute(
      {
        kind: "case-timeline",
        events: [
          {
            date: "2026-03-01",
            title: "立案",
            evidence: [{ filePath: "cases/m/materials/起诉状.pdf", lineRef: "P1" }],
          },
          { date: "2026-02-10", title: "签约", evidence: [] },
        ],
      },
      ctx(ws, "m"),
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      file: string;
      itemCount: number;
      unanchoredCount: number;
      lawyerMessage: string;
    };
    expect(data.file).toBe("project.case-timeline.json");
    expect(data.itemCount).toBe(2);
    expect(data.unanchoredCount).toBe(1);
    expect(data.lawyerMessage).toContain("待补出处");

    const saved = readJson(ws, "m", "project.case-timeline.json");
    const events = saved.events as Array<{ title: string; sortKey: string }>;
    expect(events.map((e) => e.title)).toEqual(["签约", "立案"]);
    expect(events[1]?.sortKey).toBe("20260301");
  });

  it("upserts by 日期|标题 instead of duplicating or wiping the file", async () => {
    const ws = tmpWs();
    await matterArtifactUpdate.execute(
      {
        kind: "case-timeline",
        events: [
          { date: "2026-03-01", title: "立案", evidence: [{ filePath: "a.txt", lineRef: "L1" }] },
          { date: "2026-03-05", title: "开庭", evidence: [] },
        ],
      },
      ctx(ws, "m"),
    );
    await matterArtifactUpdate.execute(
      {
        kind: "case-timeline",
        events: [
          {
            date: "2026-03-01",
            title: "立案",
            summary: "补充受理通知",
            evidence: [{ filePath: "b.txt", lineRef: "L2" }],
          },
        ],
      },
      ctx(ws, "m"),
    );
    const saved = readJson(ws, "m", "project.case-timeline.json");
    const events = saved.events as Array<{ title: string; summary?: string; evidence: unknown[] }>;
    expect(events.map((e) => e.title)).toEqual(["立案", "开庭"]);
    expect(events[0]?.summary).toBe("补充受理通知");
    expect(events[0]?.evidence.length).toBe(1);
  });

  it("rejects empty payloads so a good file is never replaced by an empty table", async () => {
    const ws = tmpWs();
    const first = await matterArtifactUpdate.execute(
      {
        kind: "case-chronology",
        entries: [{ date: "2026-01-09", fact: "对账确认欠款", evidence: [{ filePath: "a.txt" }] }],
      },
      ctx(ws, "m"),
    );
    expect(first.ok).toBe(true);

    const empty = await matterArtifactUpdate.execute(
      { kind: "case-chronology", entries: [] },
      ctx(ws, "m"),
    );
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("内容为空");

    const saved = readJson(ws, "m", "project.case-chronology.json");
    expect((saved.entries as unknown[]).length).toBe(1);
  });

  it("requires a matter id and a valid kind", async () => {
    const ws = tmpWs();
    const noMatter = await matterArtifactUpdate.execute(
      { kind: "case-timeline", events: [{ date: "2026-01-01", title: "x" }] },
      ctx(ws),
    );
    expect(noMatter.ok).toBe(false);
    expect(noMatter.error).toContain("案件");

    const badKind = await matterArtifactUpdate.execute(
      { kind: "timeline", events: [] },
      ctx(ws, "m"),
    );
    expect(badKind.ok).toBe(false);
    expect(badKind.error).toContain("kind");
  });

  it("writes a mindmap with nested children and rejects >6 depth silently truncating", async () => {
    const ws = tmpWs();
    const result = await matterArtifactUpdate.execute(
      {
        kind: "case-mindmap",
        title: "租赁纠纷脉络",
        root: {
          label: "租赁纠纷",
          kind: "issue",
          children: [
            { label: "合同效力", children: [{ label: "签章真实性" }] },
            { label: "租金标准", kind: "party" },
          ],
        },
      },
      ctx(ws, "m"),
    );
    expect(result.ok).toBe(true);
    const saved = readJson(ws, "m", "project.case-mindmap.json");
    expect(saved.title).toBe("租赁纠纷脉络");
    const root = saved.root as { label: string; children: unknown[] };
    expect(root.label).toBe("租赁纠纷");
    expect(root.children.length).toBe(2);
  });
});
