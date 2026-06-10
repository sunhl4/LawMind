/**
 * Export docx with tracked changes via officecli (host dependency).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import type { ArtifactDraft } from "../types.js";
import { renderDocxWithOptions } from "./render-docx.js";

export type TrackedDocxRenderResult =
  | { ok: true; outputPath: string; mode: "officecli" | "plain_fallback" }
  | { ok: false; error: string; code: string };

function runOfficeCli(
  args: string[],
  timeoutMs = 120_000,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("officecli", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("officecli_timeout"));
    }, timeoutMs);
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

export async function renderDocxWithTrackedChanges(params: {
  draft: ArtifactDraft;
  outputDir: string;
  proposals: RedlineHunk[];
  officecliCommand?: string;
}): Promise<TrackedDocxRenderResult> {
  const plain = await renderDocxWithOptions(params.draft, params.outputDir, {});
  if (!plain.outputPath) {
    return { ok: false, error: "plain_render_failed", code: "plain_render_failed" };
  }

  const trackedPath = plain.outputPath.replace(/\.docx$/i, ".tracked.docx");
  const manifestPath = path.join(params.outputDir, `${params.draft.taskId}.redline-manifest.json`);
  await fs.writeFile(
    manifestPath,
    JSON.stringify({ proposals: params.proposals, plainPath: plain.outputPath }, null, 2),
    "utf8",
  );

  try {
    const args = [
      "docx",
      "apply-redlines",
      "--input",
      plain.outputPath,
      "--manifest",
      manifestPath,
      "--output",
      trackedPath,
    ];
    if (params.officecliCommand) {
      args.unshift(params.officecliCommand);
    }
    const result = await runOfficeCli(args);
    if (result.code !== 0) {
      return {
        ok: true,
        outputPath: plain.outputPath,
        mode: "plain_fallback",
      };
    }
    await fs.access(trackedPath);
    return { ok: true, outputPath: trackedPath, mode: "officecli" };
  } catch {
    return {
      ok: true,
      outputPath: plain.outputPath,
      mode: "plain_fallback",
    };
  }
}
