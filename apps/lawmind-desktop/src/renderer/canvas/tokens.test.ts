import { describe, expect, it } from "vitest";
import { buildHostTokens, canvasTokens, canvasTokensLight } from "./tokens";

describe("buildHostTokens", () => {
  it("exposes category and palette the way a Cursor canvas reads useHostTheme", () => {
    const dark = buildHostTokens("dark");
    expect(dark.tokens).toBe(canvasTokens);
    expect(dark.tokens.category.blue).toBe("#87C3FF");
    expect(dark.palette.editor).toBe("#181818");
    expect(dark.palette.accent).toBe("#599CE7");
    expect(dark.palette.buttonBackground).toBe(dark.tokens.accent.control);

    const light = buildHostTokens("light");
    expect(light.tokens).toBe(canvasTokensLight);
    expect(light.palette.foreground).toBe("#141414");
    expect(light.tokens.category.green).toBe("#0D855A");
  });
});
