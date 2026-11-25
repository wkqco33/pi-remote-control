"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

// ws.js needs browser networking globals, so it gets its own small sandbox.
function setup() {
  const sockets = [];
  const timers = [];
  class FakeSocket {
    static OPEN = 1;
    constructor(url) {
      Object.assign(this, { url, readyState: 1, sent: [], handlers: {} });
      sockets.push(this);
    }
    addEventListener(type, handler) { this.handlers[type] = handler; }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() {}
    receive(env) { this.handlers.message({ data: typeof env === "string" ? env : JSON.stringify(env) }); }
  }
  const window = {};
  const context = vm.createContext({
    window,
    WebSocket: FakeSocket,
    location: { protocol: "https:", host: "relay" },
    setTimeout: (run, delay) => timers.push({ run, delay }),
    clearTimeout: () => {},
  });
  const file = join(__dirname, "..", "internal", "httpserver", "static", "ws.js");
  vm.runInContext(readFileSync(file, "utf8"), context, { filename: "ws.js" });
  const statuses = [];
  const seen = [];
  const client = new window.PiRelayClient({
    clientId: "tab",
    onStatus: (status) => statuses.push(status),
    onEnvelope: (env) => seen.push(env),
  });
  client.connect();
  return { client, sockets, timers, statuses, seen };
}

const welcome = { type: "client.welcome", payload: { clientId: "relay-id", sessions: [] } };

test("says hello and passes on sessions that arrive before the welcome", () => {
  const { client, sockets: [socket], seen, statuses } = setup();
  assert.equal(socket.url, "wss://relay/ws/client");
  socket.handlers.open();
  assert.deepEqual(socket.sent, [{ type: "client.hello", payload: { clientId: "tab" } }]);
  socket.receive("not json");
  socket.receive({ type: "sessions.update", payload: { sessions: ["early"] } });
  assert.equal(seen.length, 0);
  socket.receive(structuredClone(welcome));
  assert.deepEqual(Array.from(seen[0].payload.sessions), ["early"]);
  assert.equal(client.ready, true);
  assert.deepEqual(statuses, ["connecting", "connected"]);
});

test("drops replayed events and resumes from a private history snapshot", () => {
  const { client, sockets: [socket], seen } = setup();
  socket.receive(welcome);
  client.subscribe("s");
  const deliver = (seq, extra = {}) => socket.receive({ type: "stream.delta", sessionId: "s", seq, ...extra });
  deliver(5);
  deliver(5);
  deliver(4);
  deliver(0);
  socket.receive({ type: "history.snapshot", sessionId: "s", seq: 2, clientId: "relay-id" });
  deliver(3);
  assert.deepEqual(seen.slice(1).map((env) => env.seq), [5, 0, 2, 3]);
  assert.equal(client.subscriptions.get("s"), 3);
});

test("reports an unauthorized hello without reconnecting", () => {
  const { sockets: [socket], statuses, timers } = setup();
  socket.receive({ type: "error", payload: { code: "unauthorized" } });
  socket.handlers.close();
  assert.deepEqual(statuses, ["connecting", "unauthorized"]);
  assert.equal(timers.length, 0);
});

test("backs off, ignores stale sockets, and restores subscriptions", () => {
  const { client, sockets, timers, seen } = setup();
  sockets[0].receive(welcome);
  client.subscribe("s");
  sockets[0].handlers.close();
  timers[0].run();
  sockets[1].handlers.close();
  assert.deepEqual(timers.map((timer) => timer.delay), [1000, 2000]);
  timers[1].run();
  sockets[0].receive({ type: "stream.delta", sessionId: "s", seq: 9 });
  assert.equal(seen.length, 1);
  sockets[2].receive(welcome);
  assert.deepEqual(sockets[2].sent.map((env) => [env.type, env.sessionId]), [["session.subscribe", "s"]]);
});
