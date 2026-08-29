import { apiAuthHeaders } from "./lawmind-api-auth.ts";

type ContractChatPin = { root: "workspace" | "project"; relPath: string; kind: "file" | "directory" };

const CONTRACTISH_RE = /(合同|协议|审查|修订|改稿|红线|NDA|保密协议|租赁)/i;

export function shouldAttachContractRevisionIndex(
  items: ContractChatPin[],
  contractBatchRelativeDir: string | undefined,
  instruction?: string,
): boolean {
  if (instruction && CONTRACTISH_RE.test(instruction)) {
    return true;
  }
  if (items.some((it) => it.kind === "directory")) {
    return true;
  }
  const batch = contractBatchRelativeDir?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? "";
  if (!batch) {
    return false;
  }
  const batchPrefix = batch.endsWith("/") ? batch : `${batch}/`;
  for (const it of items) {
    if (it.root !== "workspace") {
      continue;
    }
    const p = it.relPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (p === batch || p.startsWith(batchPrefix)) {
      return true;
    }
  }
  return false;
}

export async function fetchContractRevisionIndexPrefix(apiBase: string, signal?: AbortSignal): Promise<string> {
  try {
    const r = await fetch(`${apiBase}/api/learning/contract-revisions?limit=18`, {
      signal,
      headers: apiAuthHeaders(),
    });
    if (!r.ok) {
      return "";
    }
    const j = (await r.json()) as {
      ok?: boolean;
      items?: Array<{ revisionId: string; finalizedAt: string; title: string; matterId?: string }>;
    };
    if (!j.ok || !Array.isArray(j.items) || j.items.length === 0) {
      return "";
    }
    const lines = j.items.map((it) => {
      const day = typeof it.finalizedAt === "string" && it.finalizedAt.length >= 10 ? it.finalizedAt.slice(0, 10) : "";
      const matter = it.matterId ? ` 案件:${it.matterId}` : "";
      return `- \`${it.revisionId}\` ${day} — ${it.title}${matter}`;
    });
    return [
      "【合同修订积累索引（本机私有库摘要；改稿时可对照历史定稿与 KEY_MODIFICATIONS.md；验收定稿请走「草稿→验收」API）】",
      ...lines,
      "",
    ].join("\n");
  } catch {
    return "";
  }
}
