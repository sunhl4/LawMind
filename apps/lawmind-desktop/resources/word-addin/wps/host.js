/* WPS 任务窗格在加载 taskpane.js 之前标明宿主，避免走 Word.run。 */
(function () {
  var current = window.LAWMIND_ADDIN || {};
  current.host = "wps";
  window.LAWMIND_ADDIN = current;
})();
