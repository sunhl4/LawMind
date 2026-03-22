/**
 * Instruction Router
 *
 * 负责把律师的自然语言指令映射为结构化 TaskIntent。
 * 扩展方式：
 *   - 默认：keyword-route 关键字映射
 *   - 可选：LAWMIND_ROUTER_MODE=model + LLM 凭据，使用 routeAsync()
 */

export { route, type RouteInput } from "./keyword-route.js";
export { routeAsync, routeWithModel, isModelRouterEnabled } from "./model-route.js";
