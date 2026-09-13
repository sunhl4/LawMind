/** True only inside the Electron shell (preload). Browser tabs on Vite have no bridge. */
export function hasLawmindDesktopBridge(): boolean {
  return typeof window !== "undefined" && typeof window.lawmindDesktop?.getConfig === "function";
}
