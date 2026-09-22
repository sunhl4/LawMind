/**
 * 内部仪器开关：产品实验台（跨案件实验累积板 / Roadmap 候选池等）仅团队自用，
 * 律师构建一律不可见。默认仅 vite dev（import.meta.env.DEV）开启；
 * 可用 VITE_LAWMIND_INTERNAL_EXPERIMENT_UI=1/0 显式覆盖（含生产构建内测）。
 */

const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;

export function isInternalExperimentUiEnabled(): boolean {
  const explicit = env?.VITE_LAWMIND_INTERNAL_EXPERIMENT_UI;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return !["0", "false", "off"].includes(explicit.trim().toLowerCase());
  }
  return Boolean(env?.DEV);
}
