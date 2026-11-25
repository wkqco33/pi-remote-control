"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness");

const { highlight } = load("html.js", "highlight.js").window.PiHighlight;
const span = (type, text) => `<span class="tok-${type}">${text}</span>`;

test("marks keywords, strings, numbers, and comments", () => {
  assert.equal(highlight('const a = "if" + 1; // new', "TS"),
    `${span("keyword", "const")} a = ${span("string", "&quot;if&quot;")} + ${span("number", "1")}; ${span("comment", "// new")}`);
  assert.equal(highlight("echo $# a#b # c", "bash"), `echo $# a#b ${span("comment", "# c")}`);
  assert.equal(highlight('x = """\n# s\n""" # c', "py"),
    `x = ${span("string", "&quot;&quot;&quot;\n# s\n&quot;&quot;&quot;")} ${span("comment", "# c")}`);
});

test("marks diff lines", () => {
  assert.equal(highlight("@@ -1 @@\n-a\n+b\n c", "diff"),
    `${span("comment", "@@ -1 @@")}\n${span("removed", "-a")}\n${span("added", "+b")}\n c`);
});

test("escapes unknown, inherited, and oversized input", () => {
  assert.equal(highlight("<b>", "constructor"), "&lt;b&gt;");
  assert.equal(highlight("<b>", "__proto__"), "&lt;b&gt;");
  assert.equal(highlight('"<img>" <i>', "js"), `${span("string", "&quot;&lt;img&gt;&quot;")} &lt;i&gt;`);
  const large = "if ".repeat(20000);
  assert.equal(highlight(large, "js"), large);
});
