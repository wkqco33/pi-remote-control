import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { RemoteBridge } from "../extension/src/client/remote-bridge.ts";
import { WsClient } from "../extension/src/client/ws-client.ts";
import { DEFAULT_REMOTE_CONFIG } from "../extension/src/config.ts";

const PORT = 18787;
const TOKEN = "e2e-secret-token";
const SERVER_BIN = new URL("../bin/pi-remote-server", import.meta.url).pathname;

const server = spawn(SERVER_BIN, ["--addr", `127.0.0.1:${PORT}`, "--token", TOKEN], {
	stdio: ["ignore", "pipe", "pipe"],
});

async function waitForHealth() {
	for (let i = 0; i < 40; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
			if (res.ok) return;
		} catch {
			// retry
		}
		await delay(100);
	}
	throw new Error("server failed to become healthy");
}

try {
	await waitForHealth();

	const notices = [];
	const prompts = [];
	let bridge;

	const wsClient = new WsClient({
		serverUrl: `ws://127.0.0.1:${PORT}/ws/agent`,
		reconnectBaseMs: 100,
		reconnectMaxMs: 500,
		getHello: () => ({
			serverToken: TOKEN,
			sessionId: "e2e-sess-1",
			sessionName: "e2e-demo",
			host: "e2e-host",
			cwd: "/tmp/e2e",
			state: "idle",
			requirePairing: true,
		}),
		onMessage: (msg) => {
			void bridge.handleServerMessage(msg);
		},
	});

	bridge = new RemoteBridge({
		config: { ...DEFAULT_REMOTE_CONFIG, requirePairing: true },
		sink: wsClient,
		host: {
			sessionId: "e2e-sess-1",
			sessionName: "e2e-demo",
			host: "e2e-host",
			cwd: "/tmp/e2e",
			isIdle: () => true,
			sendPrompt: (text) => {
				prompts.push(text);
				bridge.emitStreamStart();
				bridge.emitStreamDelta("text", "echo: " + text);
				bridge.emitStreamEnd("echo: " + text);
			},
			abort: () => {},
			notify: (text) => notices.push(text),
			getHistory: () => [{ role: "assistant", text: "ready" }],
			getDigest: async () => "### Digest OK",
			now: () => Date.now(),
			random: () => 0.1,
		},
	});

	wsClient.start();
	await delay(200);

	// Connect browser-side WS client
	const web = new WebSocket(`ws://127.0.0.1:${PORT}/ws/client`);
	const received = [];
	web.addEventListener("message", (ev) => {
		received.push(JSON.parse(String(ev.data)));
	});
	await once(web, "open");
	web.send(JSON.stringify({ type: "client.hello", payload: { serverToken: TOKEN, clientId: "e2e-web" } }));

	await delay(150);
	const welcome = received.find((m) => m.type === "client.welcome");
	assert.ok(welcome, "expected client.welcome");
	assert.equal(welcome.payload.sessions.length, 1);

	web.send(JSON.stringify({ type: "session.subscribe", sessionId: "e2e-sess-1", payload: { sessionId: "e2e-sess-1", lastSeq: 0 } }));
	await delay(150);

	assert.ok(received.some((m) => m.type === "history.snapshot"), "expected history.snapshot");
	assert.ok(received.some((m) => m.type === "pair.required"), "expected pair.required");
	assert.ok(notices.length >= 1, "expected local pairing notice");

	const match = notices[0].match(/(\d{3}-\d{3})/);
	assert.ok(match, "expected formatted pairing code in local notice");
	const code = match[1].replace("-", "");

	web.send(JSON.stringify({ type: "pair.submit", sessionId: "e2e-sess-1", payload: { sessionId: "e2e-sess-1", code } }));
	await delay(150);
	assert.ok(received.some((m) => m.type === "pair.result" && m.payload.ok === true), "expected pair.result ok");

	web.send(JSON.stringify({ type: "prompt.send", sessionId: "e2e-sess-1", payload: { sessionId: "e2e-sess-1", text: "hello pi" } }));
	await delay(150);
	assert.deepEqual(prompts, ["hello pi"]);
	assert.ok(received.some((m) => m.type === "stream.end" && m.payload.text === "echo: hello pi"), "expected streamed reply");

	web.close();
	bridge.stop();
	wsClient.stop();
	console.log("E2E PASSED: Go relay <-> Node WsClient/RemoteBridge <-> WebSocket client");
} finally {
	server.kill("SIGTERM");
}
