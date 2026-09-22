/*
 * LawMind Word 插件任务窗格。
 *
 * 只做三件事：
 *   审这份 —— 把当前文档路径交给本机 LawMind，建一条就地审查请求；
 *   取回   —— 轮询同一条请求，拿回桌面端产出的修订轨锚点与产物路径；
 *   改这份 —— 用 Word 原生修订轨把这些锚点落进当前文档（Track Changes 打开）。
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
          CONFIG = next;
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
      return "本机 LawMind 没有接受这个窗格的凭据，自动重连也没成功（可能换了端口或已关闭）。"
        + "请关掉窗格重新打开：插入 → 我的加载项 → LawMind。";
    }
    return String((err && err.message) || err);
  }

  function currentDocumentPath() {
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
        ? "已等 5 分钟仍未有结果：请回 Word 点「刷新状态」看最新进度；若已失败，桌面端会写明原因。"
        : "已等 5 分钟仍未有结果：请在桌面端 LawMind 里跑一次审查，或稍后点「刷新状态」。");
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
      return "桌面端正在审查…";
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

  function renderRequest(request) {
    currentRequest = request;
    if (!request) {
      return;
    }
    currentRequestId = request.id;
    setText("review-state", requestStatusLine(request));
    renderMatterPicker(request);
    var hunks = request.hunks || [];
    var card = el("result-card");
    if (request.state !== "ready" || hunks.length === 0) {
      if (card) {
        card.hidden = request.state !== "ready";
      }
      if (request.state === "ready" && hunks.length === 0) {
        setText(
          "result-summary",
          "桌面端结论没有可就地落改的最短锚点"
            + (request.skippedSectionHunks ? "（另有 " + request.skippedSectionHunks + " 处整节重写，请回桌面端看）" : "")
            + "。可点「导出产物」。",
        );
      }
      return;
    }
    if (card) {
      card.hidden = false;
    }
    setText(
      "result-summary",
      (request.summary ? request.summary + "；" : "")
        + "共 " + hunks.length + " 处锚点"
        + (request.skippedSectionHunks ? "，另有 " + request.skippedSectionHunks + " 处整节重写请回桌面端看" : "")
        + (request.outputPath ? "；产物：" + request.outputPath : ""),
    );
    var list = el("hunk-list");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    hunks.forEach(function (hunk) {
      var li = document.createElement("li");
      li.className = "hunk";
      var before = document.createElement("p");
      before.className = "hunk__before";
      before.textContent = "- " + hunk.find;
      var after = document.createElement("p");
      after.className = "hunk__after";
      after.textContent = "+ " + hunk.replace;
      li.appendChild(before);
      li.appendChild(after);
      if (hunk.note) {
        var note = document.createElement("p");
        note.className = "hunk__note";
        note.textContent = hunk.note;
        li.appendChild(note);
      }
      list.appendChild(li);
    });
  }

  var mattersCache = null;

  /** 案卷列表只在需要时拉一次并缓存（律师一般只选一次）。 */
  function loadMatters() {
    if (mattersCache) {
      return Promise.resolve(mattersCache);
    }
    return api("/api/word-addin/matters").then(function (body) {
      mattersCache = (body && body.items) || [];
      return mattersCache;
    });
  }

  function hideMatterPicker() {
    var card = el("matter-card");
    if (card) {
      card.hidden = true;
    }
  }

  function renderMatterPicker(request) {
    // 只在「这次没挂案卷」时露一个**可选**入口（审查已经在跑了，不阻断）。
    if (!request || request.matterId || request.state !== "queued") {
      hideMatterPicker();
      return;
    }
    var card = el("matter-card");
    var select = el("matter-select");
    if (!card || !select) {
      return;
    }
    setText(
      "matter-note",
      "这次会直接出修订稿，不必先选案卷。若想把这次改稿归档到某个案卷，可在下面选（可选）。",
    );
    loadMatters()
      .then(function (items) {
        var rows = items;
        select.innerHTML = "";
        rows.forEach(function (it) {
          var opt = document.createElement("option");
          opt.value = it.matterId;
          opt.textContent = it.title ? it.title + "（" + it.matterId + "）" : it.matterId;
          select.appendChild(opt);
        });
        if (rows.length === 0) {
          hideMatterPicker();
          return;
        }
        card.hidden = false;
      })
      .catch(function () {
        hideMatterPicker();
      });
  }

  function onMatterPick() {
    if (!currentRequestId) {
      return;
    }
    var select = el("matter-select");
    var matterId = select ? select.value : "";
    if (!matterId) {
      setText("matter-note", "请先选一个案卷。");
      return;
    }
    setText("matter-note", "正在归档…");
    api("/api/word-addin/reviews/" + encodeURIComponent(currentRequestId) + "/matter", {
      method: "POST",
      body: JSON.stringify({ matterId: matterId }),
    })
      .then(function (body) {
        hideMatterPicker();
        renderRequest(body.request);
      })
      .catch(function (err) {
        setText("matter-note", humanApiError(err));
      });
  }

  function onReview() {
    var path = currentDocumentPath();
    if (!path) {
      setText("review-state", "这份文档还没有本机路径（未保存）。请先另存为 .docx。");
      return;
    }
    setText("review-state", "正在交给桌面端…");
    api("/api/word-addin/reviews", {
      method: "POST",
      body: JSON.stringify({ path: path }),
    })
      .then(function (body) {
        renderRequest(body.request);
        startPolling();
      })
      .catch(function (err) {
        setText("review-state", humanApiError(err));
      });
  }

  function onRefresh() {
    if (!currentRequestId) {
      setText("review-state", "还没有发起过审查。");
      return;
    }
    api("/api/word-addin/reviews/" + encodeURIComponent(currentRequestId))
      .then(function (body) {
        renderRequest(body.request);
      })
      .catch(function (err) {
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
            results.items[0].insertText(hunk.replace, replaceLocation);
            applied += 1;
            return context.sync();
          });
        });
      }, Promise.resolve())
      .then(function () {
        return { applied: applied, missed: missed };
      });
  }

  function onApply() {
    if (!currentRequest || !currentRequest.hunks || currentRequest.hunks.length === 0) {
      setText("apply-log", "没有可落改的锚点。");
      return;
    }
    setText("apply-log", "正在写入 Word 修订轨…");
    applyHunksInWord(currentRequest.hunks)
      .then(function (result) {
        setText(
          "apply-log",
          "已落 " + result.applied + " 处"
            + (result.missed.length ? "；" + result.missed.length + " 处未落（锚点找不到或多处命中）：" + result.missed.join("；") : "")
            + "。请复核修订轨后再决定接受。",
        );
      })
      .catch(function (err) {
        setText("apply-log", "落改失败：" + String(err.message || err));
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
    var review = el("btn-review");
    var refresh = el("btn-refresh");
    var apply = el("btn-apply");
    var exportBtn = el("btn-export");
    if (review) {
      review.addEventListener("click", onReview);
    }
    if (refresh) {
      refresh.addEventListener("click", onRefresh);
    }
    if (apply) {
      apply.addEventListener("click", onApply);
    }
    var matterBtn = el("btn-matter");
    if (matterBtn) {
      matterBtn.addEventListener("click", onMatterPick);
    }
    if (exportBtn) {
      exportBtn.addEventListener("click", onExport);
    }
  }

  function boot() {
    bind();
    setText("engine-line", "本机 LawMind：" + CONFIG.base);
    setText(
      "engine-note",
      AUTO_RUN
        ? "插件只与本机回环地址上的 LawMind 服务通信，不连任何远程控制面。点「审这份」后桌面端会自动开跑；跑完结果自动回到这里，直接落成 Word 原生修订轨。"
        : "插件只与本机回环地址上的 LawMind 服务通信，不连任何远程控制面。这台机器设成「需在桌面端确认」：点「审这份」会登记请求，请在 LawMind 桌面端对同一份文件跑一次审查，结果会自动回到这里。",
    );
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
