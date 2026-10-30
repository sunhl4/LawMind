/**
 * 独立 pane 窗的初始上下文。纯函数，方便单测，也避免根壳堆初始化分支。
 */

import type { DeskMatterFocus } from "./desk-matter-focus";
import type { LawmindWorkspacePaneRoute } from "../lawmind-popout-route";

export function paneInitialMatterCockpitOpen(
  route?: LawmindWorkspacePaneRoute,
): boolean {
  return (
    route?.pane === "middle" &&
    Boolean(route.matterId?.trim()) &&
    !route.draftTaskId?.trim() &&
    !route.relPath?.trim() &&
    (route.middleView === undefined || route.middleView === "matter")
  );
}

export function paneInitialDeskMatterFocus(
  route?: LawmindWorkspacePaneRoute,
): DeskMatterFocus {
  const matterId = route?.matterId?.trim();
  return route?.pane === "middle" &&
    matterId &&
    !route.relPath?.trim() &&
    !route.draftTaskId?.trim()
    ? { id: matterId, n: 1 }
    : null;
}
