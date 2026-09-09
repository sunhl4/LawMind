import React from "react";
import { createPortal } from "react-dom";
import type { LawmindAppOverlaysProps } from "./LawmindAppOverlays";
import { LawmindAppOverlays } from "./LawmindAppOverlays";
import type { LawmindAppRootDialogsProps } from "./LawmindAppRootDialogs";
import { LawmindAppRootDialogs } from "./LawmindAppRootDialogs";
import { LawmindConfirmDialogHost } from "../LawmindConfirmDialogHost";
import { LawmindApprovalRequestHost } from "../LawmindApprovalRequestHost";

export type LawmindModalHostProps = {
  overlayProps: LawmindAppOverlaysProps;
  dialogProps: LawmindAppRootDialogsProps;
};

/**
 * Mount overlays/dialogs on `document.body` so `position: fixed` backdrops
 * are never flex children of `.lm-shell` (which otherwise can pin a form to
 * the left column beside the main pane).
 */
function LawmindModalHostImpl({ overlayProps, dialogProps }: LawmindModalHostProps) {
  if (typeof document === "undefined") {
    return null;
  }
  const { apiBase, contextMatterId } = dialogProps;
  return createPortal(
    <>
      <LawmindAppOverlays {...overlayProps} />
      <LawmindAppRootDialogs {...dialogProps} />
      <LawmindConfirmDialogHost />
      <LawmindApprovalRequestHost apiBase={apiBase} matterId={contextMatterId} />
    </>,
    document.body,
  );
}

export const LawmindModalHost = React.memo(LawmindModalHostImpl);
