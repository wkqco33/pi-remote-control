"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./harness");

const sessionView = load("session-view.js").window.PiSessionView;
const summary = (extra = {}) => ({ sessionId: "s", connectedAt: 1, requirePairing: true, ...extra });
const paired = () => {
  const view = sessionView.create(summary(), null);
  sessionView.applyHistory(view, { paired: true });
  return view;
};

test("keeps what it learned until the agent reconnects", () => {
  const view = paired();
  Object.assign(view, { approvals: [1], digest: "d", digestOpen: true, draft: "text" });
  assert.equal(sessionView.updateSummary(view, summary({ state: "busy" })), false);
  assert.equal(view.paired, true);
  assert.equal(sessionView.updateSummary(view, summary({ connectedAt: 2 })), true);
  assert.deepEqual(
    [view.paired, view.approvals.length, view.digest, view.digestOpen, view.loading, view.draft],
    [undefined, 0, "", false, true, "text"]);
  assert.equal(sessionView.updateSummary(view, undefined), true);
  assert.equal(view.loading, false);
});

test("controls a session only when it is ready and trusted", () => {
  const view = sessionView.create(summary(), null);
  assert.equal(sessionView.isControllable(view, true), false);
  sessionView.applyHistory(view, {});
  assert.equal(view.paired, false);
  sessionView.applyPairStatus(view, { paired: true });
  assert.equal(sessionView.isControllable(view, true), true);
  assert.equal(sessionView.isControllable(view, false), false);

  const open = sessionView.create(summary({ requirePairing: false }), null);
  sessionView.applyHistory(open, {});
  assert.equal(sessionView.isControllable(open, true), true);
});

test("validates a pairing code before sending it", () => {
  const view = sessionView.create(summary(), null);
  const sent = [];
  const send = (code) => sent.push(code);
  assert.equal(sessionView.submitPairCode(view, "123456", send, 0), false);
  sessionView.applyPairRequired(view, { digits: 6, expiresAt: 10 });
  assert.equal(sessionView.submitPairCode(view, "12", send, 0), true);
  assert.equal(view.pairError, "Enter all 6 digits from the pi terminal.");
  assert.equal(sessionView.submitPairCode(view, "123-456", () => false, 0), true);
  assert.equal(view.awaitingPair, false);
  sessionView.submitPairCode(view, "123 456", send, 0);
  assert.deepEqual([sent, view.awaitingPair, view.pairError], [["123456"], true, ""]);
  assert.equal(sessionView.submitPairCode(view, "123456", send, 0), false);
  view.awaitingPair = false;
  assert.equal(sessionView.submitPairCode(view, "123456", send, 10), false);
});

test("keeps the challenge only after a mismatched code", () => {
  const view = sessionView.create(summary(), null);
  sessionView.applyPairRequired(view, { digits: 6, expiresAt: 10 });
  sessionView.applyPairResult(view, { ok: false, error: "mismatch" });
  assert.match(view.pairError, /did not match/);
  assert.ok(view.challenge);
  sessionView.applyPairResult(view, { ok: false, error: "expired" });
  assert.equal(view.challenge, null);
  sessionView.applyPairResult(view, { ok: true });
  assert.deepEqual([view.paired, view.pairError], [true, ""]);
});

test("describes pairing, session, and empty states", () => {
  assert.equal(sessionView.pairingPrompt(null).codeValid, false);
  assert.match(sessionView.pairingPrompt({ digits: 6, expiresAt: 5 }, 5).text, /expired/);
  assert.equal(sessionView.pairingPrompt({ digits: 6, expiresAt: 5 }, 4).codeValid, true);
  assert.equal(sessionView.subtitle({ host: "h", cwd: "/w", extensionVersion: "1" }), "h · /w · ext 1");

  const title = (state) => sessionView.emptyState({ ready: true, connection: "connected", ...state }).title;
  assert.equal(title({ ready: false, connection: "unauthorized" }), "Connect to the relay");
  assert.equal(title({ ready: false, connection: "disconnected" }), "Connecting to the relay");
  assert.equal(title({ view: null }), "No sessions online");
  assert.equal(title({ view: { loading: false } }), "Session offline");
  assert.equal(title({ view: sessionView.create(summary(), null) }), "Loading conversation");
  assert.equal(title({ view: { ...paired(), paired: false } }), "Pair this session to send a message");
  assert.equal(title({ view: paired() }), "No messages yet");
});
