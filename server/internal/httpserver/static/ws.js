(function (global) {
  "use strict";

  class RelayClient {
    constructor(opts) {
      this.getToken = opts.getToken;
      this.clientId = opts.clientId;
      this.onStatus = opts.onStatus;
      this.onEnvelope = opts.onEnvelope;
      this.ws = null;
      this.closed = false;
      this.attempt = 0;
      this.reconnectTimer = null;
      this.subscribedSessionId = null;
      this.lastSeqBySession = new Map();
    }

    connect() {
      this.closed = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        try { this.ws.close(); } catch (_) {}
      }

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}/ws/client`;
      this.onStatus("connecting");
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        if (this.ws !== ws) return;
        this.attempt = 0;
        this.send({
          type: "client.hello",
          payload: {
            serverToken: this.getToken() || "",
            clientId: this.clientId,
          },
        });
      });

      ws.addEventListener("message", (ev) => {
        if (this.ws !== ws) return;
        let env;
        try { env = JSON.parse(ev.data); } catch (_) { return; }
        if (env.sessionId && typeof env.seq === "number" && env.seq > 0) {
          this.lastSeqBySession.set(env.sessionId, env.seq);
        }
        if (env.type === "client.welcome") {
          this.onStatus("connected");
          if (this.subscribedSessionId) {
            this.subscribe(this.subscribedSessionId);
          }
        }
        this.onEnvelope(env);
      });

      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.onStatus("disconnected");
        if (!this.closed) this.scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        if (this.ws !== ws) return;
        this.onStatus("error");
      });
    }

    scheduleReconnect() {
      const delay = Math.min(15000, 1000 * Math.pow(2, this.attempt));
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    subscribe(sessionId) {
      if (this.subscribedSessionId && this.subscribedSessionId !== sessionId) {
        this.send({
          type: "session.unsubscribe",
          sessionId: this.subscribedSessionId,
          payload: { sessionId: this.subscribedSessionId },
        });
      }
      this.subscribedSessionId = sessionId;
      const lastSeq = this.lastSeqBySession.get(sessionId) || 0;
      this.send({
        type: "session.subscribe",
        sessionId,
        payload: { sessionId, lastSeq },
      });
    }

    send(env) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      this.ws.send(JSON.stringify(env));
      return true;
    }

    close() {
      this.closed = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.ws) {
        try { this.ws.close(); } catch (_) {}
        this.ws = null;
      }
    }
  }

  global.PiRelayClient = RelayClient;
})(window);
