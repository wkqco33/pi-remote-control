(function (global) {
  "use strict";

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(line) {
    let out = escapeHtml(line);
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return out;
  }

  function renderMarkdown(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let inCode = false;
    let codeLang = "";
    let codeLines = [];
    let inList = false;

    function flushList() {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    }

    for (const line of lines) {
      const fence = line.match(/^```(.*)$/);
      if (fence) {
        flushList();
        if (!inCode) {
          inCode = true;
          codeLang = fence[1].trim();
          codeLines = [];
        } else {
          const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
          html.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          inCode = false;
          codeLang = "";
          codeLines = [];
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        flushList();
        continue;
      }
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }
      const listItem = line.match(/^[-*]\s+(.*)$/);
      if (listItem) {
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${renderInline(listItem[1])}</li>`);
        continue;
      }
      flushList();
      html.push(`<p>${renderInline(line)}</p>`);
    }

    if (inCode) {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    }
    flushList();
    return html.join("");
  }

  global.PiMarkdown = { render: renderMarkdown, escapeHtml };
})(window);
