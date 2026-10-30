/**
 * 收案卡的「委托包（草案）」区块：生成五份 Markdown 草案，导出 DOCX。
 *
 * 从 `MatterAdmissionCard` 拆出来：委托包有自己的加载、覆盖确认和导出状态，
 * 和冲突扫描/告知/期限不是一条流程。Markdown 仍是真相源；DOCX 从当前
 * Markdown 重新渲染。
 */

import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson } from "../api-client";
import { admissionErrorMessage, errorCode } from "./matter-admission-error";

type EngagementFile = { name: string; relativePath: string; bytes: number };

export type EngagementManifest = {
  generatedAt: string;
  files: EngagementFile[];
  esign: { status: string };
  docx?: { generatedAt: string; files: EngagementFile[] };
};

/** 读不到（还没生成）返回 null；不把 404 当错误弹给律师。 */
export async function fetchEngagementManifest(
  apiBase: string,
  matterId: string,
): Promise<EngagementManifest | null> {
  try {
    const j = await apiGetJson<{ ok: boolean; manifest?: EngagementManifest }>(
      apiBase,
      `/api/intake/admissions/${encodeURIComponent(matterId)}/engagement`,
    );
    return j.manifest ?? null;
  } catch {
    return null;
  }
}

type Props = {
  apiBase: string;
  matterId: string;
  /** 收案候选里的委托人，用来预填「委托人」。 */
  clientHint?: string;
  /** 已指定的负责人，生成时作为承办律师。 */
  lawyerId?: string;
  /** 收案卡其他动作进行中时禁用整个区块。 */
  disabled?: boolean;
};

export function MatterEngagementPanel(props: Props): ReactNode {
  const { apiBase, matterId, clientHint, lawyerId, disabled = false } = props;
  const [engagement, setEngagement] = useState<EngagementManifest | null>(null);
  const [client, setClient] = useState(clientHint ?? "");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [docxErr, setDocxErr] = useState<string | null>(null);
  const [docxOverwriteOpen, setDocxOverwriteOpen] = useState(false);

  const path = `/api/intake/admissions/${encodeURIComponent(matterId)}/engagement`;

  useEffect(() => {
    let cancelled = false;
    void fetchEngagementManifest(apiBase, matterId).then((manifest) => {
      if (!cancelled) {
        setEngagement(manifest);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase, matterId]);

  // 委托人来自异步加载的收案记录：先到先填，律师清空后不再覆盖。
  useEffect(() => {
    if (!client && clientHint) {
      setClient(clientHint);
    }
  }, [client, clientHint]);

  const generate = async (overwrite: boolean) => {
    if (!client.trim() || !fee.trim()) {
      setErr("先填委托人和律师费。");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    setOverwriteOpen(false);
    try {
      const j = await apiSendJson<{ ok: boolean; manifest?: EngagementManifest }>(
        apiBase,
        path,
        "POST",
        {
          clientName: client.trim(),
          feeText: fee.trim(),
          ...(lawyerId ? { lawyerName: lawyerId } : {}),
          ...(overwrite ? { overwrite: true } : {}),
        },
      );
      if (j.manifest) {
        setEngagement(j.manifest);
      }
      setMsg("委托包草案已生成，请律师核对后再对外。");
    } catch (e) {
      if (errorCode(e) === "exists") {
        setOverwriteOpen(true);
      }
      setErr(admissionErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const exportDocx = async (overwrite: boolean) => {
    setDocxBusy(true);
    setDocxErr(null);
    setMsg(null);
    setDocxOverwriteOpen(false);
    try {
      const j = await apiSendJson<{
        ok: boolean;
        generatedAt?: string;
        files?: EngagementFile[];
      }>(apiBase, `${path}/docx`, "POST", overwrite ? { overwrite: true } : {});
      const generatedAt = j.generatedAt;
      const files = j.files;
      if (generatedAt && files) {
        setEngagement((prev) => (prev ? { ...prev, docx: { generatedAt, files } } : prev));
      }
      setMsg(`委托包 DOCX 已导出（${files?.length ?? 0} 份）。Markdown 仍是真相源。`);
    } catch (e) {
      if (errorCode(e) === "exists") {
        setDocxOverwriteOpen(true);
      }
      setDocxErr(admissionErrorMessage(e));
    } finally {
      setDocxBusy(false);
    }
  };

  return (
    <fieldset
      className="lm-matter-profile-checks"
      disabled={disabled || busy || docxBusy}
      data-testid="lm-matter-engagement"
    >
      <legend>委托包（草案）</legend>
      {engagement ? (
        <div className="lm-matter-engagement-summary">
          <p className="lm-meta">
            已生成 {engagement.files.length} 份草案 ·{" "}
            {new Date(engagement.generatedAt).toLocaleString()} · 电子签：占位（未接入）
          </p>
          <ul className="lm-matter-admission-list">
            {engagement.files.map((file) => (
              <li key={file.relativePath}>
                <span>{file.name}</span>
                <span className="lm-meta">{file.relativePath}</span>
              </li>
            ))}
          </ul>
          {engagement.docx ? (
            <p className="lm-meta">
              已导出 Word {engagement.docx.files.length} 份 ·{" "}
              {new Date(engagement.docx.generatedAt).toLocaleString()} · 从当前 Markdown 生成
            </p>
          ) : null}
        </div>
      ) : (
        <p className="lm-meta">
          接受委托前可先生成委托合同、授权委托书、风险告知、AI 使用告知和报价单草案；全部标注「须律师核对」。
        </p>
      )}
      <div className="lm-matter-engagement-form">
        <label className="lm-field">
          <span>委托人</span>
          <input
            type="text"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="委托人姓名或公司名"
            disabled={disabled || busy}
            autoComplete="off"
          />
        </label>
        <label className="lm-field">
          <span>律师费</span>
          <input
            type="text"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="例如 按标的额 5% 收取"
            disabled={disabled || busy}
            autoComplete="off"
          />
        </label>
      </div>
      <div className="lm-matter-admission-actions">
        <button
          type="button"
          className="lm-btn lm-btn-sm"
          disabled={disabled || busy || docxBusy}
          onClick={() => void generate(false)}
        >
          {engagement ? "重新生成" : "生成委托包"}
        </button>
        {overwriteOpen ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={disabled || busy || docxBusy}
            onClick={() => void generate(true)}
          >
            覆盖并重新生成
          </button>
        ) : null}
        {engagement ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={disabled || busy || docxBusy}
            onClick={() => void exportDocx(false)}
          >
            {engagement.docx ? "重新导出 DOCX" : "导出 DOCX"}
          </button>
        ) : null}
        {docxOverwriteOpen ? (
          <button
            type="button"
            className="lm-btn lm-btn-sm"
            disabled={disabled || busy || docxBusy}
            onClick={() => void exportDocx(true)}
          >
            覆盖并重新导出
          </button>
        ) : null}
      </div>
      {err ? (
        <p className="lm-error" role="alert">
          {err}
        </p>
      ) : null}
      {docxErr ? (
        <p className="lm-error" role="alert">
          {docxErr}
        </p>
      ) : null}
      {msg ? (
        <p className="lm-meta" role="status">
          {msg}
        </p>
      ) : null}
    </fieldset>
  );
}
