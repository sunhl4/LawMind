import React from "react";
import type { LawmindAppOverlaysProps } from "./LawmindAppOverlays";
import { LawmindAppOverlays } from "./LawmindAppOverlays";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import { LawmindAppRootDialogs } from "./LawmindAppRootDialogs";

export type LawmindModalHostProps = {
  overlayProps: LawmindAppOverlaysProps;
  dialogProps: LawmindAppRootDialogsProps;
};

function LawmindModalHostImpl({ overlayProps, dialogProps }: LawmindModalHostProps) {
  return (
    <>
      <LawmindAppOverlays {...overlayProps} />
      <LawmindAppRootDialogs {...dialogProps} />
    </>
  );
}

export const LawmindModalHost = React.memo(LawmindModalHostImpl);
