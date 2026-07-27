(function() {
  function xevoRenderJson() {
    try {
      var ct = (document.contentType || "").toLowerCase();
      var isJsonPage = false;
      if (ct.indexOf("application/json") !== -1 || ct.indexOf("text/json") !== -1) {
        isJsonPage = true;
      } else if (ct === "text/html" || ct === "") {
        var headChildren = (document.head && document.head.children) ? document.head.children.length : 0;
        if (headChildren > 0) {
          return;
        }
        var text = (document.body && document.body.innerText) ? document.body.innerText.trim() : "";
        if (text.charAt(0) === "{" || text.charAt(0) === "[") {
          try { JSON.parse(text); isJsonPage = true; }
          catch (e) { isJsonPage = false; }
        }
      }
      if (!isJsonPage) return;

      var raw = (document.body && document.body.innerText) ? document.body.innerText : "";
      var parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { return; }

      function esc(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function escAttr(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      }
      function renderValue(val, depth) {
        if (val === null) return 'null';
        if (typeof val === "boolean") return String(val);
        if (typeof val === "number") return String(val);
        if (typeof val === "string") {
          var s = esc(val);
          if (/^https?:\/\//i.test(val)) {
            return '<a href="' + escAttr(val) + '">"' + s + '"</a>';
          }
          return '"' + s + '"';
        }
        if (Array.isArray(val)) {
          if (val.length === 0) return '[]';
          if (depth > 8) return '[deep array]';
          var openTag = depth < 1 ? ' open' : '';
          var max = Math.min(val.length, 500);
          var out = '<details' + openTag + '><summary><span class="xj-toggle">\u25BE</span>[</summary>';
          for (var i = 0; i < max; i++) {
            out += '\n' + '  '.repeat(depth) + renderValue(val[i], depth + 1);
            if (i < val.length - 1) out += ',';
          }
          if (val.length > 500) {
            out += '\n' + '  '.repeat(depth) + '...' + (val.length - 500) + ' more items';
          }
          out += ']</details>';
          return out;
        }
        if (typeof val === "object") {
          var keys = Object.keys(val);
          if (keys.length === 0) return '{}';
          if (depth > 8) return '{deep object}';
          var openTag2 = depth < 1 ? ' open' : '';
          var max2 = Math.min(keys.length, 500);
          var out2 = '<details' + openTag2 + '><summary><span class="xj-toggle">\u25BE</span>{</summary>';
          for (var j = 0; j < max2; j++) {
            out2 += '\n' + '  '.repeat(depth) + '<span class="xj-k">"' + esc(keys[j]) + '"</span>: ' + renderValue(val[keys[j]], depth + 1);
            if (j < keys.length - 1) out2 += ',';
          }
          if (keys.length > 500) {
            out2 += '\n' + '  '.repeat(depth) + '...' + (keys.length - 500) + ' more keys';
          }
          out2 += '}</details>';
          return out2;
        }
        return esc(String(val));
      }

      var css = "body{background:#0f0f0f;color:#e4e4e7;margin:0;padding:0;font-family:'SF Mono','Menlo','Cascadia Code','Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;}"
        + ".xj-header{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-bottom:1px solid #282828;font-size:11px;gap:12px;}"
        + ".xj-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}"
        + ".xj-copy{padding:3px 10px;background:#27272a;border:1px solid #3f3f46;border-radius:4px;color:inherit;cursor:pointer;font-size:11px;}"
        + ".xj-copy:hover{color:#fff;border-color:#52525b;}"
        + ".xj-k{color:#93c5fd;}"
        + ".xj-toggle{font-size:10px;margin-right:2px;user-select:none;}"
        + "details{display:inline;}"
        + "details>summary{list-style:none;display:inline;cursor:pointer;}"
        + "details>summary::-webkit-details-marker{display:none;}"
        + "a{color:inherit;}"
        + "pre{margin:0;padding:16px;white-space:pre-wrap;word-break:break-word;}";

      var fullUrl = window.location.href || "";
      var truncatedUrl = fullUrl.length > 80 ? fullUrl.slice(0, 80) + "\u2026" : fullUrl;

      document.head.innerHTML = '<title>JSON \u2014 XEVO</title><style>' + css + '</style>';
      document.body.innerHTML = '<div class="xj-header">'
        + '<span class="xj-path">' + esc(truncatedUrl) + '</span>'
        + '<button class="xj-copy" id="xj-copy-btn">Copy</button>'
        + '</div><pre>' + renderValue(parsed, 0) + '</pre>';

      var btn = document.getElementById("xj-copy-btn");
      if (btn) {
        btn.addEventListener("click", function() {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(raw).then(function() {
              btn.textContent = "Copied!";
              setTimeout(function() { btn.textContent = "Copy"; }, 2000);
            }).catch(function() {});
          }
        });
      }
    } catch (e) {}
  }
  document.addEventListener("DOMContentLoaded", xevoRenderJson);
})();
