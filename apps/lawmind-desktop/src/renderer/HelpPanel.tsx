/**
 * In-app help: links to official docs (read-only).
 * 分层导航：先读手册与交付心智，其余按需展开。
 */

import type { MouseEvent, ReactNode } from "react";
import {
  LAWMIND_DOWNLOAD_PAGE_URL,
  lawmindDocUrl,
  lawmindGithubBlobUrl,
} from "./lawmind-public-urls.js";

const DOCS_START_HERE = [
  {
    label: "完整使用手册（含目录 · 桌面版优先）",
    href: lawmindDocUrl("LAWMIND-USER-MANUAL"),
  },
  {
    label: "交付物、验收门禁与首跑流程",
    href: lawmindDocUrl("LAWMIND-DELIVERABLE-FIRST"),
  },
  { label: "材料与记忆放哪里", href: lawmindDocUrl("LAWMIND-PROJECT-MEMORY") },
  {
    label: "桌面下载（自动识别系统）",
    href: LAWMIND_DOWNLOAD_PAGE_URL,
  },
] as const;

const DOCS_PRODUCT = [
  {
    label: "LawMind 文档站说明（VitePress · 侧栏导航）",
    href: lawmindGithubBlobUrl("apps/lawmind-docs/README.md"),
  },
  {
    label: "界面布局与无障碍（桌面 UI 约定）",
    href: lawmindDocUrl("LAWMIND-DESKTOP-UI"),
  },
  {
    label: "文件页、对话引用与材料上限",
    href: lawmindDocUrl("LAWMIND-DESKTOP-FILES-AND-CONTEXT"),
  },
  { label: "客户交付与验收清单", href: lawmindDocUrl("LAWMIND-DELIVERY") },
  {
    label: "桌面安装与系统要求（INSTALL）",
    href: lawmindGithubBlobUrl("apps/lawmind-desktop/INSTALL.md"),
  },
] as const;

const DOCS_TRUST = [
  { label: "数据处理说明", href: lawmindDocUrl("LAWMIND-DATA-PROCESSING") },
  { label: "操作者与归因", href: lawmindDocUrl("LAWMIND-ACTOR-ATTRIBUTION") },
  { label: "集成能力与产品边界", href: lawmindDocUrl("LAWMIND-INTEGRATIONS") },
  { label: "私有化部署", href: lawmindDocUrl("LAWMIND-PRIVATE-DEPLOY") },
  {
    label: "运维与支持排障（Runbook）",
    href: lawmindDocUrl("LAWMIND-SUPPORT-RUNBOOK"),
  },
  { label: "服务条款（草案）", href: lawmindDocUrl("legal/terms-of-service") },
] as const;

type Props = {
  onClose: () => void;
};

function openHelpLink(href: string, e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const api = window.lawmindDesktop?.openExternal;
  if (api) {
    void api(href);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

function linkList(items: readonly { label: string; href: string }[], tight: boolean): ReactNode {
  return (
    <ul className={`lm-help-links${tight ? " lm-help-links-tight" : ""}`}>
      {items.map((d) => (
        <li key={d.href}>
          <a href={d.href} rel="noreferrer noopener" onClick={(e) => openHelpLink(d.href, e)}>
            {d.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function HelpPanel(props: Props): ReactNode {
  const { onClose } = props;
  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="帮助">
      <div className="lm-wizard lm-help-panel">
        <h2>帮助</h2>
        <p className="lm-meta">
          LawMind 是<strong>本机律师工作台</strong>：多助手分工、材料留在您电脑上。对外文书请在<strong>审核</strong>中把关并通过验收门禁后再交付。下方文档与在线《使用手册》一致；需 **PDF / 离线** 时打开手册第 16 节按步骤导出。
        </p>
        <h3 className="lm-help-subhead">从这里开始</h3>
        {linkList(DOCS_START_HERE, false)}
        <h3 className="lm-help-subhead">界面、文件与客户交付</h3>
        {linkList(DOCS_PRODUCT, true)}
        <h3 className="lm-help-subhead">合规、集成与支持</h3>
        {linkList(DOCS_TRUST, true)}
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
