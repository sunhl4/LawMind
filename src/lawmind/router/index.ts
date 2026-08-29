/**
 * Instruction Router
 *
 * 负责把律师的自然语言指令映射为结构化 TaskIntent。
 * 扩展方式：
 *   - routeAsync()：有 LLM 凭据时模型分类，失败回退关键词
 *   - LAWMIND_ROUTER_MODE=keyword 可强制关键词
 */

export { route, type RouteInput } from "./keyword-route.js";
export {
  routeAsync,
  routeWithModel,
  isModelRouterEnabled,
  effectiveRouterMode,
} from "./model-route.js";
