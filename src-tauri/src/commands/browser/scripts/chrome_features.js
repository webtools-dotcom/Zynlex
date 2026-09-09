// ── FIND IN PAGE ─────────────────────────────────────────────────
// Every entry point returns {activeMatch, totalMatches}. Rust reads that return
// value through ExecuteScript (see find.rs) — the page has no way to call back
// into the app, so nothing here reports results by invoking IPC.
(function() {
  function result(active, total) {
    return { activeMatch: active, totalMatches: total };
  }

  function clearFind() {
    var marks = document.querySelectorAll("mark.zynlex-find-hit");
    // Normalize only the parents we actually touched. document.body.normalize()
    // merges every adjacent text node in the document, which is enough to break
    // DOM diffing on framework-rendered pages.
    var parents = [];
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      if (parents.indexOf(parent) === -1) parents.push(parent);
    }
    for (var p = 0; p < parents.length; p++) {
      parents[p].normalize();
    }
  }

  function findAll(query) {
    if (!query) return [];
    var q = query.toLowerCase();
    var results = [];
    if (!document.body) return results;
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
        if (!node.nodeValue || node.nodeValue.toLowerCase().indexOf(q) === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      var lt = n.nodeValue.toLowerCase();
      var idx = 0;
      while ((idx = lt.indexOf(q, idx)) !== -1) {
        results.push({ node: n, offset: idx, length: query.length });
        idx += q.length;
      }
    }
    return results;
  }

  // Wraps back-to-front on purpose. surroundContents() splits the text node it
  // operates on, so wrapping match 1 first leaves match 2's offset pointing past
  // the end of a now-truncated node — setStart throws and the match is lost.
  // Wrapping the last match first leaves every earlier offset untouched, so all
  // matches survive and the resulting <mark> elements stay in document order,
  // which is what scrollToCurrent()'s index into querySelectorAll relies on.
  function highlightMatches(matches) {
    for (var i = matches.length - 1; i >= 0; i--) {
      var m = matches[i];
      try {
        var range = document.createRange();
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

  window.__zynlexFind = function(query) {
    clearFind();
    if (!query) {
      window.__zynlexFindState = { query: "", matches: [], currentIndex: -1 };
      return result(0, 0);
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
    return result(currentIndex >= 0 ? 1 : 0, matches.length);
  };

  window.__zynlexFindNext = function(forward) {
    var s = window.__zynlexFindState;
    if (!s || s.matches.length === 0) {
      if (s && s.query) {
        return window.__zynlexFind(s.query);
      }
      return result(0, 0);
    }
    if (forward) {
      s.currentIndex = (s.currentIndex + 1) % s.matches.length;
    } else {
      s.currentIndex = (s.currentIndex - 1 + s.matches.length) % s.matches.length;
    }
    scrollToCurrent();
    return result(s.currentIndex + 1, s.matches.length);
  };

  window.__zynlexClearFind = function() {
    clearFind();
    window.__zynlexFindState = { query: "", matches: [], currentIndex: -1 };
    return result(0, 0);
  };

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
