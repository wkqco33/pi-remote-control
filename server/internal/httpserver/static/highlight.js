(function (global) {
  "use strict";

  // A small tokenizer for comments, strings, numbers, and keywords. It is not a
  // parser: it only has to make code easier to scan. Like the Markdown renderer,
  // it escapes all source text.

  // Replies are rendered again on every streamed frame, so large blocks stay plain.
  const MAX_LENGTH = 50000;

  const SLASH_COMMENT = String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`;
  const HASH_COMMENT = String.raw`(?<![^\s;(])#[^\n]*`;
  const QUOTED = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'`;
  const TEMPLATE = String.raw`${"`"}(?:\\[\s\S]|[^${"`"}\\])*${"`"}`;
  const TRIPLE = String.raw`"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)`;
  const NUMBER = String.raw`\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b`;

  function language(comment, string, keywords) {
    const parts = [
      comment && `(?<comment>${comment})`,
      `(?<string>${string})`,
      `(?<number>${NUMBER})`,
      `(?<keyword>\\b(?:${keywords.split(" ").join("|")})\\b)`,
    ];
    return new RegExp(parts.filter(Boolean).join("|"), "g");
  }

  const LANGUAGES = {
    javascript: language(SLASH_COMMENT, `${QUOTED}|${TEMPLATE}`,
      "abstract as async await break case catch class const continue default delete do else enum export extends " +
      "false finally for from function if implements import in instanceof interface let new null of private " +
      "protected public readonly return static super switch this throw true try type typeof undefined var void " +
      "while yield"),
    go: language(SLASH_COMMENT, `${QUOTED}|${TEMPLATE}`,
      "break case chan const continue default defer else fallthrough false for func go goto if import interface " +
      "map nil package range return select struct switch true type var"),
    c: language(SLASH_COMMENT, QUOTED,
      "abstract async auto await bool break case catch char class const constexpr continue default delete do " +
      "double else enum explicit extends extern false final float fn for friend if impl implements import inline " +
      "int let long match mod mut namespace new null nullptr override private protected pub public return short " +
      "signed sizeof static struct super switch template this throw trait true try typedef typename union " +
      "unsigned use using var virtual void volatile while"),
    python: language(HASH_COMMENT, `${TRIPLE}|${QUOTED}`,
      "False None True and as assert async await break class continue def del elif else except finally for from " +
      "global if import in is lambda match nonlocal not or pass raise return try while with yield"),
    shell: language(HASH_COMMENT, QUOTED,
      "case do done elif else esac exit export fi for function if in local return select then until while"),
    data: language(HASH_COMMENT, QUOTED, "true false null yes no on off"),
    json: language("", QUOTED, "true false null"),
  };

  const ALIASES = {
    js: "javascript", jsx: "javascript", ts: "javascript", tsx: "javascript", mjs: "javascript",
    typescript: "javascript", golang: "go", "c++": "c", cpp: "c", cc: "c", h: "c", hpp: "c", java: "c",
    rust: "c", rs: "c", dart: "c", py: "python", sh: "shell", bash: "shell", zsh: "shell",
    yaml: "data", yml: "data", toml: "data", jsonc: "javascript",
  };

  const { escapeHtml } = global.PiHtml;
  const span = (type, text) => `<span class="tok-${type}">${escapeHtml(text)}</span>`;

  function highlightDiff(code) {
    return code.split("\n").map((line) => {
      if (/^(?:\+\+\+|---|@@|diff |index )/.test(line)) return span("comment", line);
      if (line.startsWith("+")) return span("added", line);
      if (line.startsWith("-")) return span("removed", line);
      return escapeHtml(line);
    }).join("\n");
  }

  function highlight(code, lang) {
    const name = String(lang || "").toLowerCase();
    if (code.length > MAX_LENGTH) return escapeHtml(code);
    if (name === "diff" || name === "patch") return highlightDiff(code);
    const key = Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
    if (!Object.hasOwn(LANGUAGES, key)) return escapeHtml(code);

    let html = "";
    let end = 0;
    for (const match of code.matchAll(LANGUAGES[key])) {
      const type = Object.keys(match.groups).find((group) => match.groups[group] !== undefined);
      html += escapeHtml(code.slice(end, match.index)) + span(type, match[0]);
      end = match.index + match[0].length;
    }
    return html + escapeHtml(code.slice(end));
  }

  global.PiHighlight = { highlight };
})(window);
