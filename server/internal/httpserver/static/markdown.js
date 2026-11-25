(function (global) {
  "use strict";

  // The renderer escapes all source text and emits only the tags written here,
  // so its output is safe to assign to innerHTML. Styling uses classes because
  // the content security policy blocks inline styles.

  const FENCE = /^( *)(`{3,}|~{3,})\s*([^`]*)$/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}>\s?(.*)$/;
  const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
  const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;
  const MAX_DEPTH = 8;

  const MATH_FENCE = /^ {0,3}\$\$(?:.*\$\$)?\s*$/;
  const FOOTNOTE = /^ {0,3}\[\^([^\]\s]+)\]:\s*(.*)$/;

  const { escapeHtml } = global.PiHtml;
  const { highlight } = global.PiHighlight;

  function emphasize(text) {
    return text
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<![\p{L}\p{N}_])__(?=\S)(.+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, "<strong>$1</strong>")
      .replace(/\*(?=[^\s*])([^*]*?)(?<=[^\s*])\*/g, "<em>$1</em>")
      .replace(/(?<![\p{L}\p{N}_])_(?=[^\s_])([^_]*?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, "<em>$1</em>")
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<del>$1</del>");
  }

  // notes maps a footnote label to its definition and, once cited, its number.
  function renderInline(source, notes) {
    // Finished HTML is parked behind a placeholder so that later rules cannot
    // rewrite code spans or URLs.
    const parked = [];
    const park = (html) => `\u0000${parked.push(html) - 1}\u0000`;
    const restore = (text) => text.replace(/\u0000(\d+)\u0000/g, (_, index) => restore(parked[index]));
    const anchor = (url, label) =>
      park(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);

    let text = String(source).replace(/\u0000/g, "");
    text = text.replace(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (_, ticks, code) =>
      park(`<code>${escapeHtml(code.replace(/^ (.*) $/, "$1"))}</code>`));
    text = text.replace(/\[\^([^\]\s]+)\]/g, (match, id) => {
      const note = notes.byId.get(id);
      if (!note) return match;
      if (!note.number) note.number = notes.cited.push(note);
      return park(`<sup>[${note.number}]</sup>`);
    });
    // Images become links: the content security policy blocks remote images.
    text = text.replace(
      /!?\[([^\[\]]*)\]\(\s*((?:[^\s()\u0000]|\([^\s()\u0000]*\))+)(?:\s+"[^"]*")?\s*\)/g,
      (match, label, url) => (SAFE_URL.test(url) ? anchor(url, emphasize(escapeHtml(label || url))) : match));
    text = text.replace(/<((?:https?:\/\/|mailto:)[^\s<>\u0000]+)>/gi, (_, url) => anchor(url, escapeHtml(url)));
    text = text.replace(/\bhttps?:\/\/[^\s<>"'`\u0000]*[^\s<>"'`\u0000.,;:!?)\]*_~]/g,
      (url) => anchor(url, escapeHtml(url)));
    return restore(emphasize(escapeHtml(text)));
  }

  function splitRow(line) {
    const row = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
    return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
  }

  function isTableStart(lines, index) {
    const delimiter = lines[index + 1];
    return lines[index].includes("|") && delimiter !== undefined && delimiter.includes("|") &&
      TABLE_DELIMITER.test(delimiter) && splitRow(lines[index]).length === splitRow(delimiter).length;
  }

  function startsBlock(lines, index) {
    const line = lines[index];
    const item = line.match(LIST_ITEM);
    // As in CommonMark, only a list starting at 1 may interrupt a paragraph.
    return FENCE.test(line) || MATH_FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) ||
      Boolean(item?.[3] && (!/\d/.test(item[2]) || parseInt(item[2], 10) === 1)) || isTableStart(lines, index);
  }

  // An unclosed fence is still code, which keeps streaming replies stable.
  function readFence(lines, start, html) {
    const [, indent, marker, info] = lines[start].match(FENCE);
    const closing = new RegExp(`^ *${marker[0]}{${marker.length},}\\s*$`);
    const strip = new RegExp(`^ {0,${indent.length}}`);
    const code = [];
    let index = start + 1;
    for (; index < lines.length && !closing.test(lines[index]); index += 1) {
      code.push(lines[index].replace(strip, ""));
    }
    const lang = info.trim().split(/\s+/)[0];
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    html.push(`<pre><code${cls}>${highlight(code.join("\n"), lang)}</code></pre>`);
    return index + 1;
  }

  // Display math is not typeset, but its TeX must survive the inline rules.
  function readMath(lines, start, html) {
    let index = start;
    const first = lines[start].trim();
    if (first.length < 4 || !first.endsWith("$$")) {
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("$$")) index += 1;
    }
    const tex = lines.slice(start, index + 1).join("\n").trim();
    html.push(`<pre class="math"><code>${escapeHtml(tex)}</code></pre>`);
    return index + 1;
  }

  function readTable(lines, start, html, notes) {
    const align = splitRow(lines[start + 1]).map((cell) => {
      if (cell.endsWith(":")) return cell.startsWith(":") ? "center" : "right";
      return "";
    });
    const row = (tag, cells) => `<tr>${align.map((side, column) => {
      const cls = side ? ` class="align-${side}"` : "";
      return `<${tag}${cls}>${renderInline(cells[column] || "", notes)}</${tag}>`;
    }).join("")}</tr>`;

    const body = [];
    let index = start + 2;
    for (; index < lines.length && lines[index].trim() && lines[index].includes("|"); index += 1) {
      body.push(row("td", splitRow(lines[index])));
    }
    html.push(`<div class="md-table"><table><thead>${row("th", splitRow(lines[start]))}</thead>` +
      `<tbody>${body.join("")}</tbody></table></div>`);
    return index;
  }

  function readQuote(lines, start, html, depth, notes) {
    const inner = [];
    let index = start;
    for (; index < lines.length && QUOTE.test(lines[index]); index += 1) {
      inner.push(lines[index].match(QUOTE)[1]);
    }
    html.push(`<blockquote>${renderBlocks(inner, depth + 1, notes)}</blockquote>`);
    return index;
  }

  // Each item owns the following lines that are indented past its marker. Those
  // lines are rendered as blocks, which yields nested lists and fenced code.
  function readList(lines, start, html, depth, notes) {
    const first = lines[start].match(LIST_ITEM);
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const sibling = (line) => {
      const match = line?.match(LIST_ITEM);
      return match && !RULE.test(line) && match[1].length === indent && /\d/.test(match[2]) === ordered
        ? match : null;
    };
    const indented = (line) => line.search(/\S/) > indent;

    const items = [];
    let index = start;
    for (let match = sibling(lines[index]); match; match = sibling(lines[index])) {
      const head = match[3] || "";
      const rest = [];
      index += 1;
      while (index < lines.length) {
        if (indented(lines[index])) {
          rest.push(lines[index]);
          index += 1;
          continue;
        }
        if (lines[index].trim()) break;
        // A blank line stays in the list only if the list continues after it.
        let next = index + 1;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (next >= lines.length) break;
        if (indented(lines[next])) rest.push("");
        else if (!sibling(lines[next])) break;
        index = next;
      }
      const margin = Math.min(...rest.filter(Boolean).map((line) => line.search(/\S/)));
      const body = rest.map((line) => line.slice(margin));
      // A block may open on the marker line itself, as in "- ```".
      const opensBlock = FENCE.test(head) || MATH_FENCE.test(head) || QUOTE.test(head) || HEADING.test(head);
      const task = head.match(/^\[([ xX])\]\s+(.*)$/);
      let label = "";
      if (task) label = `${task[1] === " " ? "☐" : "☑"} ${renderInline(task[2], notes)}`;
      else if (!opensBlock) label = renderInline(head, notes);
      const blocks = opensBlock ? [head, ...body] : body;
      const nested = blocks.length ? renderBlocks(blocks, depth + 1, notes) : "";
      items.push(`<li>${label}${nested}</li>`);
    }

    const number = ordered ? parseInt(first[2], 10) : 1;
    const attr = number === 1 ? "" : ` start="${number}"`;
    const tag = ordered ? "ol" : "ul";
    html.push(`<${tag}${attr}>${items.join("")}</${tag}>`);
    return index;
  }

  function renderBlocks(lines, depth, notes) {
    // Bounds recursion on hostile input such as thousands of ">" markers.
    if (depth > MAX_DEPTH) return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    const html = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const heading = line.match(HEADING);
      if (!line.trim()) {
        index += 1;
      } else if (FENCE.test(line)) {
        index = readFence(lines, index, html);
      } else if (MATH_FENCE.test(line)) {
        index = readMath(lines, index, html);
      } else if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2], notes)}</h${level}>`);
        index += 1;
      } else if (RULE.test(line)) {
        html.push("<hr>");
        index += 1;
      } else if (QUOTE.test(line)) {
        index = readQuote(lines, index, html, depth, notes);
      } else if (LIST_ITEM.test(line)) {
        index = readList(lines, index, html, depth, notes);
      } else if (isTableStart(lines, index)) {
        index = readTable(lines, index, html, notes);
      } else {
        const text = [line.trim()];
        for (index += 1; index < lines.length && lines[index].trim() && !startsBlock(lines, index); index += 1) {
          text.push(lines[index].trim());
        }
        html.push(`<p>${text.map((part) => renderInline(part, notes)).join("<br>")}</p>`);
      }
    }
    return html.join("");
  }

  // Takes top-level definitions out of the text; those inside code stay put.
  function extractFootnotes(lines) {
    const byId = new Map();
    const body = [];
    let fence = null;
    for (const line of lines) {
      const marker = line.match(FENCE)?.[2];
      if (!fence && marker) fence = marker;
      else if (fence && line.trim().startsWith(fence) && !line.trim().replaceAll(fence[0], "")) fence = null;
      const note = !fence && line.match(FOOTNOTE);
      if (note) byId.set(note[1], { text: note[2], number: 0 });
      else body.push(line);
    }
    return { body, notes: { byId, cited: [] } };
  }

  // Numbers follow the order of citation. Footnotes are not linked because
  // element ids would collide between messages.
  function renderFootnotes(notes) {
    const items = [];
    // A definition may cite another one, which grows the list while it is read.
    for (let index = 0; index < notes.cited.length; index += 1) {
      items.push(`<li>${renderInline(notes.cited[index].text, notes)}</li>`);
    }
    const uncited = Array.from(notes.byId.values()).filter((note) => !note.number);
    items.push(...uncited.map((note) => `<li>${renderInline(note.text, notes)}</li>`));
    return items.length ? `<ol class="footnotes">${items.join("")}</ol>` : "";
  }

  function renderMarkdown(src) {
    if (!src) return "";
    const lines = String(src).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    const { body, notes } = extractFootnotes(lines);
    return renderBlocks(body, 0, notes) + renderFootnotes(notes);
  }

  global.PiMarkdown = { render: renderMarkdown };
})(window);
