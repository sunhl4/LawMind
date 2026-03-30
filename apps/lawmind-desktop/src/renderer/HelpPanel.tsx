/**
 * In-app help: links to official docs (read-only).
 */

import type { ReactNode } from "react";

const DOCS = [
  { label: "操作者归因", href: "https://docs.openclaw.ai/LAWMIND-ACTOR-ATTRIBUTION" },
  { label: "数据处理说明", href: "https://docs.openclaw.ai/LAWMIND-DATA-PROCESSING" },
  { label: "客户交付与验收", href: "https://docs.openclaw.ai/LAWMIND-DELIVERY" },
  { label: "集成边界", href: "https://docs.openclaw.ai/LAWMIND-INTEGRATIONS" },
  { label: "私有化部署", href: "https://docs.openclaw.ai/LAWMIND-PRIVATE-DEPLOY" },
  { label: "项目与记忆", href: "https://docs.openclaw.ai/LAWMIND-PROJECT-MEMORY" },
  { label: "LawMind 使用手册", href: "https://docs.openclaw.ai/LAWMIND-USER-MANUAL" },
  { label: "条款（草案）", href: "https://docs.openclaw.ai/legal/terms-of-service" },
] as const;

type Props = {
  onClose: () => void;
};

export function HelpPanel(props: Props): ReactNode {
  const { onClose } = props;
  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="帮助">
      <div className="lm-wizard lm-help-panel">
        <h2>帮助与文档</h2>
        <p className="lm-meta">
          LawMind 本地服务仅监听本机回环地址；模型与检索配置见设置中的「API 配置向导」。
        </p>
        <ul className="lm-help-links">
          {DOCS.map((d) => (
            <li key={d.href}>
              <a href={d.href} target="_blank" rel="noreferrer noopener">
                {d.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
