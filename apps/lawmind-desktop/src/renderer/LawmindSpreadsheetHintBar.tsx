import type { ReactNode } from "react";

export function shouldShowSpreadsheetHintBar(filePills: Array<{ relPath?: string; title?: string }>): boolean {
  return filePills.some((p) => /\.xlsx$/i.test(p.relPath ?? p.title ?? ""));
}

export function LawmindSpreadsheetHintBar(props: {
  filePills: Array<{ relPath?: string; title?: string }>;
}): ReactNode {
  if (!shouldShowSpreadsheetHintBar(props.filePills)) {
    return null;
  }
  return (
    <div
      className="lm-spreadsheet-hint-bar"
      role="status"
      data-testid="lm-spreadsheet-hint-bar"
    >
      <p className="lm-meta">数据与图表</p>
      <p className="lm-settings-caption" style={{ margin: 0 }}>
        已钉选表格。可先分析列与统计，再出图或导出 xlsx。数字会带来源，便于入卷。
      </p>
    </div>
  );
}
