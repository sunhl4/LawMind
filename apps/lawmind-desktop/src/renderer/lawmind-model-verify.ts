import type { ModelCatalogEntry } from "./lawmind-models-api";
import { resolveComposeModelSelectValue } from "./lawmind-model-picker-utils";

export const MODEL_NOT_VERIFIED_HINT =
  "当前模型尚未验证通过。本机有 Key 不等于能连上。请点「测试连接」；若提示 Key 无效，到服务商重新生成后再用「API 配置向导」粘贴。";

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
