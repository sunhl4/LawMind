import { deskVerbCard, type DeskVerb } from "../../../../src/lawmind/desk/verbs.ts";
import { apiGetJson, apiSendJson } from "./api-client";

export type SidecarPendingItem = {
  relativePath: string;
  title: string;
  source: "word" | "wps" | "paste";
  verb: DeskVerb;
  prompt: string;
  charCount: number;
  mtimeMs: number;
};

export function sidecarSourceLabel(source: SidecarPendingItem["source"]): string {
  if (source === "wps") {
    return "WPS";
  }
  if (source === "paste") {
    return "粘贴";
  }
  return "Word";
}

export function sidecarInboxBannerText(item: SidecarPendingItem): string {
  const verb = deskVerbCard(item.verb).label;
  return `${sidecarSourceLabel(item.source)} 送来一份选区，可用「${verb}」继续。`;
}

export async function fetchSidecarPending(apiBase: string): Promise<SidecarPendingItem[]> {
  const body = await apiGetJson<{ ok?: boolean; items?: SidecarPendingItem[] }>(
    apiBase,
    "/api/sidecar/pending",
  );
  return Array.isArray(body.items) ? body.items : [];
}

export async function acknowledgeSidecarPending(
  apiBase: string,
  relativePath: string,
): Promise<void> {
  await apiSendJson(apiBase, "/api/sidecar/pending/ack", "POST", { relativePath });
}
