import { resolveProviderCapabilities } from "./provider-capabilities.js";

/** Resolve the exact outbound parameters once for both the wire and audit record. */
export function resolveSamplingParameters(config: {
  provider?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  capabilities?: { supportsSeed?: boolean; supportsJsonObject?: boolean };
  reproducible?: boolean;
  seed?: number;
  responseFormat?: { type: "json_object" };
}): { temperature: number; seed?: number; response_format?: { type: "json_object" } } {
  const capabilities = { ...resolveProviderCapabilities(config), ...config.capabilities };
  return {
    temperature: config.reproducible ? 0 : (config.temperature ?? 0.3),
    ...(config.reproducible && capabilities.supportsSeed
      ? { seed: Number.isSafeInteger(config.seed) ? config.seed! : 42 }
      : {}),
    ...(config.responseFormat?.type === "json_object" && capabilities.supportsJsonObject
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };
}
