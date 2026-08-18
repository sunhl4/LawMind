/**
 * Instruction Router
 *
 * 负责把律师的自然语言指令映射为结构化 TaskIntent。
 * 扩展方式：
 *   - 默认：有 LLM 凭据时 routeAsync() 走模型；无凭据或 LAWMIND_ROUTER_MODE=keyword 回退关键字
 *   - 同步 route() 仍是关键词（测试 / 断网）
 */

export { route, type RouteInput } from "./keyword-route.js";
export {
  routeAsync,
  routeWithModel,
  isModelRouterEnabled,
  reportedRouterMode,
} from "./model-route.js";
