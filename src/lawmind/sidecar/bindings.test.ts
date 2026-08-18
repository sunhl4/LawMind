import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindSidecarIngestToTask,
  extractSidecarIngestPathsFromPins,
  extractSidecarIngestPathsFromText,
  findSidecarIngestPathForTask,
  maybeBindSidecarIngests,
} from "./bindings.js";
import { ingestSidecarSelection } from "./ingest.js";

describe("sidecar bindings", () => {
  it("extracts inbox sidecar paths from pins and prose", () => {
    expect(
      extractSidecarIngestPathsFromPins([
        { root: "workspace", relPath: "inbox/sidecar-word-20260818-010203.md", kind: "file" },
        { relPath: "inbox/../MEMORY.md" },
      ]),
    ).toEqual(["inbox/sidecar-word-20260818-010203.md"]);
    expect(
      extractSidecarIngestPathsFromText("请分析 inbox/sidecar-wps-20260818-010203.md 和其它材料"),
    ).toEqual(["inbox/sidecar-wps-20260818-010203.md"]);
  });

  it("binds one ingest to one task and lets the later task take over", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-bind-"));
    const ingested = ingestSidecarSelection(dir, {
      source: "word",
      text: "第三条 甲方逾期应支付违约金。",
      verb: "review",
    });
    bindSidecarIngestToTask(dir, ingested.relativePath, "task-a");
    expect(findSidecarIngestPathForTask(dir, "task-a")).toBe(ingested.relativePath);
    maybeBindSidecarIngests(dir, "task-b", [ingested.relativePath]);
    expect(findSidecarIngestPathForTask(dir, "task-a")).toBeUndefined();
    expect(findSidecarIngestPathForTask(dir, "task-b")).toBe(ingested.relativePath);
  });
});
