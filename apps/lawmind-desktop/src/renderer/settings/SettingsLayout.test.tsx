/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsLayout";

describe("SettingsLayout", () => {
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

  it("renders section title and row label", async () => {
    await act(async () => {
      root.render(
        <SettingsSection title="测试分区">
          <SettingsGroup label="分组">
            <SettingsRow label="行标签" hint="提示语">
              <span>值</span>
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>,
      );
    });
    expect(host.textContent).toContain("测试分区");
    expect(host.textContent).toContain("行标签");
    expect(host.textContent).toContain("提示语");
    expect(host.textContent).toContain("值");
  });
});
