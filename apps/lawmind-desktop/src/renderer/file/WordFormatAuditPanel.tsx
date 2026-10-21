/**
 * 中栏「格式体检」面板。只出清单，不改文件。
 *
 * 三种口径写在按钮上，不藏在设置里：
 * - 跟随原文（默认）：当事人/客户/对方来的文件，LawMind 新写的字跟原文一致，不套模板；
 * - 从零起草：公文，按 GB/T 9704 草案（带「待律师确认」提示）；
 * - 整体套模板：只有律师明确要求时才用。
 *
 * 报告里的「没检查」原样展示——不把没查的当合格。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  FormatAuditMode,
  FormatAuditReport,
} from "../../../../../src/lawmind/drafts/document-format-audit.ts";
import { apiSendJson, errorMessage } from "../api-client";

type Props = {
  apiBase: string;
  root: "workspace" | "project";
  relPath: string;
  projectDir?: string | null;
  onClose: () => void;
  onJumpToParagraph?: (paragraphIndex: number) => void;
};

type AuditResponse = {
  ok?: boolean;
  text?: string;
  report?: FormatAuditReport;
  error?: string;
  detail?: string;
};

type FixResponse = {
  ok?: boolean;
  outputPath?: string;
  appliedParagraphs?: number;
  revisions?: { verified: boolean; beforeCount: number; afterCount: number };
  warning?: string;
  detail?: string;
};

const MODES: Array<{ value: FormatAuditMode; label: string; hint: string }> = [
  {
    value: "imported",
    label: "跟随原文",
    hint: "当事人或对方给的文件，按它自己的格式来。",
  },
  {
    value: "from-scratch",
    label: "从零起草",
    hint: "我们从头写的公文，按国标草案。",
  },
  {
    value: "retemplate",
    label: "整体套模板",
    hint: "只有你明确要求时才用。",
  },
];

/** 能自动修的只有 A 层这四项；其余只出清单。 */
const FIXABLE_CODES = new Set([
  "body.font",
  "body.size",
  "body.line",
  "body.indent",
  "imported.font",
  "imported.size",
  "imported.indent",
]);

function severityMark(severity: string): string {
  if (severity === "error") {
    return "✗";
  }
  return severity === "warning" ? "⚠" : "·";
}

