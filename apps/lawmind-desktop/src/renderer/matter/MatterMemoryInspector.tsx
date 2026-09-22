/**
 * <MatterMemoryInspector /> — W11 视图组件 3/6（认知/记忆）。
 *
 * 直接复用 W6 的 MemoryInspector 组件，把案件 id / scope 注入。
 */

import type { ReactNode } from "react";
import MemoryInspector from "../MemoryInspector";

type Props = {
  apiBase: string;
  matterId: string;
};

export function MatterMemoryInspector({ apiBase, matterId }: Props): ReactNode {
  return (
    <section
      className="lm-matter-memory-inspector"
      data-testid="lm-matter-memory-inspector"
      data-matter-id={matterId}
    >
      <MemoryInspector baseUrl={apiBase} matterId={matterId} defaultScope="matter" />
    </section>
  );
}

export default MatterMemoryInspector;
