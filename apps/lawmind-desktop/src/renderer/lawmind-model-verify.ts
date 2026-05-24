import type { ModelCatalogEntry } from "./lawmind-models-api";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";

export const MODEL_NOT_VERIFIED_HINT =
  "当前模型尚未验证。请在模型旁点击「测试当前模型连接」，或打开 API 配置向导完成「验证并保存」。";

/** Whether the catalog row has a recent successful probe (`verifiedAt`). */
export function isModelEntryVerified(row: ModelCatalogEntry | undefined): boolean {
  return Boolean(row?.configured && row.verifiedAt?.trim());
}

export function findCatalogEntry(
  catalog: ModelCatalogEntry[],
  selectedModelId: string,
): ModelCatalogEntry | undefined {
  const id = resolveComposeModelSelectValue(catalog, selectedModelId);
  return catalog.find((m) => m.id === id);
}

export function isSelectedModelVerified(
  catalog: ModelCatalogEntry[],
  selectedModelId: string,
): boolean {
  return isModelEntryVerified(findCatalogEntry(catalog, selectedModelId));
}
