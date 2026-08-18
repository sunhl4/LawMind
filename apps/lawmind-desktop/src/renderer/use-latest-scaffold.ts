import { useCallback, useEffect, useState } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { apiGetJson } from "./api-client";
import { pickLatestScaffoldDraft } from "./lawmind-scaffold-copy";

const POLL_MS = 6000;

export function useLatestScaffoldDraft(apiBase: string | undefined, enabled: boolean) {
  const [draft, setDraft] = useState<ArtifactDraft | null>(null);

  const refresh = useCallback(async () => {
    if (!apiBase?.trim() || !enabled) {
      setDraft(null);
      return;
    }
    try {
      const body = await apiGetJson<{ ok?: boolean; drafts?: ArtifactDraft[] }>(apiBase, "/api/drafts");
      setDraft(pickLatestScaffoldDraft(Array.isArray(body.drafts) ? body.drafts : []));
    } catch {
      // 旧服务或缺草稿列表时保持安静
    }
  }, [apiBase, enabled]);

  useEffect(() => {
    if (!apiBase?.trim() || !enabled) {
      setDraft(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [apiBase, enabled, refresh]);

  return { draft, refresh };
}
