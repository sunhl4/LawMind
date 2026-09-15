/**
 * Soft-fail shape when a matter-scoped tool is called without matterId.
 */

import { listMatterIds } from "../../cases/index.js";

export type MatterRequiredResult = {
  ok: false;
  error: string;
  needsMatter: true;
  matters: string[];
  message: string;
};

/** Structured soft fail so the model/UI can prompt the lawyer to pick a matter. */
export async function matterRequiredResult(workspaceDir: string): Promise<MatterRequiredResult> {
  let matters: string[] = [];
  try {
    matters = (await listMatterIds(workspaceDir)).slice(0, 20);
  } catch {
    matters = [];
  }
  const hint =
    matters.length > 0
      ? `可选案件（最多 ${matters.length}）：${matters.join(", ")}。请先在侧栏选择案件，或在对话空态点「新建案件」，或传入 matter_id。`
      : "工作区尚无案件。请先在对话空态点「新建案件」，再建档后重试。";
  return {
    ok: false,
    error: "未指定案件 ID。",
    needsMatter: true,
    matters,
    message: hint,
  };
}