export function WordFormatAuditPanel({
  apiBase,
  root,
  relPath,
  projectDir,
  onClose,
  onJumpToParagraph,
}: Props): ReactNode {
  const [mode, setMode] = useState<FormatAuditMode>("imported");
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixNote, setFixNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [report, setReport] = useState<FormatAuditReport | null>(null);
  const requested = useRef(0);

  const run = useCallback(
    async (next: FormatAuditMode) => {
      if (!apiBase || !relPath) {
        return;
      }
      const ticket = requested.current + 1;
      requested.current = ticket;
      setBusy(true);
      setNote(null);
      try {
        const body = await apiSendJson<AuditResponse>(
          apiBase,
          "/api/documents/format-audit",
          "POST",
          {
            root,
            path: relPath,
            mode: next,
            ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
          },
        );
        if (requested.current !== ticket) {
          return;
        }
        if (body.report) {
          setReport(body.report);
        } else {
          setReport(null);
          setNote(body.detail ?? "体检没跑起来，稍后再试。");
        }
      } catch (error) {
        if (requested.current === ticket) {
          setReport(null);
          setNote(errorMessage(error, "体检没跑起来，稍后再试。"));
        }
      } finally {
        if (requested.current === ticket) {
          setBusy(false);
        }
      }
    },
    [apiBase, projectDir, relPath, root],
  );

  useEffect(() => {
    void run("imported");
    return () => {
      requested.current += 1;
    };
  }, [run]);

  const pickMode = (next: FormatAuditMode) => {
    setMode(next);
    setFixNote(null);
    void run(next);
  };

  /** 只修 A 层；写副本，不改打开的文件。 */
  const applyFix = useCallback(async () => {
    if (!apiBase || !relPath || !report) {
      return;
    }
    const paragraphs =
      report.mode === "imported"
        ? [...new Set(
            report.findings
              .filter((finding) => finding.code.startsWith("imported."))
              .map((finding) => finding.paragraphIndex)
              .filter((index): index is number => typeof index === "number"),
          )]
        : undefined;
    if (report.mode === "imported" && (paragraphs?.length ?? 0) === 0) {
      setFixNote("没有点名 LawMind 改过的段落，不做整篇套模板。整篇调整请另行说明。");
      return;
    }
    setFixing(true);
    setFixNote(null);
    try {
      const body = await apiSendJson<FixResponse>(apiBase, "/api/documents/format-fix", "POST", {
        root,
        path: relPath,
        mode: report.mode,
        ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
        ...(paragraphs ? { lawmindParagraphs: paragraphs } : {}),
      });
      if (body.ok && body.outputPath) {
        setFixNote(
          `已写副本 ${body.outputPath}（改 ${body.appliedParagraphs ?? 0} 段）。` +
            (body.revisions?.verified
              ? `原有的修改痕迹 ${body.revisions.beforeCount} 条仍在。`
              : "原有的修改痕迹无法核验，请打开副本核对。") +
            (body.warning ? ` ${body.warning}` : ""),
        );
      } else {
        setFixNote(body.detail ?? "格式改动没写成，原文件没动。");
      }
    } catch (error) {
      setFixNote(errorMessage(error, "格式改动没写成，原文件没动。"));
    } finally {
      setFixing(false);
    }
  }, [apiBase, projectDir, relPath, report, root]);

  const banner = report?.standard.noticeZh ?? "";
  const provisional = report?.standard.provisional === true;
  // 只有真的存在 A 层可改项时才给按钮：warning（缩进）也算。
  const fixable = report != null && report.findings.some((finding) => FIXABLE_CODES.has(finding.code));
  const profileText =
    report?.mode === "imported" && report.profile.sampleCount > 0
      ? `原文主流格式：${report.profile.labelZh}（一致 ${Math.round(report.profile.share * 100)}%）`
      : null;

  return (
    <section className="lm-word-format-audit" data-testid="lm-word-format-audit">
      <div className="lm-word-format-audit-head">
        <div className="lm-word-format-audit-modes" role="group" aria-label="体检口径">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              aria-pressed={mode === item.value}
              title={item.hint}
              data-testid={`lm-format-mode-${item.value}`}
              disabled={busy}
              onClick={() => pickMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="lm-word-format-audit-actions">
          {fixable ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-format-fix"
              disabled={fixing || busy}
              title="只统一字体/字号/行距/缩进，写成 Word 的格式改动，落一份副本"
              onClick={() => void applyFix()}
            >
              {fixing ? "写入中…" : "按原文统一格式（副本）"}
            </button>
          ) : null}
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={() => void run(mode)}
          >
            {busy ? "体检中…" : "重新体检"}
          </button>
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>

      {banner ? (
        <p
          className="lm-word-format-audit-banner"
          role="note"
          data-provisional={provisional ? "true" : undefined}
        >
          {banner}
        </p>
      ) : null}

      {note ? (
        <p className="lm-word-surface-error" role="alert">
          {note}
        </p>
      ) : null}

      {fixNote ? (
        <p className="lm-word-format-audit-fixnote" role="status">
          {fixNote}
        </p>
      ) : null}

      {report && !note ? (
        <>
          <p className="lm-word-format-audit-summary" role="status">
            {report.summaryZh}
            {profileText ? `　${profileText}` : ""}
          </p>
          {report.findings.length > 0 ? (
            <ul className="lm-word-format-audit-list lm-scroll">
              {report.findings.map((finding, index) => {
                const detail =
                  finding.actual || finding.expected
                    ? `（现：${finding.actual ?? "—"}；应：${finding.expected ?? "—"}）`
                    : "";
                const jumpable =
                  finding.paragraphIndex != null && onJumpToParagraph != null;
                const label = `${finding.messageZh}${detail}`;
                return (
                  <li
                    key={`${finding.code}-${String(finding.paragraphIndex ?? index)}-${index}`}
                    data-severity={finding.severity}
                  >
                    <span className="lm-word-format-audit-mark">{severityMark(finding.severity)}</span>
                    {jumpable ? (
                      <button
                        type="button"
                        className="lm-word-format-audit-jump"
                        title="跳到这一段"
                        onClick={() => onJumpToParagraph(finding.paragraphIndex as number)}
                      >
                        第 {(finding.paragraphIndex as number) + 1} 段 {label}
                      </button>
                    ) : (
                      <span>
                        {finding.paragraphIndex != null ? `第 ${finding.paragraphIndex + 1} 段 ` : ""}
                        {label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="lm-word-format-audit-empty">已检查的项目没发现问题。</p>
          )}
          {report.omittedFindings > 0 ? (
            <p className="lm-word-format-audit-more">
              另有 {report.omittedFindings} 条同类问题未展开。
            </p>
          ) : null}
          {report.unchecked.length > 0 ? (
            <div className="lm-word-format-audit-unchecked">
              <span>没检查（不算通过）：</span>
              <ul>
                {report.unchecked.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
