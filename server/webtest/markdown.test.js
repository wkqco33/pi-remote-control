"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness");

const { render } = load("html.js", "highlight.js", "markdown.js").window.PiMarkdown;
const link = (url, label = url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;

test("renders headings, rules, and paragraphs with soft breaks", () => {
  assert.equal(render("# One\n###### Six ##"), "<h1>One</h1><h6>Six</h6>");
  assert.equal(render("a\nb\n\nc\n---"), "<p>a<br>b</p><p>c</p><hr>");
  assert.equal(render("* * *"), "<hr>");
});

test("renders ordered, unordered, nested, and task lists", () => {
  assert.equal(render("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  assert.equal(render("3) c\n\n4) d"), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(render("- a\n  - b\n    1. c\n+ d"),
    "<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>");
  assert.equal(render("- [ ] todo\n- [x] done"), "<ul><li>☐ todo</li><li>☑ done</li></ul>");
  assert.equal(render("text:\n- a\n\nafter"), "<p>text:</p><ul><li>a</li></ul><p>after</p>");
  assert.equal(render("in\n2026. done"), "<p>in<br>2026. done</p>");
});

test("renders fenced code, including indented and unclosed fences", () => {
  assert.equal(render("```text\na **b**\n\n```"), '<pre><code class="language-text">a **b**\n</code></pre>');
  assert.equal(render("1. run\n\n   ```\n   ls\n     -l\n   ```\n2. next"),
    "<ol><li>run<pre><code>ls\n  -l</code></pre></li><li>next</li></ol>");
  assert.equal(render("````\n```\n````"), "<pre><code>```</code></pre>");
  assert.equal(render("~~~\nstreaming"), "<pre><code>streaming</code></pre>");
});

test("renders tables with alignment classes", () => {
  assert.equal(render("| a | b | c |\n|:--|:-:|--:|\n| 1 | `x\\|y` |"),
    '<div class="md-table"><table><thead><tr><th>a</th><th class="align-center">b</th>' +
    '<th class="align-right">c</th></tr></thead><tbody><tr><td>1</td>' +
    '<td class="align-center"><code>x|y</code></td><td class="align-right"></td></tr></tbody></table></div>');
  assert.equal(render("a | b\nplain"), "<p>a | b<br>plain</p>");
});

test("renders quotes recursively", () => {
  assert.equal(render("> a\n> - b"), "<blockquote><p>a</p><ul><li>b</li></ul></blockquote>");
});

test("renders inline styles without touching identifiers or code", () => {
  assert.equal(render("**b** *i* __b__ _i_ ~~d~~"),
    "<p><strong>b</strong> <em>i</em> <strong>b</strong> <em>i</em> <del>d</del></p>");
  assert.equal(render("snake_case_name 2 * 3 * 4"), "<p>snake_case_name 2 * 3 * 4</p>");
  assert.equal(render("`**a** <b>` ``x`y``"), "<p><code>**a** &lt;b&gt;</code> <code>x`y</code></p>");
});

test("renders safe links without styling their URLs", () => {
  const url = "https://example.com/a_b_c";
  assert.equal(render(`[**t**](${url})`), `<p>${link(url, "<strong>t</strong>")}</p>`);
  assert.equal(render(`see ${url}. <${url}>`), `<p>see ${link(url)}. ${link(url)}</p>`);
  assert.equal(render(`![pic](${url})`), `<p>${link(url, "pic")}</p>`);
  assert.equal(render("[w](https://e.com/a_(b))"), `<p>${link("https://e.com/a_(b)", "w")}</p>`);
});

test("never emits markup from the source", () => {
  assert.equal(render("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "/relative"]) {
    assert.doesNotMatch(render(`[x](${url})`), /<a /);
  }
  assert.match(render('[x](https://e.com/"onmouseover="y)'), /href="https:\/\/e\.com\/&quot;onmouseover=&quot;y"/);
  assert.equal(render('```a"><img>\n```'), '<pre><code class="language-a&quot;&gt;&lt;img&gt;"></code></pre>');
  assert.equal(render("\u00000\u0000"), "<p>0</p>");
});

test("bounds recursion on deeply nested input", () => {
  assert.doesNotThrow(() => render(`${">".repeat(20000)} x`));
});

test("renders blocks that open on a list marker line", () => {
  assert.equal(render("- ```\n  ls\n  ```\n- b"), "<ul><li><pre><code>ls</code></pre></li><li>b</li></ul>");
  assert.equal(render("1. > q"), "<ol><li><blockquote><p>q</p></blockquote></li></ol>");
});

test("keeps display math verbatim", () => {
  assert.equal(render("$$a_i * b * c$$\n*x*"), '<pre class="math"><code>$$a_i * b * c$$</code></pre><p><em>x</em></p>');
  assert.equal(render("$$\n<x> **y**\n$$"), '<pre class="math"><code>$$\n&lt;x&gt; **y**\n$$</code></pre>');
});

test("treats text that merely starts with $$ as a paragraph", () => {
  assert.equal(render("$$ is the PID\nnext"), "<p>$$ is the PID<br>next</p>");
});

test("numbers footnotes by citation and leaves unknown labels alone", () => {
  assert.equal(render("a[^y] b[^x] [^none]\n\n[^x]: ex\n[^y]: *why*"),
    '<p>a<sup>[1]</sup> b<sup>[2]</sup> [^none]</p><ol class="footnotes"><li><em>why</em></li><li>ex</li></ol>');
  assert.equal(render("```\n[^a]: code\n```"), "<pre><code>[^a]: code</code></pre>");
});
