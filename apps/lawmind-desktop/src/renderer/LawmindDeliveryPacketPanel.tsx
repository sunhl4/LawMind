/**
 * 案件交付包面板：分节清单、受众预览、整包指纹与 ZIP 导出。
 *
 * 数据来自 `GET/POST /api/matters/:id/delivery-packets`；清单由服务端每次重新求值，
 * 勾选会改写包定义（受众成员关系）并立刻重算 `packetHash`——批准绑定的是这一版整包。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  apiGetJson,
  apiSendJson,
  errorMessage,
  fetchApi,
} from "./api-client";
import {
  PACKET_AUDIENCES,
  type DeliveryPacket,
  type PacketAudience,
  type PacketDocumentExclusionReason,
  type PacketManifest,
} from "../../../../src/lawmind/delivery/packet-model.ts";

type ManifestView = Pick<
  PacketManifest,
  "audience" | "packetHash" | "blockers" | "warnings" | "files" | "sections"
> & { readiness: "ready" | "blocked" };

type PacketView = {
  packet: DeliveryPacket;
  manifest: ManifestView;
};

type ListResponse = {
  ok: boolean;
  packets?: PacketView[];
  error?: string;
};

const AUDIENCE_LABEL: Record<PacketAudience, string> = {
  client: "客户包",
  court: "法院包",
  opposing: "对方包",
  internal: "内部包",
};

const EXCLUSION_LABEL: Record<PacketDocumentExclusionReason, string> = {
  audience: "不在本受众版本",
  condition: "条件未满足",
  missing: "文件缺失",
  duplicate: "重复文件",
  unsafe_path: "路径不安全",
  cross_matter: "跨案件文件",
};

function basename(rel: string): string {
  const parts = rel.split("/");
  return parts[parts.length - 1] || rel;
}

function shortHash(hash: string): string {
  return hash.slice(0, 10);
}

/** 勾选/取消勾选只改「当前受众是否进包」，保留该文件在其它受众版本里的设置。 */
function audiencesAfterToggle(
  current: PacketAudience,
  existing: PacketAudience[] | undefined,
  include: boolean,
): PacketAudience[] | undefined {
  const effective = existing && existing.length > 0 ? existing : [...PACKET_AUDIENCES];
  if (include) {
    const next = Array.from(new Set([...effective, current]));
    return next.length === PACKET_AUDIENCES.length ? undefined : next;
  }
  const next = PACKET_AUDIENCES.filter(
    (audience) => audience !== current && effective.includes(audience),
  );
  return next.length > 0 ? next : PACKET_AUDIENCES.filter((audience) => audience !== current);
}

function toggleDocument(
  packet: DeliveryPacket,
  sectionId: string,
  docId: string,
  current: PacketAudience,
  include: boolean,
): DeliveryPacket {
  return {
    ...packet,
    updatedAt: new Date().toISOString(),
    sections: packet.sections.map((section) => {
      if (section.sectionId !== sectionId) {
        return section;
      }
      return {
        ...section,
        documents: section.documents.map((doc) => {
          if (doc.docId !== docId) {
            return doc;
          }
          const audiences = audiencesAfterToggle(current, doc.audiences, include);
          const { audiences: _drop, ...rest } = doc;
          return audiences ? { ...rest, audiences } : rest;
        }),
      };
    }),
  };
}

