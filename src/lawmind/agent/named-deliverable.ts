/**
 * Files the lawyer named as this turn's output. Analysis scratch files under
 * artifacts/ do not satisfy these paths.
 */

import fs from "node:fs";
import path from "node:path";

const NAMED_DELIVERABLE_RE =
  /(?:写入|写到|写进|点名输出|文件名为|交件文件名|\bwrite\b|\boutput:)\s*[：:〕】]?\s*[`「"']*([A-Za-z0-9_\u4e00-\u9fff.·-]+\.[A-Za-z0-9]{1,8})/gi;

export function namedWorkspaceDeliverables(instruction: string): string[] {
  const found: string[] = [];
  for (const match of instruction.matchAll(NAMED_DELIVERABLE_RE)) {
    const rel = (match[1] ?? "").replace(/[，。；、]+$/g, "");
    if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("artifacts/")) {
      continue;
    }
    if (!found.includes(rel)) {
      found.push(rel);
    }
  }
  return found;
}

export function missingNamedDeliverables(workspaceDir: string, instruction: string): string[] {
  const root = path.resolve(workspaceDir);
  return namedWorkspaceDeliverables(instruction).filter((rel) => {
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
      return false;
    }
    return !fs.existsSync(abs);
  });
}

export function formatMissingDeliverableNudge(paths: readonly string[]): string {
  const list = paths.join("、");
  const wantsDocx = paths.some((item) => /\.docx?$/i.test(item));
  const how = wantsDocx
    ? "docx 用 draft_document → render_document 写到该相对路径；纯文本用 write_document。"
    : "请用 write_document 把内容写到上述相对路径，然后结束。";
  return `【交件路径】律师指定的文件还不在工作区该路径：${list}。artifacts/analysis/ 下的同名文件不算交件。${how}`;
}
