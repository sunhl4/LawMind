/**
 * 案卷行模型热因句：只做叙述 overlay，不参与 urgencyListRank / matterMatchesListFilter。
 */
import { useEffect, useMemo, useState } from "react";
import { apiSendJson } from "./api-client";
import type { MatterUrgencyInput } from "./lawmind-lawyer-desk-format";

type RowInput = {
  matterId: string;
  title: string;
  urgency: MatterUrgencyInput;
  hot: string | null;
};

function cacheKey(matterId: string, hot: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `lawmind.hotline.${matterId}.${hot}.${day}`;
}

function readCached(matterId: string, hot: string): string | null {
  try {
    return localStorage.getItem(cacheKey(matterId, hot))?.trim() || null;
  } catch {
    return null;
  }
}

function writeCached(matterId: string, hot: string, line: string): void {
  try {
    localStorage.setItem(cacheKey(matterId, hot), line);
  } catch {
    /* ignore */
  }
}

export function useMatterHotlineReasons(
  apiBase: string,
  rows: RowInput[],
): Record<string, string> {
  const requestKey = useMemo(
    () =>
      rows
        .filter((r) => r.hot?.trim())
        .map((r) => `${r.matterId}\0${r.title}\0${r.hot}`)
        .join("\n"),
    [rows],
  );
  const [lines, setLines] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!requestKey) {
      setLines((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return undefined;
    }
    const payload = requestKey.split("\n").map((line) => {
      const [matterId, title, hot] = line.split("\0");
      return { matterId: matterId ?? "", title: title ?? "", hot: hot ?? "" };
    });
    const seeded: Record<string, string> = {};
    for (const row of payload) {
      const cached = readCached(row.matterId, row.hot);
      if (cached) {
        seeded[row.matterId] = cached;
      }
    }
    if (Object.keys(seeded).length > 0) {
      setLines((prev) => ({ ...prev, ...seeded }));
    }

    let cancelled = false;
    void apiSendJson<{ ok?: boolean; lines?: Record<string, string>; reason?: string }>(
      apiBase,
      "/api/desk/hotlines",
      "POST",
      { rows: payload },
    )
      .then((j) => {
        if (cancelled || !j.ok || !j.lines || Object.keys(j.lines).length === 0) {
          return;
        }
        setLines((prev) => ({ ...prev, ...j.lines }));
        for (const [matterId, line] of Object.entries(j.lines)) {
          const hot = payload.find((r) => r.matterId === matterId)?.hot;
          if (hot && line.trim()) {
            writeCached(matterId, hot, line.trim());
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiBase, requestKey]);

  return lines;
}
