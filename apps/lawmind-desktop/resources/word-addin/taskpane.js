/*
 * LawMind Word 插件任务窗格。
 *
 * 律师只看到一个输入框。默认「按本所标准审这份」，多写的那句话覆盖默认。
 * 结果自动落成当前宿主的修订（Word 用 Word.run，WPS 用 Application）。
 * 整节重写不在这里落，只说已放到桌面稿。
 *
 * 网络面只有 window.LAWMIND_ADDIN.base（本机回环地址）；没有远程控制面。
 */
/* global Office, Word, window, document, fetch, setTimeout */

(function () {
  "use strict";

  var CONFIG = window.LAWMIND_ADDIN || { base: "", token: "" };
  var POLL_INTERVAL_MS = 4000;
  var POLL_MAX_TICKS = 75;
  /**
   * 「审这份」是否由桌面端自动开跑。关掉（律所版档位）时不能写「正在自动审查」——
   * 那时律师确实还得回桌面端跑一次，文案必须说真话。
   */
  var AUTO_RUN = CONFIG.autoRun !== false;
  var DEFAULT_ASK = "按本所标准审这份";
  /** 每条建议在这份窗格里的决定：applied / discarded / missed。按请求 id 分开。 */
  var suggestionDecisions = {};
  var documentReviews = [];

  var pollTimer = null;
  var pollTicks = 0;
  var currentRequestId = null;
  var currentRequest = null;

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    var node = el(id);
    if (node) {
      node.textContent = text;
    }
  }

  /**
   * 单次请求。失败时把 HTTP 状态挂到错误上，好让上层区分「凭据过期」与「真的坏了」。
   */
  function apiOnce(path, init) {
    var options = init || {};
    options.headers = Object.assign(
      {
        "content-type": "application/json",
        authorization: "Bearer " + CONFIG.token,
      },
      options.headers || {},
    );
    return fetch(CONFIG.base + path, options).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) {
          var err = new Error(
            (body && (body.error || body.message)) || "本机 LawMind 未响应：" + res.status,
          );
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  /** 401（`invalid_api_token`）——凭据过期或已被轮换/吊销，值得重新取一次配置。 */
  function isLoopbackAuthError(err) {
    return Boolean(err) && err.status === 401;
  }

  var configRefreshInFlight = null;

  /**
   * 重新取一次同源配置，换上新凭据。
   *
   * 为什么用「重新插入 <script>」而不是 fetch + JSON.parse：
   *   - 页面 CSP 是 `script-src 'self'`，同源脚本本来就放行（这正是当初把令牌从内联
   *     `<script>` 挪到 `config.js` 的原因），所以这条路不需要放宽任何策略；
   *   - 而 `config.js` 是脚本体（`window.LAWMIND_ADDIN = {...};`），用 fetch 取回来还得
   *     自己解析那段 JS —— 多一处会漂移的格式约定。让浏览器直接执行它，格式约定只有一处。
   *
   * 并发去重：一次刷新期间的所有 401 共用同一个 in-flight promise，避免 N 个轮询
   * 同时各插一个 script。
   */
  function refreshAddinConfig() {
    if (configRefreshInFlight) {
      return configRefreshInFlight;
    }
    configRefreshInFlight = new Promise(function (resolve) {
      var el = document.createElement("script");
      // 相对本页 origin 取：本页就是从本机服务加载的，origin 即 base（端口变了就换不了，
      // 那时只能重开窗格——见 humanApiError 的文案）。
      el.src = CONFIG.base + "/word-addin/config.js?ts=" + Date.now();
      // 用 addEventListener 而不是 onload/onerror 赋值：后者会覆盖既有处理器，
      // 而这颗 script 的生命周期里不该有任何隐式替换（lint 也拦这个）。
      el.addEventListener("load", function () {
        var next = window.LAWMIND_ADDIN;
        if (next && next.token) {
          var host = CONFIG.host;
          CONFIG = next;
          if (host) {
            CONFIG.host = host;
          }
          AUTO_RUN = CONFIG.autoRun !== false;
          configRefreshInFlight = null;
          resolve(true);
          return;
        }
        configRefreshInFlight = null;
        resolve(false);
      });
      el.addEventListener("error", function () {
        configRefreshInFlight = null;
        resolve(false);
      });
      document.head.appendChild(el);
    });
    return configRefreshInFlight;
  }

  /**
   * 带自愈的请求：收到 401 就换一次凭据并**重放一次**。
   *
   * 只重放一次是刻意的：若换完还是 401，说明凭据被吊销或本机服务已不是同一实例，
   * 这时继续重试只会把真正的失败藏起来。失败要如实上报，不要静默重试。
   */
  function api(path, init) {
    return apiOnce(path, init).catch(function (err) {
      if (!isLoopbackAuthError(err)) {
        throw err;
      }
      return refreshAddinConfig().then(function (refreshed) {
        if (!refreshed) {
          throw err;
        }
        return apiOnce(path, init);
      });
    });
  }

  /**
   * 给律师看的失败说明。
   *
   * 改造前这里直接把服务端那句 `unauthorized` 显示出来 —— 律师看不懂，也看不出
   * 该做什么。凭据问题要明确给出「重开窗格」这个动作，其余错误照原样显示。
   */
  function humanApiError(err) {
    if (isLoopbackAuthError(err)) {
      return "LawMind 没连上。请完全退出 Word 或 WPS 后重新打开。";
    }
    return String((err && err.message) || err);
  }

  function wpsDocumentPath() {
    var app = window.Application;
    var doc = app && app.ActiveDocument;
    if (!doc) {
      return "";
    }
    var full = "";
    try {
      full = String(doc.FullName || "");
    } catch {
      full = "";
    }
    if (full && full.indexOf("://") < 0 && (full.indexOf("/") >= 0 || full.indexOf("\\") >= 0)) {
      return full;
    }
    var dir = "";
    var name = "";
    try {
      dir = String(doc.Path || "");
    } catch {
      dir = "";
    }
    try {
      name = String(doc.Name || "");
    } catch {
      name = "";
    }
    if (!dir || !name) {
      return "";
    }
    var sep = dir.indexOf("\\") >= 0 ? "\\" : "/";
    return dir.replace(/[\\/]+$/, "") + sep + name;
  }

  function currentDocumentPath() {
    if (CONFIG.host === "wps") {
      return wpsDocumentPath();
    }
    if (typeof Office === "undefined" || !Office.context || !Office.context.document) {
      return "";
    }
    var url = Office.context.document.url || "";
    return url ? decodeURIComponent(url.replace(/^file:\/\//, "")) : "";
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTicks = 0;
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }

  function poll() {
    if (!currentRequestId) {
      return;
    }
    pollTicks += 1;
    if (pollTicks > POLL_MAX_TICKS) {
      setText("review-state", AUTO_RUN
        ? "已等 5 分钟仍未有结果。请关掉窗格再打开；若已失败，桌面端会写明原因。"
        : "已等 5 分钟仍未有结果。请在桌面端 LawMind 里跑一次审查，然后关掉窗格再打开。");
      stopPolling();
      return;
    }
    api("/api/word-addin/reviews/" + encodeURIComponent(currentRequestId))
      .then(function (body) {
        renderRequest(body.request);
        if (body.request && (body.request.state === "queued" || body.request.state === "running")) {
          pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          stopPolling();
        }
      })
      .catch(function (err) {
        setText("review-state", humanApiError(err));
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      });
  }

  function stateLabel(state) {
    if (state === "queued") {
      return AUTO_RUN
        ? "已交给桌面端，正在自动审查…（可直接关掉窗格，跑完再回来）"
        : "已交给桌面端（排队中）。请在 LawMind 桌面端跑这次审查。";
    }
    if (state === "running") {
      return "正在通读这份稿，并准备逐条建议。";
    }
    if (state === "ready") {
      return "已拿到结果。";
    }
    if (state === "failed") {
      return "桌面端报告失败。";
    }
    if (state === "needs_matter") {
      return "需要选一个案卷。";
    }
    if (state === "stale") {
      return "文件已改动，这次作废。";
    }
    if (state === "superseded") {
      return "这次已被更新的同文件请求取代。";
    }
    return state || "";
  }

  /** 律师可读的一行：优先用引擎写的 note（needs_matter / stale / superseded 都有）。 */
  function requestStatusLine(request) {
    var label = stateLabel(request.state);
    var detail = request.note || request.error;
    return detail ? label + " " + detail : label;
  }

  function setComposerLocked(locked) {
    var ask = el("ask");
    var submit = el("btn-submit");
    var note = el("lock-note");
    if (ask) {
      ask.disabled = locked;
    }
    if (submit) {
      submit.disabled = locked;
    }
    if (note) {
      note.hidden = !locked;
    }
  }

  function showDesktopDraft(request) {
    var note = el("desktop-note");
    if (!note) {
      return;
    }
    var show = Boolean(request && request.skippedSectionHunks);
    note.hidden = !show;
    if (show) {
      note.textContent = "整节重写已放到桌面稿。";
    }
  }

  function seedDecisions(request) {
    var local = suggestionDecisions[request.id] || {};
    var remote = request.decisions || {};
    var merged = {};
    Object.keys(remote).forEach(function (key) {
      merged[key] = remote[key];
    });
    Object.keys(local).forEach(function (key) {
      merged[key] = local[key];
    });
    suggestionDecisions[request.id] = merged;
  }

  function decisionsFor(requestId) {
    if (!suggestionDecisions[requestId]) {
      suggestionDecisions[requestId] = {};
    }
    return suggestionDecisions[requestId];
  }

  function persistDecision(index, status) {
    if (!currentRequestId) {
      return;
    }
    api("/api/word-addin/reviews/" + encodeURIComponent(currentRequestId) + "/decisions", {
      method: "POST",
      body: JSON.stringify({ index: index, status: status }),
    }).catch(function () {
      setText("apply-log", "这一处已在窗格里记下，但没能写回本机记录。重开后可能要再选一次。");
    });
  }

  function commentText(hunk) {
    var parts = [];
    if (hunk.where) {
      parts.push("位于" + hunk.where);
    }
    parts.push(hunk.note || "LawMind 建议");
    return parts.join("。");
  }

  function openSuggestionIndexes(request) {
    var map = decisionsFor(request.id);
    var indexes = [];
    (request.hunks || []).forEach(function (_hunk, index) {
      if (!map[index]) {
        indexes.push(index);
      }
    });
    return indexes;
  }

  function decisionLabel(kind) {
    if (kind === "applied") {
      return "已写入修订。请在正文里接受或拒绝。";
    }
    if (kind === "discarded") {
      return "已放弃，不写入。";
    }
    if (kind === "missed") {
      return "没写上：正文里对不上这一处。";
    }
    return "";
  }

  function renderHunks(hunks) {
    var list = el("hunk-list");
    if (!list || !currentRequest) {
      return;
    }
    var map = decisionsFor(currentRequest.id);
    list.innerHTML = "";
    hunks.forEach(function (hunk, index) {
      var li = document.createElement("li");
      var decided = map[index];
      li.className = "hunk" + (decided ? " is-done" : "");
      var before = document.createElement("p");
      before.className = "hunk__before";
      before.textContent = "- " + hunk.find;
      var after = document.createElement("p");
      after.className = "hunk__after";
      after.textContent = "+ " + hunk.replace;
      li.appendChild(before);
      li.appendChild(after);
      if (hunk.where) {
        var where = document.createElement("p");
        where.className = "hunk__note";
        where.textContent = "位于：" + hunk.where;
        li.appendChild(where);
      }
      if (hunk.note) {
        var note = document.createElement("p");
        note.className = "hunk__note";
        note.textContent = "为什么：" + hunk.note;
        li.appendChild(note);
      }
      if (decided) {
        var status = document.createElement("p");
        status.className = "hunk__note";
        status.textContent = decisionLabel(decided);
        li.appendChild(status);
      } else {
        var field = document.createElement("textarea");
        field.className = "field hunk__replace";
        field.rows = 2;
        field.value = hunk.replace || "";
        field.setAttribute("aria-label", "修改这一处的替换文字");
        field.addEventListener("input", function () {
          hunk.replace = field.value;
        });
        field.addEventListener("change", function () {
          hunk.replace = field.value;
          api("/api/word-addin/reviews/" + encodeURIComponent(currentRequest.id) + "/revise", {
            method: "POST",
            body: JSON.stringify({ index: index, replace: field.value }),
          }).catch(function () {
            setText("apply-log", "措辞先记在窗格里。确认写入时会再试一次。");
          });
        });
        li.appendChild(field);
        var keep = document.createElement("label");
        keep.className = "hunk__keep";
        var keepBox = document.createElement("input");
        keepBox.type = "checkbox";
        keepBox.checked = hunk.keep !== false;
        keepBox.addEventListener("change", function () {
          hunk.keep = keepBox.checked;
        });
        keep.appendChild(keepBox);
        keep.appendChild(document.createTextNode("写入这一处"));
        var commentBox = document.createElement("input");
        commentBox.type = "checkbox";
        commentBox.checked = hunk.withComment === true;
        commentBox.addEventListener("change", function () {
          hunk.withComment = commentBox.checked;
        });
        keep.appendChild(commentBox);
        keep.appendChild(document.createTextNode("加批注"));
        li.appendChild(keep);
        var actions = document.createElement("div");
        actions.className = "hunk__actions";
        var discard = document.createElement("button");
        discard.type = "button";
        discard.className = "btn";
        discard.setAttribute("data-act", "discard");
        discard.setAttribute("data-index", String(index));
        discard.textContent = "不要这处";
        actions.appendChild(discard);
        li.appendChild(actions);
      }
      list.appendChild(li);
    });
    var applyAll = el("btn-apply-all");
    if (applyAll) {
      applyAll.hidden = openSuggestionIndexes(currentRequest).length === 0;
    }
  }

  function renderRequest(request) {
    currentRequest = request;
    if (!request) {
      return;
    }
    currentRequestId = request.id;
    seedDecisions(request);
    var running = request.state === "queued" || request.state === "running";
    setComposerLocked(running);
    setText("review-state", requestStatusLine(request));
    var hunks = request.hunks || [];
    var card = el("result-card");
    var hasDesktop = Boolean(request.skippedSectionHunks);
    var showCard = request.state === "ready" && (hunks.length > 0 || hasDesktop);
    if (card) {
      card.hidden = !showCard;
    }
    if (!showCard) {
      return;
    }
    showDesktopDraft(request);
    if (hunks.length === 0) {
      setText("result-summary", "这次没有能写进正文的短修订。");
      renderHunks([]);
      return;
    }
    setText(
      "result-summary",
      (request.summary ? request.summary + "。" : "") +
        "共 " +
        hunks.length +
        " 处建议。桌面稿已经写出。先改措辞、去掉不要的，再确认写入当前文档。",
    );
    renderHunks(hunks);
  }

  function onSubmit() {
    var path = currentDocumentPath();
    if (!path) {
      setText("review-state", "这份文档还没有本机路径（未保存）。请先另存为 .docx。");
      return;
    }
    var askNode = el("ask");
    var ask = askNode && askNode.value ? String(askNode.value).trim() : "";
    if (!ask) {
      ask = DEFAULT_ASK;
    }
    setText("review-state", "正在交给桌面端…");
    setComposerLocked(true);
    api("/api/word-addin/reviews", {
      method: "POST",
      body: JSON.stringify({ path: path, instruction: ask }),
    })
      .then(function (body) {
        renderRequest(body.request);
        var next = [body.request].concat(
          documentReviews.filter(function (item) {
            return item.id !== body.request.id;
          }),
        );
        renderThread(next, body.request.id);
        startPolling();
      })
      .catch(function (err) {
        setComposerLocked(false);
        setText("review-state", humanApiError(err));
      });
  }

  /**
   * 把锚点落成 Word 原生修订轨。
   *
   * Word.js 是**队列式** API：属性/集合要先 load（+ sync）才能读，否则 Word 直接抛
   * 「属性…不可用…请先调用 load 方法」（真机实测踩到）。所以顺序固定为：
   * 能力探测 → load("changeTrackingMode") → sync → 读旧值并打开修订轨 → sync
   * → 逐个锚点 search/load/sync → 恢复旧值 → sync。
   */
  function applyHunksInWord(hunks) {
    return Word.run(function (context) {
      var doc = context.document;
      // 能力探测只看枚举本身，不读文档属性（读属性必须 load + sync）。
      if (!Word.ChangeTrackingMode || !Word.ChangeTrackingMode.trackAll) {
        return Promise.reject(
          new Error("当前 Word 版本不支持以修订轨方式落改（缺少 changeTrackingMode）。请在桌面端查看审阅稿。"),
        );
      }
      doc.load("changeTrackingMode");
      return context.sync().then(function () {
        var previousMode = doc.changeTrackingMode;
        doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll;
        // 先落地「打开修订轨」，再开始改字：顺序反了就会产生无痕迹编辑。
        return context.sync().then(function () {
          return runHunks(context, doc, hunks, Word.InsertLocation.replace);
        }).then(function (tally) {
          doc.changeTrackingMode = previousMode;
          return context.sync().then(function () {
            return tally;
          });
        });
      });
    });
  }

  function runHunks(context, doc, hunks, replaceLocation) {
    var applied = 0;
    var missed = [];
    return hunks
      .reduce(function (chain, hunk) {
        return chain.then(function () {
          var results = doc.body.search(hunk.find, { matchCase: true });
          results.load("items");
          return context.sync().then(function () {
            if (!results.items || results.items.length === 0) {
              missed.push(hunk.find);
              return undefined;
            }
            // 锚点必须唯一命中：多处命中交回桌面端，不静默挑一处。
            if (results.items.length > 1) {
              missed.push(hunk.find + "（命中 " + results.items.length + " 处）");
              return undefined;
            }
            var inserted = results.items[0].insertText(hunk.replace, replaceLocation);
            if (hunk.comment && inserted && typeof inserted.insertComment === "function") {
              inserted.insertComment(String(hunk.comment));
            }
            applied += 1;
            return context.sync();
          });
        });
      }, Promise.resolve())
      .then(function () {
        return { applied: applied, missed: missed };
      });
  }

  /**
   * WPS 文字：打开修订后，用 Range 只替换唯一命中的锚点。
   * 没有 Range 就不改全文，避免整篇变成一次无差别替换。
   */
  function applyHunksInWps(hunks, document) {
    var doc = document;
    if (!doc) {
      var app = window.Application;
      doc = app && app.ActiveDocument;
    }
    if (!doc) {
      return Promise.reject(new Error("WPS 里没有打开的文档。已放到桌面稿。"));
    }
    if (typeof doc.TrackRevisions === "undefined" || typeof doc.Range !== "function" || !doc.Content) {
      return Promise.reject(new Error("当前 WPS 不能把修订写进正文。已放到桌面稿。"));
    }
    var previous = doc.TrackRevisions;
    doc.TrackRevisions = true;
    var applied = 0;
    var missed = [];
    try {
      hunks.forEach(function (hunk) {
        var text = String(doc.Content.Text || "");
        var first = text.indexOf(hunk.find);
        if (first < 0) {
          missed.push(hunk.find);
          return;
        }
        var next = text.indexOf(hunk.find, first + hunk.find.length);
        if (next >= 0) {
          var count = 1;
          var from = next;
          while (from >= 0) {
            count += 1;
            from = text.indexOf(hunk.find, from + hunk.find.length);
          }
          missed.push(hunk.find + "（命中 " + count + " 处）");
          return;
        }
        var range = doc.Range(first, first + hunk.find.length);
        range.Text = hunk.replace;
        if (hunk.comment && doc.Comments && typeof doc.Comments.Add === "function") {
          try {
            var commented = doc.Range(first, first + String(hunk.replace).length);
            doc.Comments.Add(commented, String(hunk.comment));
          } catch {
            /* 修订已经落下；批注失败不把这一处算没写入。 */
          }
        }
        applied += 1;
      });
    } finally {
      doc.TrackRevisions = previous;
    }
    return Promise.resolve({ applied: applied, missed: missed });
  }

  function placeIndexes(indexes, withComment) {
    if (!currentRequest || !indexes || indexes.length === 0) {
      return;
    }
    var request = currentRequest;
    var map = decisionsFor(request.id);
    setText("apply-log", withComment ? "正在写入修订并加批注…" : "正在写入修订…");
    var chain = Promise.resolve();
    indexes.forEach(function (index) {
      chain = chain.then(function () {
        if (map[index]) {
          return undefined;
        }
        var hunk = request.hunks[index];
        var payload = {
          find: hunk.find,
          replace: hunk.replace,
          note: hunk.note,
        };
        if (withComment || hunk.withComment) {
          payload.comment = commentText(hunk);
        }
        var placing = CONFIG.host === "wps" ? applyHunksInWps([payload]) : applyHunksInWord([payload]);
        return placing.then(function (result) {
          var status = result.applied > 0 ? "applied" : "missed";
          map[index] = status;
          persistDecision(index, status);
        });
      });
    });
    chain
      .then(function () {
        renderHunks(request.hunks || []);
        var applied = 0;
        var missed = 0;
        indexes.forEach(function (index) {
          if (map[index] === "applied") {
            applied += 1;
          } else if (map[index] === "missed") {
            missed += 1;
          }
        });
        setText(
          "apply-log",
          "已写入 " + applied + " 处" + (missed ? "；" + missed + " 处没对上正文。" : "。") + "请在正文里接受或拒绝。",
        );
      })
      .catch(function (err) {
        renderHunks(request.hunks || []);
        setText("apply-log", String((err && err.message) || err));
      });
  }

  function onHunkClick(event) {
    var button = event.target;
    if (!button || !button.getAttribute || !currentRequest) {
      return;
    }
    var action = button.getAttribute("data-act");
    var index = Number(button.getAttribute("data-index"));
    if (!action || !isFinite(index)) {
      return;
    }
    if (action === "discard") {
      decisionsFor(currentRequest.id)[index] = "discarded";
      persistDecision(index, "discarded");
      renderHunks(currentRequest.hunks || []);
      setText("apply-log", "这一处不写入。");
      return;
    }
  }

  function keptIndexes(request) {
    var map = decisionsFor(request.id);
    var indexes = [];
    (request.hunks || []).forEach(function (hunk, index) {
      if (!map[index] && hunk.keep !== false) {
        indexes.push(index);
      }
    });
    return indexes;
  }

  function onApplyAll() {
    if (!currentRequest) {
      return;
    }
    var request = currentRequest;
    var map = decisionsFor(request.id);
    var dropped = [];
    (request.hunks || []).forEach(function (hunk, index) {
      if (!map[index] && hunk.keep === false) {
        dropped.push(index);
      }
    });
    var kept = keptIndexes(request);
    if (kept.length === 0 && dropped.length === 0) {
      setText("apply-log", "没有要写入的修订。");
      return;
    }
    setText("apply-log", "正在按勾选写入…");
    var chain = Promise.resolve();
    dropped.forEach(function (index) {
      chain = chain.then(function () {
        map[index] = "discarded";
        return api("/api/word-addin/reviews/" + encodeURIComponent(request.id) + "/decisions", {
          method: "POST",
          body: JSON.stringify({ index: index, status: "discarded" }),
        });
      });
    });
    kept.forEach(function (index) {
      chain = chain.then(function () {
        var hunk = request.hunks[index];
        return api("/api/word-addin/reviews/" + encodeURIComponent(request.id) + "/revise", {
          method: "POST",
          body: JSON.stringify({ index: index, replace: hunk.replace }),
        });
      });
    });
    chain
      .then(function () {
        if (!request.taskId) {
          return undefined;
        }
        return api("/api/word-addin/reviews/" + encodeURIComponent(request.id) + "/commit", {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(function () {
          setText("apply-log", "当前文档会写入。旁边那版 Word 这次没能覆盖。");
          return undefined;
        });
      })
      .then(function () {
        if (kept.length === 0) {
          renderHunks(request.hunks || []);
          setText("apply-log", "已去掉不写的修订。");
          return undefined;
        }
        placeIndexes(kept, false);
        return undefined;
      })
      .catch(function (err) {
        setText("apply-log", humanApiError(err));
      });
  }

  function threadTitle(item) {
    var ask = String((item && item.instruction) || DEFAULT_ASK)
      .replace(/\s+/g, " ")
      .trim();
    if (ask.length > 42) {
      ask = ask.slice(0, 42) + "…";
    }
    return ask + " · " + stateLabel(item && item.state);
  }

  function renderThread(items, activeId) {
    var list = el("thread-list");
    if (!list) {
      return;
    }
    documentReviews = items || [];
    var rows = documentReviews.slice(0, 8);
    list.hidden = rows.length === 0;
    list.innerHTML = "";
    rows.forEach(function (item) {
      var li = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn thread__item" + (item.id === activeId ? " is-on" : "");
      button.textContent = threadTitle(item);
      button.addEventListener("click", function () {
        renderRequest(item);
        renderThread(documentReviews, item.id);
        if (item.state === "queued" || item.state === "running") {
          currentRequestId = item.id;
          startPolling();
        }
      });
      li.appendChild(button);
      list.appendChild(li);
    });
  }

  function onExport() {
    if (!currentRequestId) {
      setText("apply-log", "还没有发起过审查。");
      return;
    }
    api("/api/word-addin/reviews/" + encodeURIComponent(currentRequestId) + "/export", {
      method: "POST",
      body: JSON.stringify({}),
    })
      .then(function (body) {
        setText(
          "apply-log",
          body.exists
            ? "产物已就绪：" + body.outputPath
            : "桌面端尚未写出产物（或路径已移动）：" + (body.outputPath || ""),
        );
      })
      .catch(function (err) {
        setText("apply-log", humanApiError(err));
      });
  }

  function bind() {
    var submit = el("btn-submit");
    var applyAll = el("btn-apply-all");
    var exportBtn = el("btn-export");
    var hunks = el("hunk-list");
    if (submit) {
      submit.addEventListener("click", onSubmit);
    }
    if (applyAll) {
      applyAll.addEventListener("click", onApplyAll);
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", onExport);
    }
    if (hunks) {
      hunks.addEventListener("click", onHunkClick);
    }
  }

  function boot() {
    bind();
    setText("standard-line", "正在用：" + (CONFIG.standardName || "本所标准"));
    var path = currentDocumentPath();
    setText("doc-path", path || "（这份文档尚未保存到本机，请先另存为 .docx）");
    resumeLatestRequest(path);
  }

  /** Word 重开/窗格重载时，接回这份文档上最近一次的请求（不必再点一次「审这份」）。 */
  function resumeLatestRequest(path) {
    if (!path) {
      return;
    }
    api("/api/word-addin/reviews?path=" + encodeURIComponent(path))
      .then(function (body) {
        var items = (body && body.items) || [];
        if (items.length === 0) {
          return;
        }
        // 该看哪一条由引擎侧决定（有结果先给结果）；插件只负责显示。
        var pick = body.picked || items[0];
        renderRequest(pick);
        renderThread(items, pick.id);
        if (pick.state === "queued" || pick.state === "running") {
          startPolling();
          return;
        }
        // 只有仍在推进的才算「在跑」；被折叠的重复点击不该吓到律师。
        var active = items.filter(function (i) {
          return i.state === "queued" || i.state === "running";
        }).length;
        if (active > 0) {
          setText(
            "review-state",
            "已显示最近一次的结果；这份文档另有 " + active + " 次审查正在桌面端跑。",
          );
        }
      })
      .catch(function () {
        /* 接不回就算了：点「审这份」仍可新建 */
      });
  }

  if (typeof Office !== "undefined" && Office.onReady) {
    Office.onReady(function () {
      boot();
    });
  } else {
    document.addEventListener("DOMContentLoaded", boot);
  }

  // 测试钩子：Word.js 只能在真机跑，这里把纯逻辑露出来给 vitest 的假 Word 驱动，
  // 好让「先 load 再读属性」「多处命中不落改」这类硬约束在 CI 里可回归。
  if (CONFIG.testHook === true) {
    window.LAWMIND_ADDIN_INTERNALS = {
      applyHunksInWord: applyHunksInWord,
      applyHunksInWps: applyHunksInWps,
      pickFromList: function (items) {
        var ready = (items || []).filter(function (i) {
          return i.state === "ready";
        });
        return ready.length > 0 ? ready[0] : (items || [])[0];
      },
      stateLabel: stateLabel,
      // 凭据自愈（401 → 重取 config.js → 重放一次）暴露给 vitest 驱动：
      // 这条路径只能靠假 document / 假 fetch 才测得到，但它正是「重启后窗格不瘫」的保证。
      api: api,
      refreshAddinConfig: refreshAddinConfig,
      isLoopbackAuthError: isLoopbackAuthError,
      humanApiError: humanApiError,
      configNow: function () {
        return CONFIG;
      },
    };
  }
})();
