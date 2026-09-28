/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasHost } from "./CanvasHost";
import { Button, H1, Pill, Stack, Table } from "./primitives";

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
});
