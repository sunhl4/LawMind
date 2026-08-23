export * from "./types.js";
export * from "./catalog.js";
export * from "./providers.js";
export * from "./platform-catalog.js";
export * from "./platform-providers.js";
export * from "./custom-store.js";
export * from "./draft-reasoning.js";
export * from "./capability-envelope.js";
export * from "./resolve.js";
export * from "./probe.js";

/** Keyword vs model router label for desktop diagnostics. */
export function effectiveRouterMode(_lawMindRoot?: string): "keyword" | "model" {
  return "keyword";
}
