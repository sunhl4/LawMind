/**
 * 投递口：`<workspace>/收件投递/`。
 *
 *   收件投递/<文件>            判案决定归哪个案件
 *   收件投递/<案件编号>/<文件>  直接认这个案件（强键）
 *
 * 入库后原文件移到 `收件投递/已入库/`。整个投递口在 agent 读写黑名单里：
 * 未归档的材料不会被别的案件的对话读到。
 * 音频文件（录音笔/微信语音导出）按 `channel: "recording"` 入库，
 * 由 `recording.ts` 的转写适配器按律师点按补文字。
 */

import fs from "node:fs";
import path from "node:path";
import { MATTER_MATERIALS_MAX_FILE_BYTES } from "../desk/matter-materials.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { isIntakeAudioFile } from "./recording.js";
import type { IntakeMatterIndex } from "./resolve.js";
import { findIntakeItemId, putIntakeBlob, recordIntakeItem, updateIntakeState } from "./store.js";
import { triageIntakeItem } from "./triage.js";

export const INTAKE_DROPZONE_DIRNAME = "收件投递";
/** 企微存档导出目录：由 `wecom-archive.ts` 解析，不按普通投递文件入库。 */
export const INTAKE_WECOM_DIRNAME = "企业微信";
const CONSUMED_DIRNAME = "已入库";
/** 改动不到这么久的文件可能还在拷贝，下一轮再收。 */
const SETTLE_MS = 5_000;
const MAX_FILES_PER_SCAN = 40;

export function intakeDropzoneDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), INTAKE_DROPZONE_DIRNAME);
}

export function ensureIntakeDropzone(workspaceDir: string): string {
  const dir = intakeDropzoneDir(workspaceDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function skipName(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.startsWith("~$") ||
    name === CONSUMED_DIRNAME ||
    name === INTAKE_WECOM_DIRNAME
  );
}

type DropCandidate = { abs: string; rel: string; hintMatterId?: string };

function listDrops(root: string): DropCandidate[] {
  const out: DropCandidate[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skipName(entry.name)) {
      continue;
    }
    if (entry.isFile()) {
      out.push({ abs: path.join(root, entry.name), rel: entry.name });
    } else if (entry.isDirectory()) {
      const sub = path.join(root, entry.name);
      for (const child of fs.readdirSync(sub, { withFileTypes: true })) {
        if (child.isFile() && !skipName(child.name)) {
          out.push({
            abs: path.join(sub, child.name),
            rel: `${entry.name}/${child.name}`,
            hintMatterId: entry.name,
          });
        }
      }
    }
  }
  return out;
}

function moveToConsumed(root: string, drop: DropCandidate, day: string): void {
  const dir = path.join(root, CONSUMED_DIRNAME, day, path.dirname(drop.rel));
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(drop.abs);
  const stem = path.basename(drop.abs, ext);
  for (let n = 1; n < 100; n += 1) {
    const target = path.join(dir, n === 1 ? `${stem}${ext}` : `${stem} (${n})${ext}`);
    if (!fs.existsSync(target)) {
      fs.renameSync(drop.abs, target);
      return;
    }
  }
}

export type DropzoneScanResult = {
  scanned: number;
  recorded: number;
  autoAttached: number;
  /** 超过单文件上限、留在原地的文件（相对投递口）。 */
  tooLarge: string[];
};

export function scanIntakeDropzone(
  workspaceDir: string,
  opts?: { index?: IntakeMatterIndex; now?: Date },
): DropzoneScanResult {
  const result: DropzoneScanResult = { scanned: 0, recorded: 0, autoAttached: 0, tooLarge: [] };
  const root = intakeDropzoneDir(workspaceDir);
  if (!fs.existsSync(root)) {
    return result;
  }
  const now = opts?.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  let index = opts?.index;
  for (const drop of listDrops(root).slice(0, MAX_FILES_PER_SCAN)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(drop.abs);
    } catch {
      continue;
    }
    if (now.getTime() - stat.mtimeMs < SETTLE_MS) {
      continue;
    }
    result.scanned += 1;
    if (stat.size > MATTER_MATERIALS_MAX_FILE_BYTES) {
      result.tooLarge.push(drop.rel);
      continue;
    }
    const content = fs.readFileSync(drop.abs);
    const sha256 = putIntakeBlob(workspaceDir, content);
    const externalKey = `dropzone:${sha256}:${drop.hintMatterId ?? ""}`;
    if (!findIntakeItemId(workspaceDir, { externalKey })) {
      const name = path.basename(drop.abs);
      const { item, created } = recordIntakeItem(
        workspaceDir,
        {
          channel: isIntakeAudioFile(name) ? "recording" : "dropzone",
          externalKey,
          receivedAt: new Date(stat.mtimeMs).toISOString(),
          subject: name,
          text: "",
          attachments: [{ name, sha256, size: content.length }],
          source: { dropzoneRelPath: drop.rel },
        },
        { now },
      );
      if (created) {
        result.recorded += 1;
        index ??= buildIntakeMatterIndex(workspaceDir);
        const triaged = triageIntakeItem(workspaceDir, item, index, {
          ...(drop.hintMatterId ? { hintMatterId: drop.hintMatterId } : {}),
          now,
        });
        if (triaged.status === "attached") {
          result.autoAttached += 1;
        }
      }
    }
    try {
      moveToConsumed(root, drop, day);
    } catch {
      /* 移不走就留在原地；下轮按内容哈希去重 */
    }
  }
  if (result.scanned > 0) {
    updateIntakeState(workspaceDir, (state) => ({ ...state, dropzoneScanAt: now.toISOString() }));
  }
  return result;
}
