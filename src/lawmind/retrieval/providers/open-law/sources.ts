/**
 * Open-law source catalog + readiness (Doctor / health).
 * Honest inventory — does not claim commercial 法宝/Lexis coverage.
 */

import { isCaseopenLiveEnabled, resolveCaseopenEndpoint } from "./caseopen.js";
import { openLawCorpusStats } from "./local-corpus.js";
import { isNpcFlkLiveEnabled, resolveNpcFlkEndpoint } from "./npc-flk.js";
import type { OpenLawSourceId } from "./types.js";

export type OpenLawSourceStatus = {
  id: OpenLawSourceId;
  label: string;
  /** configured / ready for use (sync; live APIs = flag+valid URL, not probed) */
  ready: boolean;
  access: "embedded" | "local_file" | "live_http" | "self_hosted_http";
  licenseNote: string;
  howToEnable: string;
  detail?: string;
};

export function listOpenLawSourceStatuses(opts?: { corpusPath?: string }): OpenLawSourceStatus[] {
  const stats = openLawCorpusStats(opts);
  const npcEnabled = isNpcFlkLiveEnabled();
  const npcEp = resolveNpcFlkEndpoint();
  const caseEnabled = isCaseopenLiveEnabled();
  const caseEp = resolveCaseopenEndpoint();

  return [
    {
      id: "local_sample",
      label: "内置演示 sample",
      ready: stats.bundledSample && stats.recordCount > 0,
      access: "embedded",
      licenseNote: "公开法律文本演示摘录；非正式完整法库；正式引用须核对官方法条",
      howToEnable: "默认启用（LAWMIND_AUTHORITY_PROVIDER=open）",
      detail: stats.bundledSample ? `sample 条数含于合计 ${stats.recordCount}` : "sample 未加载",
    },
    {
      id: "local_corpus",
      label: "外部 CORPUS（JSONL/JSON）",
      ready: stats.externalCorpus,
      access: "local_file",
      licenseNote: "由用户自行准备与确认许可；LawMind 仅本地读取",
      howToEnable: "LAWMIND_OPEN_LAW_CORPUS=/abs/path/laws.jsonl",
      detail: stats.corpusPath
        ? stats.externalCorpus
          ? `已加载：${stats.corpusPath}`
          : `路径无效或不可读：${stats.corpusPath}`
        : "未设置",
    },
    {
      id: "npc_flk",
      label: "国家法律法规数据库（NPC FLK）",
      ready: npcEnabled && npcEp.ok,
      access: "live_http",
      licenseNote: "官方政府公开信息；接口可能变动；尊重限流，勿批量镜像再分发",
      howToEnable: "LAWMIND_OPEN_LAW_NPC=1（可选 MODE=npc_flk|hybrid）",
      detail: !npcEnabled
        ? "未启用"
        : npcEp.ok
          ? `端点就绪：${npcEp.normalized}`
          : `端点无效：${npcEp.message}`,
    },
    {
      id: "caseopen",
      label: "cncases / caseopen 裁判文书检索",
      ready: caseEnabled && caseEp.ok,
      access: "self_hosted_http",
      licenseNote:
        "软件 MPL-2.0（cncases/cases）；文书为法院公开裁判；需自建索引（体量大）；公网 demo 有 Cloudflare，默认连本机",
      howToEnable:
        "LAWMIND_OPEN_LAW_CASEOPEN=1；可选 LAWMIND_OPEN_LAW_CASEOPEN_ENDPOINT=http://127.0.0.1:8081/api/search",
      detail: !caseEnabled
        ? "未启用"
        : caseEp.ok
          ? `端点就绪：${caseEp.normalized}`
          : `端点无效：${caseEp.message}`,
    },
  ];
}

export function summarizeOpenLawSources(opts?: { corpusPath?: string }): {
  sources: OpenLawSourceStatus[];
  readyIds: OpenLawSourceId[];
  message: string;
} {
  const sources = listOpenLawSourceStatuses(opts);
  const readyIds = sources.filter((s) => s.ready).map((s) => s.id);
  const labels = sources.filter((s) => s.ready).map((s) => s.label);
  return {
    sources,
    readyIds,
    message:
      labels.length > 0
        ? `开源权威来源就绪：${labels.join(" · ")}`
        : "开源权威来源均未就绪：请检查内置 sample 或配置 CORPUS / NPC / caseopen。",
  };
}
