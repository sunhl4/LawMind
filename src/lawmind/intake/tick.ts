/**
 * 守护进程每个 tick 调一次：投递口每次都扫（只是 readdir），收案邮箱按间隔拉。
 */

import fs from "node:fs";
import { intakeDropzoneDir, scanIntakeDropzone, type DropzoneScanResult } from "./dropzone.js";
import {
  listIntakeMailAccounts,
  syncIntakeMailbox,
  type IntakeMailFetch,
  type IntakeMailSyncResult,
} from "./mail-intake.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { readIntakeState } from "./store.js";
import { scanWecomArchive, type WecomScanResult } from "./wecom-archive.js";

export const INTAKE_MAIL_POLL_MS = 2 * 60 * 1000;

export type IntakeTickResult = {
  dropzone?: DropzoneScanResult;
  wecom?: WecomScanResult;
  mail: IntakeMailSyncResult[];
};

let running = false;

/** 上一轮没跑完时直接跳过，返回 undefined。 */
export async function runIntakeTick(
  workspaceDir: string,
  lawMindRoot: string,
  opts?: { now?: Date; force?: boolean; accountId?: string; fetch?: IntakeMailFetch },
): Promise<IntakeTickResult | undefined> {
  if (running) {
    return undefined;
  }
  running = true;
  try {
    const now = opts?.now ?? new Date();
    const accounts = listIntakeMailAccounts(workspaceDir).filter(
      (a) => !opts?.accountId || a.id === opts.accountId,
    );
    const hasDropzone = fs.existsSync(intakeDropzoneDir(workspaceDir));
    if (accounts.length === 0 && !hasDropzone) {
      return { mail: [] };
    }
    const index = buildIntakeMatterIndex(workspaceDir);
    const dropzone = hasDropzone ? scanIntakeDropzone(workspaceDir, { index, now }) : undefined;
    const wecom = hasDropzone ? scanWecomArchive(workspaceDir, { index, now }) : undefined;
    const state = readIntakeState(workspaceDir);
    const mail: IntakeMailSyncResult[] = [];
    for (const account of accounts) {
      const last = Date.parse(state.mail[account.id]?.syncedAt ?? "");
      if (!opts?.force && Number.isFinite(last) && now.getTime() - last < INTAKE_MAIL_POLL_MS) {
        continue;
      }
      mail.push(
        await syncIntakeMailbox(workspaceDir, lawMindRoot, account.id, {
          index,
          now,
          ...(opts?.fetch ? { fetch: opts.fetch } : {}),
        }),
      );
    }
    return { ...(dropzone ? { dropzone } : {}), ...(wecom ? { wecom } : {}), mail };
  } finally {
    running = false;
  }
}
