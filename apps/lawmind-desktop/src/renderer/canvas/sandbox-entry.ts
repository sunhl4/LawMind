import React from "react";
import { createRoot } from "react-dom/client";
import * as canvas from "./index";

type StorageBridge = {
  mem: Record<string, string>;
  get(key: string): string | null;
  set(key: string, value: string): void;
};

const storage: StorageBridge = {
  mem: {},
  get(key) {
    return Object.prototype.hasOwnProperty.call(this.mem, key) ? this.mem[key] : null;
  },
  set(key, value) {
    this.mem[key] = value;
    window.parent.postMessage({ source: "lawmind-canvas", type: "state", key, value }, "*");
  },
};

const runtime = {
  ...canvas,
  storage,
  jsx: React.createElement,
  Fragment: React.Fragment,
  mount(Component: React.ComponentType) {
    const host = document.getElementById("root");
    if (!host) {
      return;
    }
    createRoot(host).render(React.createElement(canvas.CanvasThemeRoot, null, React.createElement(Component)));
  },
};

(globalThis as { LawmindCanvas?: typeof runtime }).LawmindCanvas = runtime;
