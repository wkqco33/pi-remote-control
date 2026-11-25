/**
 * Outbound WebSocket client for pi-remote-control.
 * Uses Node 22+ built-in WebSocket (zero runtime npm dependencies).
 */

import { PROTOCOL_VERSION, parseServerEnvelope, type AgentState, type ServerInboundMessage, type WireEnvelope } from "../core/protocol.js";
import type { ConnectionStatus } from "../core/status.js";

export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "open", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	addEventListener(type: "close", listener: () => void): void;
	addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface AgentHelloInfo {
	readonly serverToken: string;
	readonly sessionId: string;
	readonly sessionName?: string;
	readonly host: string;
	readonly cwd: string;
	readonly branch?: string;
	readonly model?: string;
	readonly state: AgentState;
	readonly requirePairing: boolean;
	readonly autoApprove?: boolean;
}

export interface WsClientOptions {
	readonly serverUrl: string;
	readonly reconnectBaseMs: number;
	readonly reconnectMaxMs: number;
	readonly getHello: () => AgentHelloInfo;
	readonly onMessage: (msg: ServerInboundMessage) => void;
	readonly onStatusChange?: (status: ConnectionStatus, detail?: string) => void;
	readonly createWebSocket?: WebSocketFactory;
}

const WS_OPEN = 1;

export class WsClient {
	private readonly opts: WsClientOptions;
	private readonly createWS: WebSocketFactory;
	private ws: WebSocketLike | null = null;
	private stopped = true;
	private attempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private status: ConnectionStatus = "disconnected";

	constructor(opts: WsClientOptions) {
		this.opts = opts;
		this.createWS =
			opts.createWebSocket ??
			((url: string) => {
				const GlobalWS = (globalThis as unknown as { WebSocket?: new (u: string) => WebSocketLike }).WebSocket;
				if (!GlobalWS) {
					throw new Error("Global WebSocket is unavailable; Node >= 22 is required.");
				}
				return new GlobalWS(url);
			});
	}

	get currentStatus(): ConnectionStatus {
		return this.status;
	}

	start(): void {
		if (!this.stopped) return;
		this.stopped = false;
		this.attempt = 0;
		this.connect();
	}

	stop(): void {
		this.stopped = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.ws !== null) {
			const sock = this.ws;
			this.ws = null;
			try {
				sock.close(1000, "session shutdown");
			} catch {
				// Ignore close errors during shutdown.
			}
		}
		this.setStatus("disconnected");
	}

	send(envelope: WireEnvelope): boolean {
		if (this.ws === null || this.ws.readyState !== WS_OPEN) return false;
		try {
			this.ws.send(JSON.stringify(envelope));
			return true;
		} catch {
			return false;
		}
	}

	private setStatus(status: ConnectionStatus, detail?: string): void {
		this.status = status;
		this.opts.onStatusChange?.(status, detail);
	}

	private connect(): void {
		if (this.stopped) return;
		this.setStatus("connecting");

		let sock: WebSocketLike;
		try {
			sock = this.createWS(this.opts.serverUrl);
		} catch (error) {
			this.setStatus("error", error instanceof Error ? error.message : String(error));
			this.scheduleReconnect();
			return;
		}
		this.ws = sock;

		sock.addEventListener("open", () => {
			if (this.ws !== sock || this.stopped) return;
			this.attempt = 0;
			const hello = this.opts.getHello();
			this.send({
				type: "agent.hello",
				sessionId: hello.sessionId,
				ts: Date.now(),
				payload: {
					...hello,
					protocolVersion: PROTOCOL_VERSION,
				},
			});
			this.setStatus("connected");
		});

		sock.addEventListener("message", (event) => {
			if (this.ws !== sock || this.stopped) return;
			const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
			const parsed = parseServerEnvelope(raw);
			if (!parsed) return;
			if (parsed.type === "ping") {
				this.send({ type: "pong", sessionId: this.opts.getHello().sessionId, ts: Date.now() });
				return;
			}
			if (parsed.type === "error") {
				this.setStatus("error", parsed.message);
			}
			this.opts.onMessage(parsed);
		});

		sock.addEventListener("close", () => {
			if (this.ws !== sock) return;
			this.ws = null;
			if (this.stopped) {
				this.setStatus("disconnected");
				return;
			}
			this.setStatus("disconnected");
			this.scheduleReconnect();
		});

		sock.addEventListener("error", () => {
			if (this.ws !== sock || this.stopped) return;
			this.setStatus("error", "websocket connection error");
		});
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer !== null) return;
		const exp = Math.min(this.opts.reconnectMaxMs, this.opts.reconnectBaseMs * 2 ** this.attempt);
		this.attempt += 1;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, exp);
		if (typeof this.reconnectTimer === "object" && "unref" in this.reconnectTimer) {
			this.reconnectTimer.unref();
		}
	}
}