export function LawmindDeliveryPacketPanel({
  apiBase,
  matterId,
}: {
  apiBase: string;
  matterId: string;
}): ReactNode {
  const [audience, setAudience] = useState<PacketAudience>("client");
  const [views, setViews] = useState<PacketView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const basePath = useMemo(
    () => `/api/matters/${encodeURIComponent(matterId)}/delivery-packets`,
    [matterId],
  );

  const refresh = useCallback(
    async (nextAudience: PacketAudience = audience) => {
      if (!matterId) {
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await apiGetJson<ListResponse>(
          apiBase,
          `${basePath}?audience=${encodeURIComponent(nextAudience)}`,
        );
        setViews(data.packets ?? []);
      } catch (e) {
        setError(errorMessage(e, "读取交付包失败"));
      } finally {
        setLoading(false);
      }
    },
    [apiBase, audience, basePath, matterId],
  );

  useEffect(() => {
    void refresh(audience);
  }, [audience, refresh]);

  const seed = async (): Promise<void> => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await apiSendJson(apiBase, basePath, "POST", { action: "seed", audience });
      setNote("已从案件成果物生成交付包草稿。");
      await refresh(audience);
    } catch (e) {
      setError(errorMessage(e, "生成交付包失败"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (
    view: PacketView,
    sectionId: string,
    docId: string,
    include: boolean,
  ): Promise<void> => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const next = toggleDocument(view.packet, sectionId, docId, audience, include);
      await apiSendJson(apiBase, basePath, "POST", { action: "save", packet: next });
      await refresh(audience);
    } catch (e) {
      setError(errorMessage(e, "保存交付包失败"));
    } finally {
      setBusy(false);
    }
  };

  const exportPacket = async (
    view: PacketView,
    format: "zip" | "merged_pdf",
  ): Promise<void> => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetchApi(
        `${apiBase}${basePath}/${encodeURIComponent(view.packet.packetId)}/export?format=${format}&audience=${encodeURIComponent(audience)}`,
        {},
        { tag: format === "zip" ? "deliveryPacketZip" : "deliveryPacketPdf" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
          blockers?: string[];
        } | null;
        const detail = body?.blockers?.length
          ? `${body.message ?? body.error ?? "交付包被拒绝"}：${body.blockers.join("；")}`
          : (body?.message ?? body?.error ?? `导出失败（HTTP ${response.status}）`);
        throw new Error(detail);
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const fallback = format === "zip" ? "交付包.zip" : "交付包.pdf";
      const fileName = encoded ? decodeURIComponent(encoded) : fallback;
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(href);
      setNote(`已导出 ${fileName}`);
    } catch (e) {
      setError(errorMessage(e, "导出交付包失败"));
    } finally {
      setBusy(false);
    }
  };

  const toggleBates = async (view: PacketView, enabled: boolean): Promise<void> => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const base = view.packet.output ?? {};
      const bates = enabled
        ? {
            prefix: base.bates?.prefix ?? "LM",
            start: base.bates?.start ?? 1,
            pad: base.bates?.pad ?? 6,
          }
        : undefined;
      const next = {
        ...view.packet,
        updatedAt: new Date().toISOString(),
        output: { ...base, format: "merged_pdf" as const, ...(bates ? { bates } : {}) },
      };
      await apiSendJson(apiBase, basePath, "POST", { action: "save", packet: next });
      await refresh(audience);
    } catch (e) {
      setError(errorMessage(e, "保存 Bates 设置失败"));
    } finally {
      setBusy(false);
    }
  };

  const view = views[0];
  const manifestFiles = view?.manifest.files ?? [];
  const allPdf = manifestFiles.length > 0 && manifestFiles.every((file) => /\.pdf$/i.test(file.path));
  const batesEnabled = Boolean(view?.packet.output?.bates);

  return (
    <section className="lm-lawyer-pane lm-delivery-packet-panel" aria-label="交付包">
      <div className="lm-delivery-packet-head">
        <h3>交付包</h3>
        <label className="lm-delivery-packet-audience">
          <span className="lm-meta">受众</span>
          <select
            className="lm-input"
            aria-label="交付受众"
            value={audience}
            disabled={busy}
            onChange={(event) => {
              setAudience(event.target.value as PacketAudience);
            }}
          >
            {PACKET_AUDIENCES.map((value) => (
              <option key={value} value={value}>
                {AUDIENCE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="lm-meta">
        签批的是整个包：文件、顺序、封面或受众任一变化，都需要重新核对后再签批。
      </p>

      {error ? <p className="lm-error">{error}</p> : null}
      {note ? <p className="lm-meta">{note}</p> : null}

      {loading && !view ? <p className="lm-meta">正在核对交付包…</p> : null}

      {!loading && !view ? (
        <div className="lm-delivery-packet-empty">
          <p className="lm-meta">这个案件还没有交付包。</p>
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={busy}
            onClick={() => void seed()}
          >
            从成果物生成{audienceSuffix(audience)}
          </button>
        </div>
      ) : null}

      {view ? (
        <>
          <div className="lm-delivery-packet-meta">
            <span
              className={view.manifest.readiness === "ready" ? "lm-badge lm-badge-done" : "lm-badge lm-badge-error"}
            >
              {view.manifest.readiness === "ready" ? "可交付" : "不可交付"}
            </span>
            <span className="lm-meta">
              {view.packet.title} · {view.manifest.files.length} 份 · 指纹{" "}
              {shortHash(view.manifest.packetHash)}
            </span>
            <span className="lm-meta">
              包 ID <code>{view.packet.packetId}</code>
            </span>
          </div>

          {view.manifest.blockers.length > 0 ? (
            <ul className="lm-delivery-packet-issues is-blocker">
              {view.manifest.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {view.manifest.warnings.length > 0 ? (
            <ul className="lm-delivery-packet-issues is-warning">
              {view.manifest.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}

          <div className="lm-delivery-packet-sections">
            {view.manifest.sections.map((section) => (
              <div className="lm-delivery-packet-section" key={section.sectionId}>
                <p className="lm-delivery-packet-section-title">{section.title}</p>
                {section.documents.length === 0 ? (
                  <p className="lm-meta">这一节还没有文件。</p>
                ) : (
                  section.documents.map((doc) => {
                    const locked =
                      doc.excludedReason === "condition" ||
                      doc.excludedReason === "missing" ||
                      doc.excludedReason === "unsafe_path" ||
                      doc.excludedReason === "cross_matter" ||
                      doc.excludedReason === "duplicate";
                    return (
                      <label className="lm-delivery-packet-row" key={doc.docId}>
                        <input
                          type="checkbox"
                          checked={doc.included}
                          disabled={busy || locked}
                          aria-label={`${doc.included ? "移出" : "加入"}${doc.title ?? basename(doc.path)}`}
                          onChange={(event) =>
                            void toggle(view, section.sectionId, doc.docId, event.target.checked)
                          }
                        />
                        <span className="lm-delivery-packet-copy">
                          <span className="lm-desk-card-title">
                            {doc.title ?? basename(doc.path)}
                            {doc.required ? <span className="lm-meta"> · 必需</span> : null}
                          </span>
                          <span className="lm-meta">
                            {doc.path}
                            {doc.excludedReason
                              ? ` · ${EXCLUSION_LABEL[doc.excludedReason]}`
                              : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            ))}
          </div>

          <div className="lm-delivery-packet-actions">
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy || view.manifest.readiness !== "ready"}
              onClick={() => void exportPacket(view, "zip")}
            >
              导出 ZIP
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              disabled={busy || view.manifest.readiness !== "ready" || !allPdf}
              title={allPdf ? "按包内顺序合并为一份 PDF" : "包内含有非 PDF 文件，请改用 ZIP"}
              onClick={() => void exportPacket(view, "merged_pdf")}
            >
              导出合并 PDF
            </button>
            <label className="lm-delivery-packet-audience">
              <input
                type="checkbox"
                checked={batesEnabled}
                disabled={busy}
                onChange={(event) => void toggleBates(view, event.target.checked)}
              />
              <span className="lm-meta">Bates 页码</span>
            </label>
          </div>
          <p className="lm-meta">
            全为 PDF 的包可按顺序合并；Bates 页码会从 LM000001 起连续编号。混合格式请导出
            ZIP。
          </p>
        </>
      ) : null}
    </section>
  );
}

function audienceSuffix(audience: PacketAudience): string {
  return audience === "client" ? "客户包" : AUDIENCE_LABEL[audience];
}
