/**
 * 常设工作开跑前，各预设自己的「源在不在」。
 *
 * 邮箱两条走远程同步，缺口在 runner 里就地判断。
 * 续签盯梢和客户周报的源是本案卷宗：没有 matter.json 就没有可核对的到期日或已发生事实。
 * 卷宗在、只是还没有到期合同，不算缺源——那是一次诚实的空结果，交给工作流去写。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";

export function detectDossierSourceGap(
  workspaceDir: string,
  presetId: string,
  matterId: string,
): string | undefined {
  if (presetId !== "renewal-monitor" && presetId !== "client-weekly-update") {
    return undefined;
  }
  if (loadMatter(workspaceDir, matterId)) {
    return undefined;
  }
  if (presetId === "renewal-monitor") {
    return "本案还没有卷宗，没法核对合同到期日";
  }
  return "本案还没有卷宗，没法根据已发生的事实写进展";
}
