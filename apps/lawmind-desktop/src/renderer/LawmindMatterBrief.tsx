import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";

type BriefCache = { text: string; hash: string; at: string };

type BriefResponse =
  | { ok: true; text: string; hash: string; cached?: boolean }
  | { ok: false; reason?: string; hash?: string };

function cacheKey(matterId: string): string {
  return `lawmind.matterBrief.${matterId}`;
}

function readCache(matterId: string): BriefCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(matterId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as BriefCache;
    if (typeof parsed.text === "string" && typeof parsed.hash === "string") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(matterId: string, entry: BriefCache): void {
  try {
    localStorage.setItem(cacheKey(matterId), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

type Props = {
  apiBase: string;
  matterId: string;
};

export function LawmindMatterBrief({ apiBase, matterId }: Props): ReactNode {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (force = false) => {
      const mid = matterId.trim();
      if (!mid) {
        return;
      }
      if (!force) {
        const cached = readCache(mid);
        if (cached?.text.trim()) {
          setText(cached.text);
        }
      }
      setLoading(true);
      try {
        const j = await apiGetJson<BriefResponse>(
          apiBase,
          `/api/matters/${encodeURIComponent(mid)}/brief`,
        );
        if (j.ok && j.text?.trim()) {
          setText(j.text.trim());
          writeCache(mid, { text: j.text.trim(), hash: j.hash, at: new Date().toISOString() });
        }
      } catch {
        /* keep last shown / cached brief */
      } finally {
        setLoading(false);
      }
    },
    [apiBase, matterId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!text && !loading) {
    return null;
  }

  return (
    <div className="lm-matter-brief" data-testid="lm-matter-brief" aria-busy={loading}>
      {text ? <p>{text}</p> : null}
      <button
        type="button"
        className="lm-btn lm-btn-ghost lm-btn-sm"
        disabled={loading}
        onClick={() => void load(true)}
      >
        {loading ? "刷新中…" : "刷新简报"}
      </button>
    </div>
  );
}
