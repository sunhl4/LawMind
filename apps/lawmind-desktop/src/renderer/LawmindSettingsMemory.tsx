import type { ReactNode } from "react";
import MemoryInspector from "./MemoryInspector.js";

type Props = {
  apiBase: string;
};

/** Settings section: memory adoption queue (pending suggestions). */
export function LawmindSettingsMemory({ apiBase }: Props): ReactNode {
  return (
    <div className="lm-settings-section">
      <MemoryInspector baseUrl={apiBase} />
    </div>
  );
}
