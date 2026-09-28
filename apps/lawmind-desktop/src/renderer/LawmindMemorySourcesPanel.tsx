/**
 * 记忆档案体检面板 — 审核台 / 案件认知用。
 * 不挂在对话气泡下（对齐 Codex / Cursor：回答只留正文）。
 * 展示的是「这些档案在不在 / 设计上能否进主说明」，不是「本回答引用了哪些材料」。
 */

import { useId, useState } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/memory-source-types.ts";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

const LAWMIND_USER_MANUAL = lawmindDocUrl("archive/LAWMIND-USER-MANUAL");

type Props = {
  layers: MemorySourceLayer[];
  /** 默认折叠；审核台可传 true */
  defaultOpen?: boolean;
};

function summarize(layers: MemorySourceLayer[]) {
  const promptSlots = layers.filter((l) => l.inAgentSystemPrompt).length;
  const present = layers.filter((l) => l.exists).length;
  const missing = layers.filter((l) => !l.exists).length;
  const engineClient = layers.filter((l) => l.activeForEngine).length;
  return { promptSlots, present, missing, total: layers.length, engineClient };
}

function promptSlotLabel(layer: MemorySourceLayer): string {
  if (layer.inAgentSystemPrompt) {
    return layer.exists ? "可进主说明" : "未建（本可进主说明）";
  }
  return "仅检索/引擎";
}

export function LawmindMemorySourcesPanel(props: Props) {
  const { layers, defaultOpen = false } = props;
  const summary = summarize(layers);
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  if (layers.length === 0) {
    return null;
  }

  const hasMissingFile = summary.missing > 0;

  return (
    <section className="lm-context-panel lm-context-panel--workbench" aria-label="这些档案在不在">
      <button
        type="button"
        className="lm-context-panel-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        id={`${panelId}-trigger`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lm-context-panel-title">这些档案在不在</span>
        <span className="lm-context-panel-badges" aria-hidden>
          <span className="lm-badge-soft">{summary.total} 层</span>
          <span className="lm-badge-soft">{summary.present} 已存在</span>
          {summary.missing > 0 ? (
            <span className="lm-badge-soft lm-badge-soft--accent">{summary.missing} 未建</span>
          ) : null}
          {summary.engineClient > 0 ? (
            <span className="lm-badge-soft lm-badge-soft--engine">客户画像·本回合</span>
          ) : null}
        </span>
        <span
          className={`lm-context-panel-chevron ${open ? "lm-context-panel-chevron--open" : ""}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="lm-context-panel-body"
        role="region"
        aria-labelledby={`${panelId}-trigger`}
      >
        <p className="lm-context-missing-hint">
          这是工作区记忆档案清单，不是某条回答的引用列表。文件未建时不会进入本轮主说明。
        </p>
        <div className="lm-context-table-wrap lm-context-table-wrap--responsive">
          <table className="lm-context-table">
            <thead>
              <tr>
                <th scope="col">档案</th>
                <th scope="col">路径</th>
                <th scope="col">磁盘</th>
                <th scope="col">主说明</th>
                <th scope="col">本回合客户</th>
              </tr>
            </thead>
            <tbody>
              {layers.map((m) => (
                <tr
                  key={`${m.id}::${m.relativePath}`}
                  className={m.activeForEngine ? "lm-context-tr--engine" : undefined}
                >
                  <td data-label="档案">
                    <div className="lm-context-label-stack">
                      <span className="lm-context-cell-label">{m.label}</span>
                      {m.hint ? (
                        <span className="lm-context-cell-sublabel" title={m.hint}>
                          {m.hint}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="路径">
                    <code className="lm-context-path" title={m.relativePath}>
                      {m.relativePath}
                    </code>
                  </td>
                  <td data-label="磁盘">
                    <span className={m.exists ? "lm-pill lm-pill--ok" : "lm-pill lm-pill--muted"}>
                      {m.exists ? "已存在" : "未建"}
                    </span>
                  </td>
                  <td data-label="主说明">
                    <span
                      className={
                        m.inAgentSystemPrompt && m.exists
                          ? "lm-pill lm-pill--accent"
                          : "lm-pill lm-pill--muted"
                      }
                      title={
                        m.inAgentSystemPrompt
                          ? m.exists
                            ? "有正文时会进本助手主说明（指纹窗口，非整文件）"
                            : "设计上可进主说明，但文件未建或为空则本轮不会写入"
                          : "供检索或引擎使用，默认不整段写入主说明"
                      }
                    >
                      {promptSlotLabel(m)}
                    </span>
                  </td>
                  <td data-label="本回合客户">
                    <span
                      className={
                        m.activeForEngine ? "lm-pill lm-pill--engine" : "lm-pill lm-pill--muted"
                      }
                      title={
                        m.activeForEngine
                          ? "本回合客户画像：与引擎与检索使用的文件一致"
                          : undefined
                      }
                    >
                      {m.activeForEngine ? "生效" : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMissingFile ? (
          <p className="lm-context-missing-hint">
            有「未建」时：在工作区建好对应文件，并确认材料文件夹与案件选对。说明见{" "}
            <a className="lm-link-inline" href={LAWMIND_USER_MANUAL} target="_blank" rel="noreferrer">
              LawMind 用户手册
            </a>
            。
          </p>
        ) : null}
      </div>
    </section>
  );
}
