(function (global) {
  "use strict";

  class RelayClient {
    constructor({ clientId, onStatus, onEnvelope }) {
      this.clientId = clientId;
      this.onStatus = onStatus;
      this.onEnvelope = onEnvelope;
      this.ws = null;
      this.ready = false;
      this.restoring = false;
      this.attempt = 0;
      this.reconnectTimer = null;
      this.subscriptions = new Map();
    }

    connect() {
      this.close();
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      this.onStatus("connecting");
      const ws = new WebSocket(`${proto}//${location.host}/ws/client`);
      this.ws = ws;
      let earlySessions = null;

      ws.addEventListener("open", () => {
        if (this.ws === ws) {
          ws.send(JSON.stringify({
            type: "client.hello",
            payload: { clientId: this.clientId },
          }));
        }
      });

      ws.addEventListener("message", (ev) => {
        if (this.ws !== ws) return;
        let env;
        try { env = JSON.parse(ev.data); } catch (_) { return; }
        if (env.type === "error" && env.payload?.code === "unauthorized" && !this.ready) {
          this.close();
          this.onStatus("unauthorized");
          return;
        }
        if (!this.ready && env.type === "sessions.update") {
          earlySessions = env.payload.sessions;
          return;
        }
        if (env.type === "client.welcome") {
          if (earlySessions) env.payload.sessions = earlySessions;
          this.relayClientId = env.payload.clientId;
          this.attempt = 0;
          this.ready = true;
          this.restoring = true;
          this.onStatus("connected");
        }
        if (this.subscriptions.has(env.sessionId) && env.type === "history.snapshot" && env.clientId === this.relayClientId) {
          this.subscriptions.set(env.sessionId, env.seq || 0);
        } else if (this.subscriptions.has(env.sessionId) && env.seq > 0) {
          const lastSeq = this.subscriptions.get(env.sessionId);
          if (env.seq <= lastSeq) return;
          this.subscriptions.set(env.sessionId, env.seq);
        }
        this.onEnvelope(env);
        if (env.type === "client.welcome") {
          this.restoring = false;
          for (const sessionId of this.subscriptions.keys()) this.requestHistory(sessionId);
        }
      });

      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.ready = false;
        this.onStatus("disconnected");
        const delay = Math.min(15000, 1000 * 2 ** this.attempt);
        this.attempt += 1;
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      });
    }

    subscribe(sessionId) {
      if (this.subscriptions.has(sessionId)) return;
      this.subscriptions.set(sessionId, 0);
      this.requestHistory(sessionId);
    }

    unsubscribe(sessionId) {
      if (!this.subscriptions.delete(sessionId)) return;
      this.send({ type: "session.unsubscribe", sessionId, payload: { sessionId } });
    }

    requestHistory(sessionId) {
      if (this.restoring || !this.subscriptions.has(sessionId)) return;
      this.send({
        type: "session.subscribe",
        sessionId,
        payload: { sessionId, lastSeq: this.subscriptions.get(sessionId) },
      });
    }

    send(env) {
      if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return false;
      this.ws.send(JSON.stringify(env));
      return true;
    }

    close() {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.ready = false;
      this.restoring = false;
      const ws = this.ws;
      this.ws = null;
      ws?.close();
    }
  }

  global.PiRelayClient = RelayClient;
})(window);
