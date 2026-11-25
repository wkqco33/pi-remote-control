"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness.js");

function setup(summary = {}) {
  const { window } = load("approval.js", "notify.js");
  const sent = [];
  const send = (_view, type, payload) => sent.push({ type, ...payload }) > 0;
  const view = { summary, approvals: [], localAuto: false };
  return { approvals: window.PiApproval, notifier: window.PiNotifier, view, send, sent };
}

const request = (requestId, extra = {}) => ({ ts: Date.now(), payload: { requestId, toolName: "bash", ...extra } });

test("queues requests once and drops resolved or expired ones", () => {
  const { approvals, view } = setup();
  approvals.add(view, request("a"));
  approvals.add(view, request("b"));
  approvals.add(view, request("a"));
  approvals.add(view, { ts: Date.now() - 10_000, payload: { requestId: "old", timeoutMs: 5_000 } });
  assert.equal(view.approvals.length, 2);
  assert.equal(approvals.current(view).requestId, "b");
  approvals.resolve(view, "b");
  assert.equal(approvals.current(view).requestId, "a");
});

test("sends the mode to an agent that owns it and never answers for it", () => {
  const { approvals, view, send, sent } = setup({ autoApprove: false });
  approvals.add(view, request("a"));
  approvals.setAuto(view, true, send);
  approvals.answerLegacyAuto(view, send);
  assert.deepEqual(sent, [{ type: "approval.mode", autoApprove: true }]);
  assert.equal(approvals.isAuto(view), false);
});

test("answers in the browser for an older agent", () => {
  const { approvals, view, send, sent } = setup({});
  approvals.add(view, request("a"));
  approvals.setAuto(view, true, send);
  assert.deepEqual(sent, [{ type: "approval.response", requestId: "a", approved: true }]);
  assert.equal(approvals.isAuto(view), true);
  assert.equal(approvals.current(view), null);
});

test("reports only approvals that need the user", () => {
  const { approvals, notifier, view } = setup({ autoApprove: false });
  approvals.add(view, request("a"));
  const auto = { summary: { autoApprove: true }, approvals: [...view.approvals] };
  const found = notifier.waiting([view, auto, { summary: {}, approvals: [] }], approvals);
  assert.deepEqual(Array.from(found, (entry) => entry.request.requestId), ["a"]);
});
