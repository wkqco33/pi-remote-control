"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness.js");

function setup() {
  const page = load("conversation.js");
  const view = { thread: page.element("div") };
  const apply = (type, payload) => page.window.PiConversation.applyEvent(view, { type, payload });
  // One line per timeline entry, in display order.
  const timeline = () => view.thread.children.map((node) =>
    node.classList.contains("tool-group") ?
      `[${node.firstElementChild.textContent}]` :
      node.querySelector(".markdown-body").innerHTML);
  return { ...page, view, apply, timeline };
}

const text = (delta) => ({ kind: "text", delta });
const tool = (toolCallId, extra = {}) => ({ toolCallId, toolName: "bash", ...extra });

test("places the reply after the tool calls that preceded it", () => {
  const { apply, timeline, flushFrames } = setup();
  apply("stream.start", {});
  apply("stream.delta", text("first"));
  apply("tool.start", tool("a"));
  apply("tool.end", tool("a", { isError: false }));
  apply("tool.start", tool("b"));
  apply("tool.end", tool("b", { isError: false }));
  apply("stream.delta", text("fin"));
  apply("stream.delta", text("al"));
  flushFrames();
  apply("stream.end", { text: "final" });
  assert.deepEqual(timeline(), ["first", "[bash ×2 · 2 done]", "final"]);
});

test("adds the final text once, only when the turn showed none", () => {
  const silent = setup();
  silent.apply("stream.start", {});
  silent.apply("stream.end", { text: "answer" });
  assert.deepEqual(silent.timeline(), ["answer"]);

  const endsWithThinking = setup();
  endsWithThinking.apply("stream.start", {});
  endsWithThinking.apply("stream.delta", text("answer"));
  endsWithThinking.apply("tool.start", tool("a"));
  endsWithThinking.apply("stream.delta", { kind: "thinking", delta: "hm" });
  endsWithThinking.apply("stream.end", { text: "answer" });
  assert.deepEqual(endsWithThinking.timeline(), ["answer", "[bash ×1 · 1 running]", ""]);
});

test("opens a tool group that contains a failure", () => {
  const { apply, view } = setup();
  apply("tool.start", tool("a"));
  assert.equal(view.thread.firstElementChild.open, false);
  apply("tool.end", tool("a", { isError: true }));
  assert.equal(view.thread.firstElementChild.open, true);
  assert.equal(view.thread.firstElementChild.firstElementChild.textContent, "bash ×1 · 1 failed");
});

test("restores tool calls from history and completes the running one", () => {
  const { apply, timeline } = setup();
  const item = (toolCallId, status) => ({ role: "tool", text: "bash", toolCallId, status });
  apply("history.snapshot", {
    items: [
      { role: "user", text: "go" },
      item("a", "done"),
      item("b", "interrupted"),
      item("c", "running"),
    ],
  });
  assert.deepEqual(timeline(), ["go", "[bash ×3 · 1 running · 1 done · 1 interrupted]"]);
  apply("tool.start", tool("c"));
  apply("tool.end", tool("c", { isError: false, durationMs: 5 }));
  assert.deepEqual(timeline(), ["go", "[bash ×3 · 2 done · 1 interrupted]"]);
});
