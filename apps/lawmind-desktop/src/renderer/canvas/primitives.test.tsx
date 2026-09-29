/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LAWMIND_OPEN_WORKSPACE_FILE_EVENT } from "../lawmind-workspace-file-open";
import { CanvasHost } from "./CanvasHost";
import { Button, H1, Link, Pill, Stack, Table } from "./primitives";

describe("canvas primitives", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders a flat page heading and a table without shadows", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <CanvasHost>
          <Stack gap={12}>
            <H1>核对</H1>
            <Table headers={["项", "金额"]} rows={[["费用", "20"]]} />
            <Button variant="primary">看修订</Button>
          </Stack>
        </CanvasHost>,
      );
    });
    const heading = host.querySelector("h1");
    expect(heading?.textContent).toBe("核对");
    expect(heading?.style.fontSize).toBe("24px");
    expect(heading?.style.fontWeight).toBe("590");
    const frame = host.querySelector("table")?.parentElement;
    expect(frame?.style.boxShadow ?? "").not.toMatch(/[1-9]/);
    expect(frame?.style.backgroundImage ?? "").not.toContain("gradient");
    const button = host.querySelector("button");
    expect(button?.style.width).toBe("fit-content");
    expect(button?.style.alignSelf).toBe("flex-start");
    expect(button?.style.boxShadow ?? "").not.toMatch(/[1-9]/);
  });

  it("keeps a pill at its own width inside a vertical stack", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <CanvasHost>
          <Stack gap={8}>
            <Pill>已记录 2</Pill>
          </Stack>
        </CanvasHost>,
      );
    });
    const pill = host.querySelector("span");
    expect(pill?.textContent).toBe("已记录 2");
    expect(pill?.style.width).toBe("fit-content");
    expect(pill?.style.alignSelf).toBe("flex-start");
  });

  it("opens a workspace canvas from a link and ignores a path outside the workspace", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const opened: string[] = [];
    const onFile = (ev: Event) => {
      opened.push((ev as CustomEvent<{ relPath?: string }>).detail?.relPath ?? "");
    };
    window.addEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    act(() => {
      root.render(
        <CanvasHost>
          <Link href="canvas/核对.canvas.tsx">费用核对</Link>
          <Link href="../secret.docx">越界</Link>
        </CanvasHost>,
      );
    });
    const links = [...host.querySelectorAll("a")];
    act(() => {
      links[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      links[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    window.removeEventListener(LAWMIND_OPEN_WORKSPACE_FILE_EVENT, onFile);
    expect(links[0]?.textContent).toBe("费用核对");
    expect(opened).toEqual(["canvas/核对.canvas.tsx"]);
  });
});
