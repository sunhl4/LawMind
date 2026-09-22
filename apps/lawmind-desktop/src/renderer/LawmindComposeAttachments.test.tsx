/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindComposeAttachments } from "./LawmindComposeAttachments";

describe("LawmindComposeAttachments", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("clears matter association when × is clicked", async () => {
    const onClearMatter = vi.fn();
    await act(async () => {
      root.render(
        <LawmindComposeAttachments
          filePills={[]}
          contextMatterId="matter-1"
          matterTitle="Demo Matter"
          onRemoveFilePill={() => {}}
          onClearFilePills={() => {}}
          onClearMatter={onClearMatter}
        />,
      );
    });
    const remove = host.querySelector(
      'button[aria-label="取消关联案件 Demo Matter"]',
    ) as HTMLButtonElement | null;
    expect(remove).not.toBeNull();
    await act(async () => {
      remove?.click();
    });
    expect(onClearMatter).toHaveBeenCalledTimes(1);
  });
});
