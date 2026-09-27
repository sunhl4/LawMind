/* WPS 功能区回调。页面地址由本机服务在下发时替换，仓库里不写死端口。 */
function OnAddinLoad(ribbonUI) {
  try {
    if (window.Application) {
      window.Application.ribbonUI = ribbonUI;
    }
  } catch {
    /* 功能区对象偶发不可写，按钮仍可用。 */
  }
  return true;
}

function OnAction() {
  var url = "{{BASE}}/word-addin/wps/index.html";
  var pane = window.Application.CreateTaskPane(url);
  try {
    pane.Width = 420;
  } catch {
    /* 宽度不是必须的。 */
  }
  pane.Visible = true;
  return true;
}

globalThis.OnAddinLoad = OnAddinLoad;
globalThis.OnAction = OnAction;
