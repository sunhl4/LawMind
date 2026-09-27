/** Desktop update actions. The settings sidebar no longer has an update page. */

export async function checkDesktopUpdates(): Promise<boolean> {
  const api = window.lawmindDesktop?.checkForUpdates;
  if (!api) {
    return false;
  }
  await api();
  return true;
}

export function openDesktopDownloadPage(url: string): void {
  void window.lawmindDesktop?.openExternal(url);
}
