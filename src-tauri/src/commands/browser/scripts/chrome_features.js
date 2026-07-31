// ── FIND IN PAGE ─────────────────────────────────────────────────
(function() {
  function reportFindResult(active, total) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("browser_find_callback", {
          activeMatch: active,
          totalMatches: total,
          finalUpdate: true
        }).catch(function() {});
      }
    } catch (e) {}
  }

  function clearFind() {
    var marks = document.querySelectorAll("mark.zynlex-find-hit");
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
    }
    if (document.body) document.body.normalize();
  }

  function findAll(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.nodeName ? p.nodeName.toLowerCase() : "";
        if (tag === "script" || tag === "style" || tag === "noscript") {
          return NodeFilter.FILTER_REJECT;
        }
        if (p.closest && p.closest("mark.zynlex-find-hit")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!node.nodeValue || node.nodeValue.toLowerCase().indexOf(query) === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue;
      var lt = t.toLowerCase();
      var idx = 0;
      while ((idx = lt.indexOf(q, idx)) !== -1) {
        results.push({ node: n, offset: idx, length: query.length });
        idx += q.length;
      }
    }
    return results;
  }

  function highlightMatches(matches) {
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var range = document.createRange();
      try {
        range.setStart(m.node, m.offset);
        range.setEnd(m.node, m.offset + m.length);
        var mark = document.createElement("mark");
        mark.className = "zynlex-find-hit";
        mark.style.backgroundColor = "#fde047";
        mark.style.color = "#000";
        mark.style.padding = "0";
        range.surroundContents(mark);
      } catch (e) {}
    }
  }

  window.__zynlexFind = function(query) {
    clearFind();
    if (!query) {
      window.__zynlexFindState = { query: "", matches: [], currentIndex: -1 };
      reportFindResult(0, 0);
      return;
    }
    var matches = findAll(query);
    highlightMatches(matches);
    var currentIndex = matches.length > 0 ? 0 : -1;
    window.__zynlexFindState = {
      query: query,
      matches: matches,
      currentIndex: currentIndex
    };
    if (currentIndex >= 0) {
      scrollToCurrent();
    }
    reportFindResult(currentIndex >= 0 ? 1 : 0, matches.length);
  };

  window.__zynlexFindNext = function(forward) {
    var s = window.__zynlexFindState;
    if (!s || s.matches.length === 0) {
      if (s && s.query) {
        window.__zynlexFind(s.query);
      }
      return;
    }
    if (forward) {
      s.currentIndex = (s.currentIndex + 1) % s.matches.length;
    } else {
      s.currentIndex = (s.currentIndex - 1 + s.matches.length) % s.matches.length;
    }
    scrollToCurrent();
    reportFindResult(s.currentIndex + 1, s.matches.length);
  };

  window.__zynlexClearFind = function() {
    clearFind();
    window.__zynlexFindState = { query: "", matches: [], currentIndex: -1 };
    reportFindResult(0, 0);
  };

  function scrollToCurrent() {
    var s = window.__zynlexFindState;
    if (!s || s.currentIndex < 0) return;
    var marks = document.querySelectorAll("mark.zynlex-find-hit");
    var active = marks[s.currentIndex];
    if (active) {
      for (var i = 0; i < marks.length; i++) {
        marks[i].style.backgroundColor = "#fde047";
      }
      active.style.backgroundColor = "#f59e0b";
      active.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  document.addEventListener("DOMContentLoaded", function() {
    window.__zynlexFindState = { query: "", matches: [], currentIndex: -1 };
  });
})();

// ── BOOKMARK SHORTCUT ────────────────────────────────────────────
(function() {
  function isEditableTarget(t) {
    if (!t) return false;
    var tag = (t.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (t.isContentEditable) return true;
    return false;
  }

  function onKeyDown(e) {
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.shiftKey || e.altKey) return;
    if (e.key !== "d" && e.key !== "D") return;
    if (isEditableTarget(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();

    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke("browser_bookmark_request")
          .catch(function() {});
      }
    } catch (err) {}
  }

  if (!window.__zynlexBookmarkReady) {
    window.__zynlexBookmarkReady = true;
    document.addEventListener("keydown", onKeyDown, true);
  }
})();
