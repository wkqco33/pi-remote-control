import { describe, expect, it, vi } from "vitest";
import { WsClient, type WebSocketLike } from "./ws-client.js";

class FakeWebSocket implements WebSocketLike {
	readyState = 0;
	sent: string[] = [];
	private listeners = new Map<string, Array<(ev: unknown) => void>>();

	addEventListener(type: string, listener: (ev: { data: unknown }) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(listener as (ev: unknown) => void);
		this.listeners.set(type, list);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", {});
	}

	emit(type: string, ev: unknown): void {
		if (type === "open") this.readyState = 1;
		for (const fn of this.listeners.get(type) ?? []) fn(ev);
	}
}

describe("WsClient", () => {
	it("sends agent.hello on open and responds to ping", () => {
		const sockets: FakeWebSocket[] = [];
		const received: unknown[] = [];
		const client = new WsClient({
			serverUrl: "ws://localhost:8787/ws/agent",
			reconnectBaseMs: 50,
			reconnectMaxMs: 200,
			getHello: () => ({
				serverToken: "tok",
				sessionId: "s1",
				host: "box",
				cwd: "/repo",
				state: "idle",
				requirePairing: true,
			}),
			onMessage: (m) => received.push(m),
			createWebSocket: () => {
				const s = new FakeWebSocket();
				sockets.push(s);
				return s;
			},
		});

		client.start();
		expect(sockets).toHaveLength(1);
		sockets[0]?.emit("open", {});
		expect(client.currentStatus).toBe("connected");
		expect(JSON.parse(sockets[0]?.sent[0] ?? "{}").type).toBe("agent.hello");

		sockets[0]?.emit("message", { data: JSON.stringify({ type: "ping" }) });
		expect(JSON.parse(sockets[0]?.sent[1] ?? "{}").type).toBe("pong");

		sockets[0]?.emit("message", { data: JSON.stringify({ type: "turn.abort", clientId: "c1" }) });
		expect(received).toEqual([{ type: "turn.abort", clientId: "c1" }]);

		client.stop();
		expect(client.currentStatus).toBe("disconnected");
		// Idempotent stop
		expect(() => client.stop()).not.toThrow();
	});

	it("schedules reconnect on unexpected close", () => {
		vi.useFakeTimers();
		const sockets: FakeWebSocket[] = [];
		const client = new WsClient({
			serverUrl: "ws://localhost:8787/ws/agent",
			reconnectBaseMs: 100,
			reconnectMaxMs: 400,
			getHello: () => ({
				serverToken: "tok",
				sessionId: "s1",
				host: "box",
				cwd: "/repo",
				state: "idle",
				requirePairing: true,
			}),
			onMessage: () => {},
			createWebSocket: () => {
				const s = new FakeWebSocket();
				sockets.push(s);
				return s;
			},
		});

		client.start();
		sockets[0]?.emit("close", {});
		expect(sockets).toHaveLength(1);
		vi.advanceTimersByTime(100);
		expect(sockets).toHaveLength(2);
		client.stop();
		vi.useRealTimers();
	});
});
