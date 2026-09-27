/**
 * 案件认知：只看本案事实，撤回是主操作。
 */

import type { ReactNode } from "react";
import { LawmindMemoryLibrary } from "../LawmindMemoryLibrary";

type Props = {
  apiBase: string;
  matterId: string;
};

export function MatterMemoryInspector({ apiBase, matterId }: Props): ReactNode {
  return (
    <section aria-label="本案认知">
      <LawmindMemoryLibrary apiBase={apiBase} view="matter" matterId={matterId} />
    </section>
  );
}

export default MatterMemoryInspector;
