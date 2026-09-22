/**
 * 类案源就绪度：让「装上即能用」不依赖律师记环境变量。
 *
 * 中国律师查的是类案与裁判规则。可用的真实来源只有两类：
 * - 本地自建 cncases/caseopen 索引（真实裁判文书，用户自持）
 * - CourtListener / Free Law Project（美国判例，公开免费）
 *
 * 本模块做三件事：
 * 1. **自动检测**：本机存在 caseopen 索引即视为可用，不必再设开关。
 * 2. **诚实降级**：都不就绪时明确说「未接类案库」，并给出可操作的启用路径，
 *    **不编造案号/裁判要旨**（与 search_case_law 的拒答口径一致）。
 * 3. **状态可见**：给 Doctor 一行结论，避免律师以为已经在查类案。
 */

import {
  DEFAULT_CASEOPEN_SEARCH,
  isCaseopenLiveEnabled,
  resolveCaseopenEndpoint,
} from "./providers/open-law/caseopen.js";
import {
  isCourtListenerLiveEnabled,
  resolveCourtListenerEndpoint,
} from "./providers/open-law/courtlistener.js";

export type CaseLawSourceReadiness = {
  id: "caseopen" | "courtlistener";
  label: string;
  ready: boolean;
  /** 是否无需律师配置即视为可用（自动检测或默认开启）。 */
  automatic: boolean;
  licenseNote: string;
  howToEnable: string;
  detail: string;
};

export type CaseLawReadiness = {
  ready: boolean;
  readyIds: string[];
  sources: CaseLawSourceReadiness[];
  /** 都不能用时的可操作指引；就绪时为空。 */
  setupHint?: string;
  note: string;
};

/** 本机 caseopen 探测结果缓存（由 probeCaseLawSources 写入）。 */
type ProbeCache = {
  caseopenReachable: boolean;
  probedAt: number;
};
let probeCache: ProbeCache | null = null;
export const CASE_LAW_PROBE_TTL_MS = 10 * 60 * 1000;

/** 测试用：清空探测缓存。 */
export function resetCaseLawProbeCache(): void {
  probeCache = null;
}

/** 探测结果是否仍然新鲜。 */
export function caseLawProbeFresh(now = Date.now()): boolean {
  return probeCache != null && now - probeCache.probedAt < CASE_LAW_PROBE_TTL_MS;
}

/**
 * caseopen 是否可视为自动可用：
 * - 显式开关打开 → 可用；
 * - 或探测到本机索引可达 → 可用（无需律师配置）。
 */
export function isCaseopenAutoReady(opts?: { now?: number }): boolean {
  if (isCaseopenLiveEnabled()) {
    return true;
  }
  const now = opts?.now ?? Date.now();
  return caseLawProbeFresh(now) && probeCache?.caseopenReachable === true;
}

export function resolveCaseLawReadiness(opts?: { now?: number }): CaseLawReadiness {
  const caseEnabled = isCaseopenAutoReady({ now: opts?.now });
  const caseEp = resolveCaseopenEndpoint();
  const clEnabled = isCourtListenerLiveEnabled();
  const clEp = resolveCourtListenerEndpoint();
  const probed = probeCache?.caseopenReachable === true;

  const sources: CaseLawSourceReadiness[] = [
    {
      id: "caseopen",
      label: "cncases / caseopen 裁判文书检索（本地自建）",
      ready: caseEnabled && caseEp.ok,
      automatic: probed && !isCaseopenLiveEnabled(),
      licenseNote:
        "软件 MPL-2.0（cncases/cases）；文书为法院公开裁判；需自建索引（体量大）；默认连本机",
      howToEnable: `自建索引后本机 ${DEFAULT_CASEOPEN_SEARCH} 可达即自动启用；也可 LAWMIND_OPEN_LAW_CASEOPEN=1 显式打开`,
      detail: caseEnabled
        ? caseEp.ok
          ? probed && !isCaseopenLiveEnabled()
            ? `已自动检测到本机索引：${caseEp.normalized}`
            : `端点就绪：${caseEp.normalized}`
          : `端点无效：${caseEp.message}`
        : "未检测到本机索引（自建后可自动启用）",
    },
    {
      id: "courtlistener",
      label: "CourtListener / Free Law Project（美国判例）",
      ready: clEnabled && clEp.ok,
      automatic: false,
      licenseNote:
        "官方 REST v4；AGPL 服务仅 HTTP 调用、不入库其源码；无 Token 时限流很严；含 Harvard CAP 历史判例",
      howToEnable:
        "LAWMIND_OPEN_LAW_COURTLISTENER=1；可选 LAWMIND_OPEN_LAW_COURTLISTENER_TOKEN（Authorization: Token）",
      detail: !clEnabled
        ? "未启用（美国判例，默认关）"
        : clEp.ok
          ? `端点就绪：${clEp.normalized}`
          : `端点无效：${clEp.message}`,
    },
  ];

  const readySources = sources.filter((s) => s.ready);
  const readyIds = readySources.map((s) => s.id);
  const ready = readySources.length > 0;

  return {
    ready,
    readyIds,
    sources,
    ...(ready
      ? {}
      : {
          setupHint:
            "本机未接类案库。要查真实类案：自建 cncases 索引（本机可达即自动启用），或 LAWMIND_OPEN_LAW_COURTLISTENER=1 直连美国判例。在此之前，检索只能给工作区线索，引擎不会编造案号或裁判要旨。",
        }),
    note: ready
      ? `类案源就绪：${readySources.map((s) => s.label).join(" · ")}`
      : "未接类案库（工作区线索可用，正式引用需先接权威来源）",
  };
}

/**
 * 探测本机 caseopen 索引是否可达。
 * 只探测**本机**默认端点或显式配置的本机端点；不主动捅公网。
 * 探测失败不抛错——类案不可用是可降级的正常状态。
 */
export async function probeCaseLawSources(opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: number;
}): Promise<CaseLawReadiness> {
  const ep = resolveCaseopenEndpoint();
  const isLocalEndpoint =
    ep.ok && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(ep.normalized);
  if (!isCaseopenLiveEnabled() && ep.ok && isLocalEndpoint) {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    let reachable = false;
    try {
      const url = new URL(ep.normalized);
      url.searchParams.set("search", "probe");
      const res = await fetchImpl(url.toString(), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 1500),
      });
      // 任何 HTTP 响应（哪怕 4xx）都说明索引进程在跑；HTML 挑战页不算。
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      reachable = !ct.includes("text/html");
    } catch {
      reachable = false;
    }
    probeCache = { caseopenReachable: reachable, probedAt: opts?.now ?? Date.now() };
  } else if (isCaseopenLiveEnabled()) {
    probeCache = { caseopenReachable: true, probedAt: opts?.now ?? Date.now() };
  } else {
    probeCache = { caseopenReachable: false, probedAt: opts?.now ?? Date.now() };
  }
  return resolveCaseLawReadiness({ now: opts?.now });
}

/** 类案不可用时给检索工具的降级说明（不阻断律师干活）。 */
export function caseLawDegradedNote(kind: "case" | "law"): string {
  const readiness = resolveCaseLawReadiness();
  if (readiness.ready || kind === "law") {
    return "";
  }
  return readiness.setupHint ?? "";
}
