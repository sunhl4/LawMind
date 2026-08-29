/**
 * Settings list: one lawyer-facing line. The stored lastResultSummary is a
 * machine log (paths, workflow ids, sync counts) and must not be shown raw.
 */

function firstFileName(raw: string): string | undefined {
  const tick = raw.match(/`([^`]+)`/);
  const fromTick = tick?.[1]?.split(/[/\\]/).pop()?.trim();
  if (fromTick) {
    return fromTick;
  }
  const loose = raw.match(/([^/\s`"']+\.(?:docx?|pdf|png|jpe?g|webp))/i);
  return loose?.[1];
}

function countFrom(raw: string, pattern: RegExp): number | undefined {
  const m = raw.match(pattern);
  if (!m?.[1]) {
    return undefined;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function formatAutomationLastResultForLawyer(raw: string | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return null;
  }

  if (/运行失败|远程同步失败|远程同步异常/.test(text)) {
    const hint = text.match(/运行失败（[^）]+）[:：]?\s*([^。]{2,40})/);
    if (hint?.[1]) {
      return `上次没跑成：${hint[1].trim()}`;
    }
    return "上次没跑成。请检查邮箱连接后再试。";
  }
  if (/未能启动工作流/.test(text)) {
    return "上次没能开始审阅。请确认案件和流程模板还在。";
  }
  if (/待批准发信未就绪/.test(text)) {
    return "上次办完了，但还没填客户邮箱，发不出去。";
  }
  if (/未发现带合同附件|无可用 Word|未启动审阅工作流/.test(text)) {
    return "上次看过邮箱，没有新的合同附件。";
  }
  if (/无一为可审阅合同格式/.test(text)) {
    return "上次有附件，但不是合同常用格式。请对方发 Word 或 PDF。";
  }
  if (/未配置远程邮箱/.test(text)) {
    return "还没连邮箱。请先在下方配好账号。";
  }

  const contracts = countFrom(text, /发现\s*(\d+)\s*个合同/);
  const synced = countFrom(text, /同步\s*(\d+)\s*封/);
  const started = /已启动/.test(text);
  const file = firstFileName(text);

  if (contracts != null && contracts > 0 && started) {
    return file
      ? `上次发现 ${contracts} 份合同（${file}），已开始审阅。结果在「待我拍板」。`
      : `上次发现 ${contracts} 份合同，已开始审阅。结果在「待我拍板」。`;
  }
  if (contracts != null && contracts > 0) {
    return `上次发现 ${contracts} 份合同。请到「待我拍板」看。`;
  }
  if (started) {
    return "上次已开始办理。结果在「待我拍板」。";
  }
  if (synced === 0) {
    return "上次没有新往来。";
  }
  if (synced != null && synced > 0) {
    return `上次同步了 ${synced} 封邮件。`;
  }
  return "上次已跑过。结果请到「待我拍板」看。";
}
