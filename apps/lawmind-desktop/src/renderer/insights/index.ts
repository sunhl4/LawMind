/**
 * Renderer-side insights — W10。
 *
 * 这些 React 组件只做渲染，所有计算都来自 src/lawmind/insights/ 的纯函数。
 * MatterWorkbench 在 W11 拆分时只需透传 hints / experiments / events 数组。
 */

export { InteractionConvergence } from "./InteractionConvergence";
export { LawyerActionFeed } from "./LawyerActionFeed";
export { ProductExperiments } from "./ProductExperiments";
