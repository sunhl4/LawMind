import type { MatterWorkbenchMainPanelsProps } from "./MatterWorkbenchMainPanels";

export function buildMatterWorkbenchMainPanelProps(
  input: MatterWorkbenchMainPanelsProps,
): MatterWorkbenchMainPanelsProps {
  return input;
}

export function matterMainPanelShell(input: {
  isUnlinkedBucket: boolean;
  showShellOps: boolean;
  matterId: string | null;
  detailLoading: boolean;
  detailError: string | null;
  summary: MatterWorkbenchMainPanelsProps["summary"];
  selectedOverview: MatterWorkbenchMainPanelsProps["selectedOverview"];
}): Pick<
  MatterWorkbenchMainPanelsProps,
  "matterId" | "detailLoading" | "detailError" | "summary" | "selectedOverview" | "isUnlinkedBucket"
> {
  const unlinked = input.isUnlinkedBucket && input.showShellOps;
  return {
    matterId: unlinked ? null : input.matterId,
    detailLoading: unlinked ? false : input.detailLoading,
    detailError: unlinked ? null : input.detailError,
    summary: unlinked ? null : input.summary,
    selectedOverview: unlinked ? null : input.selectedOverview,
    isUnlinkedBucket: unlinked,
  };
}
