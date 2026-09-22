/**
 * In-app help: thin link-out to the product site (not an in-app doc catalog).
 */

import type { MouseEvent, ReactNode } from "react";
import {
  LAWMIND_DOCS_BASE,
  LAWMIND_DOWNLOAD_PAGE_URL,
  lawmindDocUrl,
} from "./lawmind-public-urls.js";

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

function HelpLink(props: { href: string; children: ReactNode; className?: string }): ReactNode {
  const { href, children, className } = props;
  return (
    <a
      href={href}
      className={className}
      rel="noreferrer noopener"
      onClick={(e) => openHelpLink(href, e)}
    >
      {children}
    </a>
  );
}

export function HelpPanel(props: Props): ReactNode {
  const { onClose } = props;
  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="帮助">
      <div className="lm-wizard lm-help-panel">
        <h2>帮助</h2>
        <p className="lm-meta">完整说明在产品站；工作台只保留办案动作。</p>
        <div className="lm-help-primary">
          <HelpLink href={LAWMIND_DOCS_BASE} className="lm-btn lm-btn-accent">
            打开产品站
          </HelpLink>
          <HelpLink href={lawmindDocUrl("LAWMIND-LAWYER-QUICKSTART")} className="lm-btn lm-btn-secondary">
            快速指南
          </HelpLink>
          <HelpLink href={LAWMIND_DOWNLOAD_PAGE_URL} className="lm-btn lm-btn-ghost">
            下载桌面版
          </HelpLink>
        </div>
        <details className="lm-help-compliance">
          <summary>合规与条款</summary>
          <ul className="lm-help-links lm-help-links-tight">
            <li>
              <HelpLink href={lawmindDocUrl("archive/LAWMIND-DATA-PROCESSING")}>数据处理说明</HelpLink>
            </li>
            <li>
              <HelpLink href={lawmindDocUrl("legal/terms-of-service")}>服务条款</HelpLink>
            </li>
            <li>
              <HelpLink href={lawmindDocUrl("archive/LAWMIND-PRIVATE-DEPLOY")}>私有化部署</HelpLink>
            </li>
          </ul>
        </details>
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
