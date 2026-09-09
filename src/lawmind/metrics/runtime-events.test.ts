import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProductMetric, listProductMetricEvents } from "./product-metrics.js";
import {
  appendRuntimeEvent,
  listRuntimeEvents,
  readRuntimeEventById,
  recordDeliverEvent,
  recordLawyerEditEvent,
  recordLintRunEvent,
  recordToolCallEvent,
  runtimeEventsPath,
} from "./runtime-events.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-runtime-"));
  dirs.push(d);
  return d;
}

describe("runtime-events", () => {
  it("records a tool_call event with id and timestamp", () => {
    const ws = tmpDir();
    const ev = recordToolCallEvent(ws, {
      toolName: "draft_document",
      toolCallId: "tc-1",
      roundIndex: 0,
      approvalRequired: true,
      resultStatus: "ok",
      taskId: "task-1",
    });
    expect(ev.eventId).toBeTruthy();
    expect(ev.ts).toBeTruthy();
    expect(ev.kind).toBe("tool_call");
    expect(ev.meta?.toolName).toBe("draft_document");
    expect(ev.meta?.approvalRequired).toBe(true);

    const all = listRuntimeEvents(ws);
    expect(all).toHaveLength(1);
    expect(all[0]?.eventId).toBe(ev.eventId);
  });

  it("records lint_run with rule ids and fail counts", () => {
    const ws = tmpDir();
    const ev = recordLintRunEvent(ws, {
      taskId: "task-2",
      deliverableType: "contract.review",
      ruleIds: ["statutory.deposit_cap", "form.or_arbitrate_or_sue"],
      failCount: 1,
      blockerCount: 1,
      warningCount: 0,
    });
    expect(ev.kind).toBe("lint_run");
    expect(ev.meta?.ruleIds).toEqual(["statutory.deposit_cap", "form.or_arbitrate_or_sue"]);
    expect(ev.meta?.failCount).toBe(1);
  });

  it("records lawyer_edit and deliver events", () => {
    const ws = tmpDir();
    const le = recordLawyerEditEvent(ws, {
      taskId: "task-3",
      outcome: "modified",
      lintEscape: true,
      note: "改定金",
    });
    expect(le.kind).toBe("lawyer_edit");
    expect(le.meta?.outcome).toBe("modified");
    expect(le.meta?.lintEscape).toBe(true);

    const de = recordDeliverEvent(ws, {
      taskId: "task-3",
      deliverableType: "contract.review",
      firstPass: false,
      lintEscape: true,
      outputPath: "/tmp/out.docx",
    });
    expect(de.kind).toBe("deliver");
    expect(de.meta?.firstPass).toBe(false);
    expect(de.meta?.outputPath).toBe("/tmp/out.docx");
  });

  it("reads events by id and respects limit/truncation", () => {
    const ws = tmpDir();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(
        appendRuntimeEvent(ws, {
          kind: "tool_call",
          meta: { index: i },
        }).eventId,
      );
    }
    expect(listRuntimeEvents(ws, 2)).toHaveLength(2);
    expect(listRuntimeEvents(ws, 10)).toHaveLength(5);
    expect(readRuntimeEventById(ws, ids[2])?.meta?.index).toBe(2);
    expect(readRuntimeEventById(ws, "missing")).toBeUndefined();
  });

  it("links product metrics to runtime events via runtimeEventId", () => {
    const ws = tmpDir();
    const ev = appendRuntimeEvent(ws, { kind: "lawyer_edit", meta: { outcome: "approved" } });
    appendProductMetric(ws, {
      kind: "first_pass",
      outcome: "ok",
      taskId: "task-4",
      runtimeEventId: ev.eventId,
    });
    const events = listProductMetricEvents(ws);
    expect(events[0]?.runtimeEventId).toBe(ev.eventId);
  });

  it("returns the runtime events path under the workspace", () => {
    const ws = tmpDir();
    expect(runtimeEventsPath(ws)).toContain("lawmind/metrics/runtime-events.jsonl");
  });
});
