import { describe, expect, it } from "vitest";
import { canvasDataPath, compileCanvasSource } from "./compile-canvas";

const page = `
import { H1, Stack } from "cursor/canvas";
export default function Page() {
  return <Stack><H1>核对</H1></Stack>;
}
`;

describe("compileCanvasSource", () => {
  it("compiles a default export into a sandbox script", () => {
    const result = compileCanvasSource(page);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.script).toContain("const { H1, Stack } = LawmindCanvas;");
    expect(result.script).toContain("LawmindCanvas.jsx");
    expect(result.script).toContain("LawmindCanvas.mount(__canvasDefault)");
    expect(result.script).not.toContain("from \"cursor/canvas\"");
  });

  it("rejects network and foreign imports", () => {
    const fetched = compileCanvasSource(`${page}\nfetch("/x")`);
    expect(fetched.ok).toBe(false);
    if (!fetched.ok) {
      expect(fetched.diagnostics[0]?.line).toBeGreaterThan(1);
      expect(fetched.diagnostics[0]?.message).toContain("网络");
    }
    const foreign = compileCanvasSource(`import { x } from "react";\nexport default function Page(){ return null }\n`);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.error).toContain("cursor/canvas");
      expect(foreign.diagnostics[0]?.line).toBe(1);
    }
  });

  it("reports an unknown export on the import line", () => {
    const result = compileCanvasSource(`import { H1, NotAThing } from "cursor/canvas";
export default function Page() {
  return <H1>核对</H1>;
}
`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.line).toBe(1);
      expect(result.diagnostics[0]?.message).toContain("NotAThing");
    }
  });

  it("rejects a component that was not imported and allows a local one", () => {
    const missing = compileCanvasSource(`import { Stack } from "cursor/canvas";
export default function Page() {
  return <Stack><Missing /></Stack>;
}
`);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics[0]?.message).toContain("Missing");
      expect(missing.diagnostics[0]?.line).toBe(3);
    }
    const local = compileCanvasSource(`import { Stack, Text } from "cursor/canvas";
function Fee() {
  return <Text>1</Text>;
}
export default function Page() {
  return <Stack><Fee /></Stack>;
}
`);
    expect(local.ok).toBe(true);
  });

  it("places sidecar state beside the canvas file", () => {
    expect(canvasDataPath("notes/brief.canvas.tsx")).toBe("notes/brief.canvas.data.json");
    expect(canvasDataPath("../secret.canvas.tsx")).toBeNull();
  });
});
