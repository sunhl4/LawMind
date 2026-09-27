/** 左栏点开一份材料时通知采信纸：原件交给本机应用，文本则把中栏让给编辑器。 */

export const LAWMIND_MATERIAL_CHOSEN_EVENT = "lawmind:material-chosen";

export type MaterialChosenDetail = {
  root: "workspace" | "project";
  relPath: string;
};

export function notifyMaterialChosen(root: MaterialChosenDetail["root"], relPath: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<MaterialChosenDetail>(LAWMIND_MATERIAL_CHOSEN_EVENT, {
      detail: { root, relPath },
    }),
  );
}

export function isNativeOfficePath(relPath: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?)$/i.test(relPath);
}
