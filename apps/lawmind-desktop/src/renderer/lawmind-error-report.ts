/**
 * Text we can actually debug from. The dialog and the clipboard use the same
 * string: error type, message, React component stack, and JS stack.
 * No case files and no secrets — only what the thrown error already carried.
 */

export type ErrorCauseReport = {
  where: string;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  at?: string;
};

export function describeThrown(error: unknown): Pick<ErrorCauseReport, "name" | "message" | "stack"> {
  if (error instanceof Error) {
    const name = error.name?.trim() || "Error";
    const message = error.message?.trim() || name;
    return { name, message, stack: error.stack?.trim() || "" };
  }
  if (typeof error === "string" && error.trim()) {
    return { name: "Error", message: error.trim(), stack: "" };
  }
  return { name: "Error", message: "未知错误", stack: "" };
}

/** Browser noise that is not a LawMind defect and should not cover the window. */
export function isIgnorableThrown(described: Pick<ErrorCauseReport, "name" | "message">): boolean {
  if (described.name === "AbortError") {
    return true;
  }
  return (
    described.message === "Script error." ||
    described.message === "Script error" ||
    described.message.startsWith("ResizeObserver loop")
  );
}

export function formatErrorCauseReport(report: ErrorCauseReport): string {
  const lines = [
    "LawMind 错误",
    `位置：${report.where}`,
    `时间：${report.at ?? new Date().toISOString()}`,
    `类型：${report.name}`,
    `说明：${report.message}`,
  ];
  const componentStack = report.componentStack.trim();
  if (componentStack) {
    lines.push("组件：", componentStack);
  }
  const stack = report.stack.trim();
  if (stack) {
    lines.push("堆栈：", stack);
  }
  return lines.join("\n");
}
